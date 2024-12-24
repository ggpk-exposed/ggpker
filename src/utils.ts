import qs, { IParseBaseOptions } from "qs";
import { Convert, File, IndexResponse, Sprite } from "./index-response";

export function is_dir(f: File, y: any = 1, n: any = 0) {
  return f.type === "dir" ? y : n;
}

export function crop({ x, y, w, h }: Sprite): any {
  return { x, y, w, h };
}

export async function index(command: string, host: string, path: string, adapter: string): Promise<IndexResponse> {
  const index_url = new URL(host);
  index_url.pathname = "/files";
  index_url.searchParams.set("q", command);
  index_url.searchParams.set("path", path);
  index_url.searchParams.set("adapter", adapter);
  return await fetch(index_url).then((r) => r.json());
}

export async function file_details(url: URL, env: Env, path: string, adapter: string): Promise<[file?: File, details?: IndexResponse]> {
  let file: File | undefined = undefined;
  if (url.search) {
    try {
      file = Convert.toFile(qs.parse(url.search, qsConf));
    } catch (e) {
      console.warn("invalid parameters", JSON.stringify(qs.parse(url.search, qsConf)), e);
    }
  }
  if (file) {
    return [file];
  } else {
    const details = await index("details", env.INDEX, path, adapter);
    return [details.files?.[0], details];
  }
}

const qsConf: IParseBaseOptions = {
  ignoreQueryPrefix: true,
  strictNullHandling: true,
  decoder: (v, def, cs, t) => (t === "value" && !isNaN(parseInt(v)) ? parseInt(v) : def(v, def, cs)),
};

export function processIndexResponse(response: IndexResponse, url: URL, env: Env): Response | PromiseLike<Response> {
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
