import { Convert, File, IndexResponse, Sprite } from "./index-response";
import qs, { IParseBaseOptions } from "qs";

export default {
  async scheduled(_, env) {
    await fetch(env.INDEX + "/files?q=ready");
  },
  async fetch(request, env) {
    try {
      const response = await handleRequest(request, env);
      Object.entries({
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "*",
        "Access-Control-Max-Age": "86400",
        "Access-Control-Allow-Headers": "*",
      }).forEach(([k, v]) => response.headers.set(k, v));
      return response;
    } catch (e) {
      console.error(request.url, e);
      throw e;
    }
  },
} satisfies ExportedHandler<Env>;

async function handleRequest(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  let path = url.pathname;
  const version = path.split("/")[1];
  let adapter: string;
  if (!version?.match(/^\d+\./)) {
    const { hostname, protocol, port } = new URL(env.INDEX);
    url.protocol = protocol;
    url.hostname = hostname;
    url.port = port;
    const response = await fetch(url);
    if (!response.ok || version !== "files") {
      return new Response(response.body, response);
    } else {
      return processIndexResponse(await response.json(), new URL(request.url), env);
    }
  } else {
    adapter = version + "/";
    path = path.split(adapter)[1] || "";
    const upstream = version.startsWith("3") ? "https://patch.poecdn.com/" : "https://patch-poe2.poecdn.com/";
    adapter = upstream + adapter;
  }

  if (request.headers.has("if-modified-since")) {
    // requests are keyed by version, so it's pretty unlikely for backing data to change
    return new Response(null, { status: 304 });
  }

  if (!path || path.endsWith("/")) {
    return show_dir(path.substring(0, path.length - 1), adapter, version, env);
  } else {
    let file: File | null = null;
    if (url.search) {
      try {
        file = Convert.toFile(qs.parse(url.search, qsConf));
      } catch (e) {
        console.warn("invalid parameters", JSON.stringify(qs.parse(url.search, qsConf)), e);
      }
    }
    if (!file) {
      const details = await index("details", env.INDEX, path, adapter);
      if (!details?.files?.length) {
        return Response.json(details, { status: 404 });
      }
      file = details.files[0];
    }
    if (is_dir(file)) {
      return Response.redirect(url.pathname + "/");
    }
    try {
      return show_file(env.EXTRACTOR, file, request);
    } catch (e) {
      return new Response(null, { status: 420 });
    }
  }
}

const qsConf: IParseBaseOptions = {
  ignoreQueryPrefix: true,
  strictNullHandling: true,
  decoder: (v, def, cs, t) => (t === "value" && !isNaN(parseInt(v)) ? parseInt(v) : def(v, def, cs)),
};

async function index(command: string, host: string, path: string, adapter: string): Promise<IndexResponse> {
  const index_url = new URL(host);
  index_url.pathname = "/files";
  index_url.searchParams.set("q", command);
  index_url.searchParams.set("path", path);
  index_url.searchParams.set("adapter", adapter);
  return await fetch(index_url).then((r) => r.json());
}

function processIndexResponse(response: IndexResponse, url: URL, env: Env): Response | PromiseLike<Response> {
  (response as any).dirname = url.searchParams.get("path") || "";

  const version = response.adapter
    .split("/")
    .reverse()
    .find((v) => v);

  for (let f of response.files || []) {
    if (f.sprite) {
      (f as any).url = `${env.IMAGES}/${version}/${f.sprite.sheet}?format=png&${qs.stringify(crop(f.sprite))}`;
    } else if (f.basename.endsWith(".dds")) {
      f.mime_type = "image/png";
      (f as any).url = `${env.IMAGES}/${version}/${f.path}?format=png&${qs.stringify(f)}`;
    } else if (!is_dir(f)) {
      (f as any).url = new URL(`/${version}/${f.path}?${qs.stringify(f)}`, url).toString();
    }
  }
  return Response.json(response, { headers: { "cache-control": "public, max-age=2409962" } });
}

async function show_dir(path: string, adapter: string, version: string, env: Env): Promise<Response> {
  const result = await index("index", env.INDEX, path, adapter);
  const html = `<!DOCTYPE html>
<body>
  <h1>${escape(path)}</h1>
${result.files
  .sort((l, r) => (is_dir(l) !== is_dir(r) ? is_dir(r) - is_dir(l) : l.basename.localeCompare(r.basename)))
  .map((f) =>
    f.sprite
      ? `
  <p>
    ${f.basename}
    (<a href="${escape(env.IMAGES)}/${escape(version)}/${escape(f.sprite.sheet)}?format=png&${escape(
          qs.stringify(crop(f.sprite))
        )}">png</a>)
  </p>`
      : `
  <p>
    <a href="/${escape(version)}/${escape(f.path)}${is_dir(f, "/") || "?" + escape(qs.stringify(f))}">
      ${escape(f.basename)}${is_dir(f, "/", "")}
    </a>${
      !f.basename.endsWith(".dds")
        ? ""
        : `
    (<a href="${escape(env.IMAGES)}/${escape(version)}/${escape(f.path)}?format=png&${escape(qs.stringify(f))}">png</a>)`
    }
  </p>`
  )
  .join("")}
</body>`;

  return new Response(html, {
    headers: {
      "content-type": "text/html;charset=UTF-8",
      "cache-control": "public, max-age=2409962",
    },
  });
}

