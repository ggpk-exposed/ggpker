import { mime, split_path } from "./utils";
import { File } from "./index-response";

export const storages = ["poe1", "poe2"] as const;
export type Storage = (typeof storages)[number];

export function is_db(name: string): name is Storage {
  return storages.includes(name as any);
}

export function guess_db(name?: string | null): Storage {
  if (!name) return "poe2";
  if (is_db(name)) return name;
  return name.startsWith("3") || name.includes("/3.") ? "poe1" : "poe2";
}

async function fetch_index(url: string, env: Env) {
  if (env.INDEX_SERVICE) {
    const res = await env.INDEX_SERVICE.fetch(new Request(url));
    if (!res.ok) {
        throw new Error(`Failed to fetch index: ${res.status} ${await res.text()}`);
    }
    return res.json();
  }
  const res = await fetch(url);
  if (!res.ok) {
      throw new Error(`Failed to fetch index: ${res.status} ${await res.text()}`);
  }
  return res.json();
}

export async function current_version(adapter: Storage, env: Env) {
  const data: any = await fetch_index(env.INDEX + "/files?q=ready", env);
  const storages = data.storages as string[];
  const search = adapter === "poe1" ? "patch.poecdn.com" : "patch-poe2.poecdn.com";
  return storages.find(s => s.includes(search))!;
}

export async function ls(path: string, adapter: Storage, env: Env) {
  const version = await current_version(adapter, env);
  const data: any = await fetch_index(env.INDEX + "/files?path=" + encodeURIComponent(path) + "&adapter=" + encodeURIComponent(version), env);
  return mapNodes(data.files, version);
}

export async function stat(path: string, adapter: Storage, env: Env) {
  const version = await current_version(adapter, env);
  const data: any = await fetch_index(env.INDEX + "/files?q=details&path=" + encodeURIComponent(path) + "&adapter=" + encodeURIComponent(version), env);
  return mapNode(data.files[0], version);
}

export async function search_files(adapter: Storage, env: Env, filter: string, path: string) {
  const version = await current_version(adapter, env);
  const url = env.INDEX + "/files?q=search&filter=" + encodeURIComponent(filter) + "&path=" + encodeURIComponent(path) + "&adapter=" + encodeURIComponent(version);
  const data: any = await fetch_index(url, env);
  return mapNodes(data.files, version);
}

function mapNodes(nodes: any[], storage: string): File[] {
  return nodes.map(node => mapNode(node, storage));
}

function mapNode(node: any, storage: string): File {
    return {
        path: node.path,
        dirname: node.dirname,
        basename: node.basename,
        storage: storage,
        type: node.type,
        extension: node.extension,
        mime_type: node.mime_type,
        file_size: node.file_size,
        bundle: node.bundle,
        bundle_offset: node.bundle_offset,
        sprite: node.sprite
      };
}
