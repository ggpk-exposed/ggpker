import { parse_etag } from ".";
import { File } from "./index-response";

const textDecoder = new TextDecoder("utf-16");

export async function show_file(extractor: string, file: File, req: Request): Promise<Response> {
	if (!file.file_size) {
		console.warn("empty file requested, returning empty response", file);
		return new Response();
	}

	let cdn_url = file.storage;
	if (!cdn_url.endsWith("/")) {
		cdn_url = cdn_url + "/";
	}
	cdn_url = cdn_url + `Bundles2/${file.bundle!.name}.bundle.bin`;

	const headers: HeadersInit = { "content-type": file.mime_type || "application/octet-stream" };

	const block_count = Math.ceil(file.bundle!.size / BLOCK_SIZE);
	const header_size = 59 + block_count * 4;

	const resp = await fetch(cdn_url, { headers: { range: "bytes=0-" + header_size }, cf: { cacheEverything: true } });
	if (req.headers.has("if-none-match") && resp.headers.has("etag")) {
		const matches = parse_etag(req.headers.get("if-none-match")!);
		if (parse_etag(resp.headers.get("etag")!).find((match) => matches.includes(match))) {
			return new Response(null, { status: 304 });
		}
	}
	for (let h of ["last-modified", "etag", "cache-control", "expires", "date"]) {
		if (resp.headers.has(h)) {
			headers[h] = resp.headers.get(h)!;
		}
	}

	const dataview = new DataView(await unwrap(resp));

	const bundle_size = dataview.getInt32(0, true);
	if (bundle_size !== file.bundle!.size) {
		console.warn("unexpected bundle size", bundle_size, "expected", file.bundle!.size);
	}
	let offset = dataview.getInt32(8, true) + 12;
	if (offset !== header_size + 1) {
		console.warn("unexpected header size", offset, "for block count", block_count);
	}

	const first_block = Math.floor(file.bundle_offset! / BLOCK_SIZE);
	const last_block = Math.floor((file.bundle_offset! + file.file_size! - 1) / BLOCK_SIZE);
	type Block = { offset: number; compressed: number; extracted: number; start: number; end: number };
	const blocks: Block[] = [];
	for (let i = 0; i < block_count; i++) {
		const compressed = dataview.getInt32(60 + i * 4, true);
		if (i > last_block) {
			break;
		} else if (i >= first_block) {
			const extracted = Math.min(BLOCK_SIZE, bundle_size - BLOCK_SIZE * i);

			const url = new URL(extractor);
			url.searchParams.set("url", cdn_url);
			url.searchParams.set("offset", String(offset));
			url.searchParams.set("compressed", String(compressed));
			url.searchParams.set("extracted", String(extracted));

			const start = i !== first_block ? 0 : file.bundle_offset! % BLOCK_SIZE;
			const end = i !== last_block ? extracted : (file.bundle_offset! + file.file_size!) % BLOCK_SIZE;

			blocks.push({ offset, compressed, extracted, start, end });
		}
		offset += compressed;
	}

	// free tier has a subrequest limit of 50; fetch multiple blocks per request if more are needed
	// https://developers.cloudflare.com/workers/platform/limits/#worker-to-worker-subrequests
	const n = Math.ceil(blocks.length / 32);
	const groups = blocks.reduce((l, r, i) => {
		i % n ? l[l.length - 1].push(r) : l.push([r]);
		return l;
	}, [] as Block[][]);

	const responses = groups.map((blocks) => {
		const url = new URL(extractor);
		url.searchParams.set("url", cdn_url);
		url.searchParams.set("offset", blocks.map((b) => b.offset).join());
		url.searchParams.set("compressed", blocks.map((b) => b.compressed).join());
		url.searchParams.set("extracted", blocks.map((b) => b.extracted).join());
		const start = blocks[0].start;
		let end = blocks[blocks.length - 1].end;
		const trim_end = end !== blocks[blocks.length - 1].extracted;
		end += (blocks.length - 1) * BLOCK_SIZE;
		const headers = !start && !trim_end ? undefined : { range: `bytes=${start}-${end - 1}` };
		return unwrap(fetch(url, { headers, cf: { cacheEverything: true } }), start, end);
	});

	const result = new Uint8Array(file.file_size!);
	let i = 0;
	for (let r of responses) {
		let buf = new Uint8Array(await r);
		result.set(buf, i);

		i += buf.length;
	}
	if (i !== file.file_size) {
		console.warn("expected", file.file_size, "bytes, got", i);
	}

	if (file.mime_type?.startsWith("text/")) {
		// This should strip the BOM, if one is present
		return new Response(textDecoder.decode(result), { headers });
	} else {
		// both the incoming accept-encoding header and the actual encoding of the outgoing file are modified by cloudflare.
		// just need to add the incoming header to our output headers to enable cf to compress the data
		// https://community.cloudflare.com/t/worker-doesnt-return-gzip-brotli-compressed-data/337644/3
		const encoding = req.headers
			.get("accept-encoding")
			?.split(",")
			?.find((v) => v)
			?.trim();
		if (encoding) {
			headers["content-encoding"] = encoding;
		}
		return new Response(result, { headers });
	}
}

export const BLOCK_SIZE = 0x40000;

export async function unwrap(promise: Response | Promise<Response>, start: number = 0, end?: number) {
	const resp = await promise;
	if (resp.ok) {
		let buf = await resp.arrayBuffer();
		if (start) {
			// Check that range header was honored, otherwise we'll need to do it ourself
			let actual = [0, BLOCK_SIZE];
			const hval = resp.headers.get("content-range");
			if (hval) {
				const match = /bytes (\d+)-(\d+)/.exec(hval);
				if (match?.length != 4) {
					throw `failed to parse content-range header '${hval}' - got ${match}`;
				}
				actual = match.slice(2, 4).map(parseInt);
			}
			if (start !== actual[0]) {
				buf = buf.slice(start - actual[0]);
			}
		}
		if (end && end - start !== buf.byteLength) {
			return buf.slice(0, end - start);
		} else {
			return buf;
		}
	} else {
		const msg = await resp.text();
		console.warn("extractor error", msg, resp);
		throw msg;
	}
}
