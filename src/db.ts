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

export function get_db(adapter: string | null, env: Env) {
  return env[guess_db(adapter)];
}

export async function current_version(db: D1Database) {
  const row = await db
    .prepare(
      `select url
       from version
       where id = 0`,
    )
    .first();
  return row!.url as string;
}

export async function ls(path: string, adapter: Storage, env: Env) {
  const db = get_db(adapter, env);
  const file_storage = current_version(db);
  return Promise.all([
    ls_dirs(db, path).then((r) => mapDirs(r, path, adapter)),
    ls_files(db, path).then((r) => file_storage.then((s) => mapFiles(r, path, s))),
  ]).then((r) => r.flat());
}

export async function stat(path: string, adapter: Storage, env: Env) {
  const [dir, name] = split_path(path);
  return await get_db(adapter, env)
    .prepare(
      `select f.*, b.name as bundle_name, b.size as bundle_size
       from files as f
              join bundles as b on b.id = f.bundle
       where f.dir in (select id from dirs where name = ?)
         and f.name = ?`,
    )
    .bind(dir, name)
    .first();
}

export async function ls_files(db: D1Database, path?: string) {
  if (!path) {
    return root_files(db);
  }
  const { results } = await db
    .prepare(
      `select f.*, b.name as bundle_name, b.size as bundle_size
       from files as f
              join bundles as b on b.id = f.bundle
       where f.dir in (select id from dirs where name = ?)
       order by f.name`,
    )
    .bind(path)
    .all();
  return results;
}

export async function search_files(adapter: Storage, env: Env, filter: string, path: string) {
  const db = get_db(adapter, env);

  const { results } = await (path
    ? db
        .prepare(
          `select f.*,
                  b.name as bundle_name,
                  b.size as bundle_size,
                  (select dirs.name from dirs where dirs.id = f.dir) as dir_name
           from files as f
                  join bundles as b on b.id = f.bundle
           where f.name like ?
             and f.dir in (select id from dirs where name like ?)
           order by f.name`,
        )
        .bind("%" + filter.toLowerCase() + "%", path + "%")
        .all()
    : db
        .prepare(
          `select f.*, b.name as bundle_name, b.size as bundle_size
       from files as f
              join bundles as b on b.id = f.bundle
       where f.name like ?
       order by f.name`,
        )
        .bind("%" + filter.toLowerCase() + "%")
        .all());

  return mapFiles(results, path, await current_version(db));
}

async function root_files(db: D1Database) {
  const { results } = await db
    .prepare(
      `select f.*, b.name as bundle_name, b.size as bundle_size
       from files as f
              join bundles as b on b.id = f.bundle
       where f.dir is null
       order by f.name`,
    )
    .all();
  return results;
}

export async function ls_dirs(db: D1Database, path?: string) {
  if (!path) {
    return root_dirs(db);
  }
  const { results } = await db
    .prepare(
      `select d.*
       from dirs as d
       where d.parent = (select id from dirs where name = ?)
       order by d.name
      `,
    )
    .bind(path)
    .all();
  return results;
}

async function root_dirs(db: D1Database) {
  const { results } = await db
    .prepare(
      `select d.*
       from dirs as d
       where d.parent is null
       order by d.name
      `,
    )
    .all();
  return results;
}

export function mapFiles(rows: Record<string, any>[], dirname: string, storage: string) {
  return rows.map((row) => mapFile(row, dirname, storage));
}

export function mapFile(row: Record<string, any>, dirname: string, storage: string): File {
  const extension = row.name.includes(".") ? row.name.split(".").pop() : undefined;
  const mime_type = mime.getType(row.name) || undefined;
  if ("dir_name" in row) {
    dirname = row.dir_name;
  }
  const path = dirname ? dirname + "/" + row.name : row.name;
  return {
    path,
    dirname,
    basename: row.name,
    storage,
    type: "file",
    extension,
    mime_type,
    file_size: row.size,
    bundle: { name: row.bundle_name, size: row.bundle_size },
    bundle_offset: row.offset,
  };
}

export function mapDirs(rows: Record<string, any>[], dirname: string, storage: Storage) {
  return rows.map((row) => mapDir(row, dirname, storage));
}

export function mapDir(row: Record<string, any>, dirname: string, storage: Storage): File {
  return {
    path: row.name,
    dirname,
    basename: row.name.split("/").pop(),
    storage,
    type: "dir",
  };
}
