import { fromMarkdown } from "mdast-util-from-markdown";
import { gfmFromMarkdown } from "mdast-util-gfm";
import { gfm } from "micromark-extension-gfm";

/**
 * Split a Markdown body into its top-level blocks, keeping the exact source
 * text of each. The on-page editor maps these 1:1 onto the rendered DOM's
 * top-level elements so that an edit to one paragraph only re-serializes that
 * paragraph — every untouched block goes back to disk byte-for-byte.
 *
 * Nodes that render nothing (link reference definitions, HTML comments) are
 * carried as a `trailer` on the block before them. `lead` is anything before
 * the first rendering block.
 *
 * @param {string} body
 * @returns {{ lead: string, blocks: Array<{ src: string, trailer: string, type: string }> }}
 */
export function splitBlocks(body) {
  const tree = fromMarkdown(body, {
    extensions: [gfm()],
    mdastExtensions: [gfmFromMarkdown()],
  });

  const rendering = tree.children.filter((node) => rendersToDom(node));
  const blocks = [];

  for (let i = 0; i < rendering.length; i++) {
    const node = rendering[i];
    const next = rendering[i + 1];
    const start = node.position.start.offset;
    const end = node.position.end.offset;
    const trailerEnd = next ? next.position.start.offset : body.length;
    blocks.push({
      type: node.type,
      src: body.slice(start, end).replace(/\s+$/, ""),
      trailer: body.slice(end, trailerEnd).trim(),
    });
  }

  const lead = rendering.length ? body.slice(0, rendering[0].position.start.offset).trim() : body.trim();
  return { lead, blocks };
}

function rendersToDom(node) {
  if (node.type === "definition" || node.type === "footnoteDefinition") return false;
  if (node.type === "html") {
    // Comments (and nothing but comments) don't produce elements.
    return node.value.replace(/<!--[\s\S]*?-->/g, "").trim() !== "";
  }
  return true;
}
