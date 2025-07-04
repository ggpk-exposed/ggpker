import qs from "qs";
import { File, IndexResponse, Sprite } from "./index-response";
import { Mime } from "mime";
import standardTypes from "mime/types/standard.js";
import otherTypes from "mime/types/other.js";
import { current_version, get_db, mapFile, stat, Storage } from "./db";

export const mime = new Mime(standardTypes, otherTypes);
mime.define(
  {
    "text/plain": [
      "act",
      "amd",
      "ao",
      "aoc",
      "arm",
      "atl",
      "atlas",
      "cht",
      "clt",
      "csd",
      "dct",
      "ddt",
      "dgr",
      "dlp",
      "ecf",
      "env",
      "epk",
      "et",
      "ffx",
      "fgp",
      "filter",
      "fxgraph",
      "gft",
      "gt",
      "h",
      "hideout",
      "hlsl",
      "inc",
      "it",
      "itc",
      "mat",
      "mtd",
      "ot",
      "otc",
      "pet",
      "rs",
      "slg",
      "sm",
      "tgr",
      "tgt",
      "tmo",
      "toy",
      "trl",
      "tsi",
      "tst",
      "txt",
      "ui",
      "xml",
    ],
  },
  true,
);

export function is_dir(f: File, y: any = 1, n: any = 0) {
  return f.type === "dir" ? y : n;
}

export function crop({ x, y, w, h }: Sprite): any {
  return { x, y, w, h };
}

export async function file_details(env: Env, path: string, adapter: Storage): Promise<File | undefined> {
  const found = await stat(path, adapter, env);
  if (found) return mapFile(found, split_path(path)[0], await current_version(get_db(adapter, env)));
}

export function processIndexResponse(response: IndexResponse, url: URL, env: Env): Response | PromiseLike<Response> {
  (response as any).dirname = url.searchParams.get("path") || "";

  const version = response.adapter
    .split("/")
    .reverse()
    .find((v) => v);

  for (let f of response.files || []) {
    if (f.sprite) {
      f.mime_type = "image/png";
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

export function split_path(path: string): [string, string] {
  const split = path.lastIndexOf("/");
  if (split < 0) return ["", path];
  return [path.substring(0, split), path.substring(split + 1)];
}