function is_dir(f: File, y: any = 1, n: any = 0) {
  return f.type === "dir" ? y : n;
}

function escape(html: string) {
  return html.replace(/[^0-9A-Za-z ]/g, (c) => "&#" + c.charCodeAt(0) + ";");
}

const BLOCK_SIZE = 0x40000;

async function show_file(extractor: string, file: File, req: Request): Promise<Response> {
  if (!file.file_size) {
    console.warn("empty file requested, returning empty response", file);
    return new Response();
  }

  let cdn_url = file.storage;
  if (!cdn_url.endsWith("/")) {
    cdn_url = cdn_url + "/";
  }
  cdn_url = cdn_url + `Bundles2/${file.bundle!.name}.bundle.bin`;

  const headers: HeadersInit = {};
  if ("mime_type" in file) {
    headers["content-type"] = file.mime_type!;
  }

  const block_count = Math.ceil(file.bundle!.size / BLOCK_SIZE);
  const header_size = 59 + block_count * 4;

  const resp = await fetch(cdn_url, { headers: { range: "bytes=0-" + header_size } });
  if (req.headers.has("if-none-match") && resp.headers.has("etag")) {
    const matches = parse_etag(req.headers.get("if-none-match")!);
    if (parse_etag(resp.headers.get("etag")!).find((match) => matches.includes(match))) {
      return new Response(null, { status: 304 });
    }
  }
  for (let h of ["last-modified", "etag", "cache-control", "expires", "date"]) {
    if (resp.headers.has(h)) {
      headers[h] = resp.headers.get(h)!;
    }
  }

  const dataview = new DataView(await unwrap(resp));

  const bundle_size = dataview.getInt32(0, true);
  if (bundle_size !== file.bundle!.size) {
    console.warn("unexpected bundle size", bundle_size, "expected", file.bundle!.size);
  }
  let offset = dataview.getInt32(8, true) + 12;
  if (offset !== header_size + 1) {
    console.warn("unexpected header size", offset, "for block count", block_count);
  }
  const first_block = Math.floor(file.bundle_offset! / BLOCK_SIZE);
  const last_block = Math.floor((file.bundle_offset! + file.file_size! - 1) / BLOCK_SIZE);
  const blocks: { start: number; end: number; promise: Promise<Response> }[] = [];
  for (let i = 0; i < block_count; i++) {
    const compressed = dataview.getInt32(60 + i * 4, true);
    if (i > last_block) {
      break;
    } else if (i >= first_block) {
      const extracted = Math.min(BLOCK_SIZE, bundle_size - BLOCK_SIZE * i);

      const url = new URL(extractor);
      url.searchParams.set("url", cdn_url);
      url.searchParams.set("offset", String(offset));
      url.searchParams.set("compressed", String(compressed));
      url.searchParams.set("extracted", String(extracted));
      url.searchParams.set("block", i.toString());

      const start = i !== first_block ? 0 : file.bundle_offset! % BLOCK_SIZE;
      const end = i !== last_block ? extracted : (file.bundle_offset! + file.file_size!) % BLOCK_SIZE;
      const init = start === 0 && end === compressed ? undefined : { headers: { range: `bytes=${start}-${end - 1}` } };

      blocks.push({ start, end, promise: fetch(url, init) });
    }
    offset += compressed;
  }

  const result = new Uint8Array(file.file_size!);
  let i = 0;
  for (let { start, end, promise } of blocks) {
    const resp = await promise;
    let buf = new Uint8Array(await unwrap(resp));
    if (start) {
      // Check that range header was honored, otherwise we'll need to do it ourself
      let actual = [0, BLOCK_SIZE];
      const hval = resp.headers.get("content-range");
      if (hval) {
        const match = /bytes (\d+)-(\d+)/.exec(hval);
        if (match?.length != 4) {
          throw `failed to parse content-range header '${hval}' - got ${match}`;
        }
        actual = match.slice(2, 4).map(parseInt);
      }
      if (start !== actual[0]) {
        buf = buf.slice(start - actual[0]);
      }
    }
    if (end - start !== buf.length) {
      buf = buf.slice(0, end - start);
    }
    result.set(buf, i);

    i += buf.length;
  }
  if (i !== file.file_size) {
    console.warn("expected", file.file_size, "bytes, got", i);
  }

  return new Response(result, { headers });
}

async function unwrap(r: Response) {
  if (r.ok) {
    return await r.arrayBuffer();
  } else {
    const msg = await r.text();
    console.warn("extractor error", msg, r);
    throw msg;
  }
}

/**
 * get the contents of each opaque-tag in an etag header
 */
function parse_etag(m: string): string[] {
  //assuming the header follows https://www.rfc-editor.org/rfc/rfc7232#appendix-C,
  //each tag should be surrounded by quotes and cannot contain quotes
  return m.split('"').filter((_, i) => i % 2);
}

function crop({ x, y, w, h }: Sprite): any {
  return { x, y, w, h };
}
