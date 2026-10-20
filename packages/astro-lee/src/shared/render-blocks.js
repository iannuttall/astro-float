import { splitBlocks } from "../server/blocks.js";

/** Link reference definitions (`[label]: url`) — they render nothing, but the block that uses them needs them in scope. */
const DEFINITION_LINE = /^ {0,3}\[(?!\^)[^\]]+\]:[ \t]*\S.*$/gm;

/**
 * Render a body block by block, split exactly as the editor's block map is
 * (`splitBlocks`). Islands (MDX components, raw HTML) come back as
 * `html: ""`; the client keeps their current DOM.
 *
 * @param {string} body
 * @param {(markdown: string) => Promise<string>} renderMarkdown  the project's Markdown pipeline, to HTML
 * @param {{ mdx?: boolean }} [options]
 * @returns {Promise<Array<{ type: string, island: boolean, html: string }>>}
 */
export async function renderBlocks(body, renderMarkdown, { mdx = false } = {}) {
  const { lead, blocks } = splitBlocks(body, { mdx });
  const definitions = collectDefinitions(lead, blocks);
  return Promise.all(
    blocks.map(async (block) => {
      if (block.island) return { type: block.type, island: true, html: "" };
      const html = await renderMarkdown(definitions ? `${block.src}\n\n${definitions}` : block.src);
      return { type: block.type, island: false, html };
    }),
  );
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
