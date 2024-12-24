import { parse_etag } from ".";
import { File } from "./index-response";

export async function show_file(extractor: string, file: File, req: Request): Promise<Response> {
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
}export const BLOCK_SIZE = 0x40000;

export async function unwrap(r: Response) {
  if (r.ok) {
    return await r.arrayBuffer();
  } else {
    const msg = await r.text();
    console.warn("extractor error", msg, r);
    throw msg;
  }
}
