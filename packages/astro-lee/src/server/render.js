import path from "node:path";
import { importFromAstro } from "./astro-deps.js";
import { renderBlocks } from "../shared/render-blocks.js";

/**
 * Live rendering for the Markdown tab: the draft body is split with the same
 * `splitBlocks` the client's block map comes from, and each non-island block is
 * rendered to HTML with Astro's own Markdown pipeline, configured with the
 * project's `markdown` options, so the preview matches what Astro renders.
 * Islands (MDX components, raw HTML) come back as `html: ""`; the client keeps
 * their current DOM.
 *
 * Which pipeline depends on the Astro version, found by feature detection:
 *
 * - Astro 6+: `config.markdown.processor` (unified or Sätteri, or whatever the
 *   project set) exposes `createRenderer(shared)`, exactly what Astro's own
 *   `.md` plugin calls. Astro 7 no longer installs `@astrojs/markdown-remark`.
 * - Astro 5: `@astrojs/markdown-remark`'s `createMarkdownProcessor`, resolved
 *   from the project's astro install so the versions always agree.
 *
 * @typedef {{ type: string, island: boolean, html: string }} RenderedBlock
 * @typedef {{ render(content: string, opts?: { fileURL?: URL }): Promise<{ code: string }> }} Renderer
 */

/** `<img src="...">` with a relative path: Astro would import it; the preview points at Vite's file server instead. */
const IMG_SRC = /(<img\b[^>]*?\ssrc=")([^"]+)(")/g;
/**
 * Astro's image marker: the Markdown pipeline (remark's `rehype-images`, Sätteri's
 * image marker) strips `src` and leaves `__ASTRO_IMAGE_="{json}"` for Astro's `.md`
 * plugin to turn into an `astro:assets` import. The preview has no build step, so
 * it's turned back into a plain `<img>` here.
 */
const IMG_MARKER = /<img\b([^>]*?)\s__ASTRO_IMAGE_="([^"]*)"([^>]*)>/g;

/**
 * @param {{ root: string, markdown?: Record<string, unknown>, logger?: { warn(msg: string): void } }} ctx
 */
export function createBlockRenderer(ctx) {
  /** @type {Promise<Renderer> | null} */
  let renderer = null;

  const getRenderer = () => {
    renderer ??= createRenderer(ctx).catch((err) => {
      renderer = null;
      throw err;
    });
    return renderer;
  };

  return {
    /**
     * @param {string} body
     * @param {{ mdx: boolean, absDir: string }} entry
     * @returns {Promise<RenderedBlock[]>}
     */
    async render(body, { mdx, absDir }) {
      const md = await getRenderer();
      return renderBlocks(body, async (src) => previewImages((await md.render(src)).code, absDir), { mdx });
    },
  };
}

/** Point relative image sources at the entry's directory through Vite's `/@fs/` route. */
function previewImages(html, absDir) {
  if (!absDir || !html.includes("<img")) return html;
  if (html.includes("__ASTRO_IMAGE_")) {
    html = html.replace(IMG_MARKER, (whole, before, json, after) => {
      let props;
      try {
        props = JSON.parse(json.replace(/&(?:#x22|quot);/g, '"').replace(/&(?:#x27|apos);/g, "'").replace(/&amp;/g, "&"));
      } catch {
        return whole;
      }
      if (!props || typeof props.src !== "string") return whole;
      const attrs = [];
      for (const [key, value] of Object.entries(props)) {
        if (key === "index" || key === "inferSize" || value == null || value === false) continue;
        if (!/^[a-zA-Z_:][\w:.-]*$/.test(key)) continue;
        attrs.push(`${key}="${String(value).replace(/&/g, "&amp;").replace(/"/g, "&quot;")}"`);
      }
      return `<img${before}${attrs.length ? " " + attrs.join(" ") : ""}${after}>`;
    });
  }
  return html.replace(IMG_SRC, (whole, open, src, close) => {
    if (/^(?:[a-z][a-z0-9+.-]*:|\/|#|data:)/i.test(src)) return whole;
    const rel = src.replace(/^\.\//, "");
    return `${open}/@fs${encodeURI(path.posix.join(absDir, rel))}${close}`;
  });
}

/**
 * The project's Markdown renderer. `markdown.processor` (Astro 6+) wins; the
 * `shared` options handed to it are the cross-cutting ones Astro's `.md` plugin
 * passes (`image`, `syntaxHighlight`, `shikiConfig`, …), never the processor
 * itself. Without a processor (Astro 5) it's `@astrojs/markdown-remark`.
 *
 * @param {{ root: string, markdown?: Record<string, unknown>, logger?: { debug?(msg: string): void } }} ctx
 * @returns {Promise<Renderer>}
 */
async function createRenderer(ctx) {
  const { processor, ...shared } = ctx.markdown ?? {};
  if (processor && typeof processor === "object" && typeof (/** @type {any} */ (processor).createRenderer) === "function") {
    ctx.logger?.debug?.(`render: using markdown.processor "${/** @type {any} */ (processor).name ?? "custom"}"`);
    return /** @type {any} */ (processor).createRenderer(shared);
  }
  ctx.logger?.debug?.("render: using @astrojs/markdown-remark");
  const mod = await importFromAstro(ctx.root, "@astrojs/markdown-remark");
  return mod.createMarkdownProcessor(shared);
}
