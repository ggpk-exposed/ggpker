import qs from "qs";
import { crop, index, is_dir } from "./utils";

export async function show_dir(path: string, adapter: string, version: string, env: Env): Promise<Response> {
  const result = await index("index", env.INDEX, path, adapter);
  const html = `<!DOCTYPE html>
<body>
  <h1>${escape(path)}</h1>
${result.files
  .sort((l, r) => (is_dir(l) !== is_dir(r) ? is_dir(r) - is_dir(l) : l.basename.localeCompare(r.basename)))
  .map((f) =>
    f.sprite
      ? `
  <p>
    ${f.basename}
    (<a href="${escape(env.IMAGES)}/${escape(version)}/${escape(f.sprite.sheet)}?format=png&${escape(
          qs.stringify(crop(f.sprite))
        )}">png</a>)
  </p>`
      : `
  <p>
    <a href="/${escape(version)}/${escape(f.path)}${is_dir(f, "/") || "?" + escape(qs.stringify(f))}">
      ${escape(f.basename)}${is_dir(f, "/", "")}
    </a>${
      !f.basename.endsWith(".dds")
        ? ""
        : `
    (<a href="${escape(env.IMAGES)}/${escape(version)}/${escape(f.path)}?format=png&${escape(qs.stringify(f))}">png</a>)`
    }
  </p>`
  )
  .join("")}
</body>`;

  return new Response(html, {
    headers: {
      "content-type": "text/html;charset=UTF-8",
      "cache-control": "public, max-age=2409962",
    },
  });
}
export function escape(html: string) {
  return html.replace(/[^0-9A-Za-z ]/g, (c) => "&#" + c.charCodeAt(0) + ";");
}
