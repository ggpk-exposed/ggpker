import { show_file } from "./show-file";
import { file_details, processIndexResponse } from "./utils";
import { current_version, get_db, guess_db, is_db, ls, Storage, storages } from "./db";
import { connect } from "cloudflare:sockets";

export default {
  async scheduled() {
    try {
      console.log("opening socket");
      const socket = connect({ hostname: "patch.pathofexile.com", port: 12995 });

      console.log("sending command");
      const writer = socket.writable.getWriter();
      await writer.write(new Uint8Array([1, 7]));
      writer.releaseLock();
      console.log("sent 1,7");

      const reader = socket.readable.getReader();
      const { value } = await reader.read();
      console.log("got", value.length, "bytes");
      const len = value[34];
      if (value.length < 35 + len * 2) {
        console.error("you need to read more bytes", len, value.length);
      }
      const bytes = value.slice(35, 35 + len * 2);
      const url = new TextDecoder("utf-16le").decode(bytes);
      console.log("got url", url);
      reader.releaseLock();
      await socket.close();
    } catch (error) {
      console.error("Error in scheduled task", error);
    }
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

function normalizePath(path?: string | null) {
  if (!path) return "";
  return path.toLowerCase().replace(/^\/+/g, "").replace(/\/+$/g, "");
}

async function handleRequest(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  let path = url.pathname;
  const route = path.split("/")[1];
  let adapter: Storage;
  if (route === "files") {
    path = normalizePath(url.searchParams.get("path"));
    adapter = guess_db(url.searchParams.get("adapter"));

    if (url.searchParams.get("q") !== "preview") {
      const files = await ls(path, adapter, env);
      return processIndexResponse({ storages, adapter, files }, new URL(request.url), env);
    }
  } else if (route === "version") {
    const db = get_db("poe" + url.searchParams.get("poe"), env);
    return new Response(await current_version(db));
  } else if (is_db(route)) {
    adapter = route;
    path = normalizePath(path.split(adapter + "/")[1] || "");
  } else {
    console.log("unrecognised route", route);
    return new Response(null, Response.redirect(env.BROWSER));
  }

  if (request.headers.has("if-modified-since")) {
    // requests are keyed by version, so it's unlikely for backing data to change
    return new Response(null, { status: 304 });
  }

  let file = await file_details(env, path, adapter);
  if (file) {
    return show_file(env.EXTRACTOR, file, request);
  } else {
    console.log("file not found", path);
    return new Response(null, Response.redirect(env.BROWSER + url.pathname));
  }
}

/**
 * get the contents of each opaque-tag in an etag header
 */
export function parse_etag(m: string): string[] {
  //assuming the header follows https://www.rfc-editor.org/rfc/rfc7232#appendix-C,
  //each tag should be surrounded by quotes and cannot contain quotes
  return m.split('"').filter((_, i) => i % 2);
}
