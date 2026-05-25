import {File} from "./index-response";

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
  const res = await env.INDEX!.fetch(new Request(url));
  console.log("fetch_index", url)
  if (!res.ok) {
      throw new Error(`Failed to fetch ${url}: ${res.status} ${await res.text()}`);
  }
  return res.json();
}

export async function current_version(poe: string, env: Env) {
  const res = await env.INDEX!.fetch("http://index/version?poe=" + poe);
  return res.text();
}

export async function ls(path: string, adapter: string, env: Env) {
  const data: any = await fetch_index("http://index/files?q=index&path=" + encodeURIComponent(path) + "&adapter=" + encodeURIComponent(adapter), env);
  return mapNodes(data.files, adapter);
}

export async function stat(path: string, adapter: string, env: Env) {
  const data: any = await fetch_index("http://index/files?q=details&path=" + encodeURIComponent(path) + "&adapter=" + encodeURIComponent(adapter), env);
  return mapNode(data.files[0], adapter);
}

export async function search_files(adapter: string, env: Env, filter: string, path: string) {
  const url = "http://index/files?q=search&filter=" + encodeURIComponent(filter) + "&path=" + encodeURIComponent(path) + "&adapter=" + encodeURIComponent(adapter);
  const data: any = await fetch_index(url, env);
  return mapNodes(data.files, adapter);
}

function mapNodes(nodes: any[], storage: string): File[] {
  return nodes.filter(Boolean).map(node => mapNode(node, storage));
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
