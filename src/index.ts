import { show_dir } from "./show-dir";
import { show_file } from "./show-file";
import { file_details, is_dir, processIndexResponse } from "./utils";

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

  if (!path) {
    return Response.redirect(env.BROWSER, 301);
  } else if (path.endsWith("/")) {
    return show_dir(path.substring(0, path.length - 1), adapter, version, env);
  } else {
    let [file, details] = await file_details(url, env, path, adapter);
    if (!file) {
      return Response.json(details, { status: 404 });
    }

    if (is_dir(file)) {
      return Response.redirect(url.pathname + "/");
    }

    return show_file(env.EXTRACTOR, file, request);
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
