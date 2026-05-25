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
	return path.toLowerCase().replace(/^\/+/g, "").replace(/\/+$/g, "");
}

async function handleRequest(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
	const url = new URL(request.url);
	let path = url.pathname;
	const route = path.split("/")[1];
	let adapter: Storage;
	if (route === "files") {
		const operation = url.searchParams.get("q") || path.split("/")[2];
		path = normalizePath(url.searchParams.get("path"));
		adapter = guess_db(url.searchParams.get("adapter"));
		console.log("operation:", operation, "path:", path);

		if (operation === "preview") {
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
		const adapter = guess_db(poe === "1" ? "poe1" : "poe2");
		return new Response(await current_version(adapter, env));
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
	} else if (is_db(route)) {
		adapter = route;
		path = normalizePath(path.split(adapter + "/")[1] || "");
	} else {
		console.log("unrecognised route", route);
		return new Response(null, Response.redirect(env.BROWSER));
	}

	if (request.headers.has("if-modified-since")) {
		// requests are keyed by version, so it's unlikely for backing data to change
		return new Response(null, {status: 304});
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
