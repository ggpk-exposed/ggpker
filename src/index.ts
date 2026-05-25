import {show_file} from "./show-file";
import {file_details, processIndexResponse} from "./utils";
import {current_version, guess_db, is_db, ls, search_files, Storage, storages} from "./db";

export default {
	async fetch(request, env, ctx) {
		try {
			const response = await handleRequest(request, env, ctx);
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
	let adapter = "";
	if (path.startsWith("poe1://") || path.startsWith("poe2://")) {
		adapter = path.substring(0, 4);
		path = path.substring(7);
	}

	let normalized = path.toLowerCase().replace(/^\/+/g, "").replace(/\/+$/g, "");

	if (adapter) {
		return [adapter, normalized]
	} else if (normalized.startsWith("poe1/") || normalized.startsWith("poe2/")) {
		return [normalized.substring(0, 4), normalized.substring(5)];
	} else {
		return ["poe1", normalized];
	}
}

async function handleRequest(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
	const url = new URL(request.url);
	const route = url.pathname.split("/")[1];
	console.log(route, url.pathname)
	if (route === "files") {
		const operation = url.searchParams.get("q") || url.pathname.split("/")[2];
		const [adapter, path] = normalizePath(url.searchParams.get("path"));
		console.log("operation:", operation, 'param:', url.searchParams.get("path"), "path:", path, "adapter:", adapter);

		if (operation === "preview" || operation === "download") {
			// go to show_file below
		} else if (operation === "search") {
			console.log("searching for files with filter:", url.searchParams.get("filter"), "in path:", path);
			const files = await search_files(adapter, env, url.searchParams.get("filter") || "", path);
			return processIndexResponse({storages, adapter, files}, new URL(request.url), env);
		} else {
			const files = await ls(path, adapter, env);
			return processIndexResponse({storages, adapter, files}, new URL(request.url), env);
		}
	} else if (route === "version" && !url.searchParams.has("live")) {
		const poe = url.searchParams.get("poe");
		return new Response(await current_version(poe || "1", env));
	} else if (route === "version") {
		const poe = url.searchParams.get("poe");
		const cache = caches.default;
		const cacheKey = new Request(url.toString(), request);
		let response = await cache.match(cacheKey);
		if (!response) {
			const res = await env.INDEX.fetch("http://index/check-version?poe=" + poe);
			const version = await res.text();
			response = new Response(version, {
				headers: {
					"Cache-Control": "public, max-age=60",
				}
			});
			ctx.waitUntil(cache.put(cacheKey, response.clone()));
		}
		return response;
	}

	if (request.headers.has("if-modified-since")) {
		// requests are keyed by version, so it's unlikely for backing data to change
		return new Response(null, {status: 304});
	}

	const [adapter, path] = normalizePath(url.pathname);
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
