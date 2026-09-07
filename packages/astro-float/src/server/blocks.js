import { fromMarkdown } from "mdast-util-from-markdown";
import { gfmFromMarkdown } from "mdast-util-gfm";
import { mdxFromMarkdown } from "mdast-util-mdx";
import { gfm } from "micromark-extension-gfm";
import { mdxjs } from "micromark-extension-mdxjs";

/** Block types that render to something the browser can't safely edit as Markdown. */
export const ISLAND_TYPES = new Set(["mdxJsxFlowElement", "html"]);

/**
 * Split a Markdown/MDX body into its top-level blocks, keeping the exact source
 * text of each. The on-page editor maps these 1:1 onto the rendered DOM's
 * top-level elements so that an edit to one paragraph only re-serializes that
 * paragraph — every untouched block goes back to disk byte-for-byte.
 *
 * MDX component blocks and raw HTML blocks are flagged as islands: the client
 * keeps them atomic (move / remove only) and always writes back their source.
 *
 * Nodes that render nothing (link reference definitions, HTML comments, MDX
 * import/export statements) are carried as a `trailer` on the block before
 * them. `lead` is anything before the first rendering block.
 *
 * @param {string} body
 * @param {{ mdx?: boolean }} [options]
 * @returns {{ lead: string, blocks: Array<{ src: string, trailer: string, type: string, island: boolean }> }}
 */
export function splitBlocks(body, { mdx = false } = {}) {
  let tree;
  try {
    tree = fromMarkdown(body, {
      extensions: mdx ? [gfm(), mdxjs()] : [gfm()],
      mdastExtensions: mdx ? [gfmFromMarkdown(), mdxFromMarkdown()] : [gfmFromMarkdown()],
    });
  } catch (err) {
    // MDX with a syntax error: fall back to plain Markdown so the entry still opens.
    if (!mdx) throw err;
    return splitBlocks(body, { mdx: false });
  }

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
      island: isIsland(node),
      src: body.slice(start, end).replace(/\s+$/, ""),
      trailer: body.slice(end, trailerEnd).trim(),
    });
  }

  const lead = rendering.length ? body.slice(0, rendering[0].position.start.offset).trim() : body.trim();
  return { lead, blocks };
}

function isIsland(node) {
  if (ISLAND_TYPES.has(node.type)) return true;
  // `<div class="x">…</div>` on one line parses as a paragraph made only of
  // inline JSX / inline HTML; it renders as markup, not prose.
  if (node.type === "paragraph" && node.children?.length) {
    return node.children.every(
      (c) => c.type === "mdxJsxTextElement" || c.type === "html" || (c.type === "text" && !c.value.trim()),
    );
  }
  return false;
}

function rendersToDom(node) {
  if (node.type === "definition" || node.type === "footnoteDefinition") return false;
  // import/export statements and `{/* comments */}` / expressions don't produce blocks.
  if (node.type === "mdxjsEsm" || node.type === "mdxFlowExpression") return false;
  if (node.type === "html") {
    // Comments (and nothing but comments) don't produce elements.
    return node.value.replace(/<!--[\s\S]*?-->/g, "").trim() !== "";
  }
  return true;
}
