import { show_dir } from "./show-dir";
import { show_file } from "./show-file";
import { file_details, is_dir, processIndexResponse } from "./utils";

let storages: { storages: string[] } | null = null;

export default {
  async scheduled(_, env) {
    storages = await fetch(env.INDEX + "/files?q=ready").then((res) => res.json());
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
  const route = path.split("/")[1];
  let adapter: string;
  if (route === "files" && url.searchParams.get("q") === "preview") {
    path = url.searchParams.get("path")!;
    adapter = url.searchParams.get("adapter")!;
  } else if (["files", "version"].includes(route)) {
    const { hostname, protocol, port } = new URL(env.INDEX);
    url.protocol = protocol;
    url.hostname = hostname;
    url.port = port;
    const response = await fetch(url);
    if (!response.ok || route !== "files") {
      return new Response(response.body, response);
    } else {
      return processIndexResponse(await response.json(), new URL(request.url), env);
    }
  } else if (route === "poe1") {
		path = path.split("poe1/")[1];
		adapter = (storages! || (await fetch(env.INDEX + "/files?q=ready").then((res) => res.json()))).storages.find((s) =>
			s.includes("patch.poecdn.com"),
		)!;
	} else if (route === "poe2") {
		path = path.split("poe2/")[1];
		adapter = (storages! || (await fetch(env.INDEX + "/files?q=ready").then((res) => res.json()))).storages.find((s) =>
			s.includes("patch-poe2.poecdn.com"),
		)!;
	} else if (route?.match(/^\d+\./)) {
		if (request.headers.has("if-modified-since")) {
			// requests are keyed by version, so it's unlikely for backing data to change
			return new Response(null, { status: 304 });
		}
    adapter = route + "/";
    path = path.split(adapter)[1] || "";
    const upstream = route.startsWith("3") ? "https://patch.poecdn.com/" : "https://patch-poe2.poecdn.com/";
    adapter = upstream + adapter;
  } else {
		// Unrecognised route, send them away
		return new Response(null, Response.redirect(env.BROWSER));
	}

  if (!path || path.endsWith("/")) {
    return show_dir(path.substring(0, path.length - 1), adapter, route, env);
  } else {
    let [file, details] = await file_details(url, env, path, adapter);
    if (!file) {
      return Response.json(details, { status: 404 });
    }

    if (is_dir(file)) {
      return new Response(null, Response.redirect(env.BROWSER + url.pathname));
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
