import { createRequire } from "node:module";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { splitBlocks } from "./blocks.js";

/**
 * Live rendering for the Markdown tab: the draft body is split with the same
 * `splitBlocks` the client's block map comes from, and each non-island block is
 * rendered to HTML with Astro's own Markdown pipeline (`@astrojs/markdown-remark`,
 * configured with the project's `markdown` options) so the preview matches what
 * Astro renders. Islands (MDX components, raw HTML) come back as `html: ""`; the
 * client keeps their current DOM.
 *
 * `@astrojs/markdown-remark` is a dependency of astro, not of astro-float: it's
 * resolved from the project's astro install so the versions always agree.
 *
 * @typedef {{ type: string, island: boolean, html: string }} RenderedBlock
 */

/** Link reference definitions (`[label]: url`) — they render nothing, but the block that uses them needs them in scope. */
const DEFINITION_LINE = /^ {0,3}\[(?!\^)[^\]]+\]:[ \t]*\S.*$/gm;
/** `<img src="...">` with a relative path: Astro would import it; the preview points at Vite's file server instead. */
const IMG_SRC = /(<img\b[^>]*?\ssrc=")([^"]+)(")/g;

/**
 * @param {{ root: string, markdown?: Record<string, unknown>, logger?: { warn(msg: string): void } }} ctx
 */
export function createBlockRenderer(ctx) {
  /** @type {Promise<import('@astrojs/markdown-remark').MarkdownProcessor> | null} */
  let processor = null;

  const getProcessor = () => {
    processor ??= loadMarkdownRemark(ctx.root)
      .then((mod) => mod.createMarkdownProcessor(ctx.markdown ?? {}))
      .catch((err) => {
        processor = null;
        throw err;
      });
    return processor;
  };

  return {
    /**
     * @param {string} body
     * @param {{ mdx: boolean, absDir: string }} entry
     * @returns {Promise<RenderedBlock[]>}
     */
    async render(body, { mdx, absDir }) {
      const { lead, blocks } = splitBlocks(body, { mdx });
      const definitions = collectDefinitions(lead, blocks);
      const md = await getProcessor();
      return Promise.all(
        blocks.map(async (block) => {
          if (block.island) return { type: block.type, island: true, html: "" };
          const src = definitions ? `${block.src}\n\n${definitions}` : block.src;
          const { code } = await md.render(src);
          return { type: block.type, island: false, html: previewImages(code, absDir) };
        }),
      );
    },
  };
}

/** Every `[label]: url` line in the lead and the trailers, so `[text][label]` resolves in any block. */
function collectDefinitions(lead, blocks) {
  const lines = [];
  for (const text of [lead, ...blocks.map((b) => b.trailer)]) {
    if (!text) continue;
    for (const m of text.matchAll(DEFINITION_LINE)) lines.push(m[0]);
  }
  return lines.join("\n");
}

/** Point relative image sources at the entry's directory through Vite's `/@fs/` route. */
function previewImages(html, absDir) {
  if (!absDir || !html.includes("<img")) return html;
  return html.replace(IMG_SRC, (whole, open, src, close) => {
    if (/^(?:[a-z][a-z0-9+.-]*:|\/|#|data:)/i.test(src)) return whole;
    const rel = src.replace(/^\.\//, "");
    return `${open}/@fs${encodeURI(path.posix.join(absDir, rel))}${close}`;
  });
}

/**
 * Import `@astrojs/markdown-remark` from the astro the project uses. Resolution
 * goes root → astro → markdown-remark so pnpm's isolated layout works too.
 */
async function loadMarkdownRemark(root) {
  let astroEntry;
  try {
    astroEntry = createRequire(path.join(root, "package.json")).resolve("astro");
  } catch {
    // The project doesn't list astro directly (unusual): fall back to the copy next to astro-float.
    astroEntry = import.meta.resolve("astro");
    if (astroEntry.startsWith("file:")) astroEntry = decodeURIComponent(new URL(astroEntry).pathname);
  }
  const file = createRequire(astroEntry).resolve("@astrojs/markdown-remark");
  return import(pathToFileURL(file).href);
}
