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
 * Each block also carries `text`: the plain text it renders to (no markup,
 * no images), which lets the client find the rendered body on a page that has
 * no `data-lee-body` attribute.
 *
 * @returns {{ lead: string, blocks: Array<{ src: string, trailer: string, type: string, island: boolean, text: string }> }}
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

  const rendering = mergeWrappers(tree.children.filter((node) => rendersToDom(node)), body);
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
      text: plainText(node),
      src: body.slice(start, end).replace(/\s+$/, ""),
      trailer: body.slice(end, trailerEnd).trim(),
    });
  }

  const lead = rendering.length ? body.slice(0, rendering[0].position.start.offset).trim() : body.trim();
  return { lead, blocks };
}

/** A raw-HTML block that is nothing but one opening tag (`<div style="…">`) / one closing tag (`</div>`). */
const OPEN_TAG = /^<([A-Za-z][\w-]*)(?:\s[^<>]*)?>$/;
const CLOSE_TAG = /^<\/([A-Za-z][\w-]*)\s*>$/;
const VOID_TAGS = new Set(["area", "base", "br", "col", "embed", "hr", "img", "input", "link", "meta", "source", "track", "wbr"]);

/**
 * `<div style="…">`, a blank line, Markdown, a blank line, `</div>`: CommonMark
 * parses that as two HTML blocks around ordinary blocks, but it renders as one
 * element wrapping them (rehype-raw re-parses the tags around the inner
 * content). Fold the run into a single raw-HTML block so it lines up with the
 * one DOM node. Lee writes images with a size or alignment this way: the
 * `![alt](./x.png)` inside keeps Astro's asset processing, the wrapper carries
 * the presentation.
 */
function mergeWrappers(nodes, body) {
  const out = [];
  for (let i = 0; i < nodes.length; i++) {
    const node = nodes[i];
    const open = node.type === "html" ? node.value.trim().match(OPEN_TAG) : null;
    const tag = open && !VOID_TAGS.has(open[1].toLowerCase()) && !/\/\s*>$/.test(node.value.trim()) ? open[1].toLowerCase() : null;
    let close = -1;
    if (tag) {
      let depth = 0;
      for (let j = i + 1; j < nodes.length && close < 0; j++) {
        if (nodes[j].type !== "html") continue;
        const value = nodes[j].value.trim();
        if (value.match(OPEN_TAG)?.[1]?.toLowerCase() === tag && !/\/\s*>$/.test(value)) depth++;
        else if (value.match(CLOSE_TAG)?.[1]?.toLowerCase() === tag) {
          if (depth === 0) close = j;
          else depth--;
        }
      }
    }
    if (close < 0) {
      out.push(node);
      continue;
    }
    const start = node.position.start;
    const end = nodes[close].position.end;
    out.push({ type: "html", value: body.slice(start.offset, end.offset), position: { start, end } });
    i = close;
  }
  return out;
}

/** The text a block renders to: text and inline code, minus images, raw HTML and JSX tags. */
function plainText(node) {
  if (node.type === "text" || node.type === "inlineCode") return node.value;
  if (node.type === "code") return node.value;
  if (node.type === "image" || node.type === "imageReference" || node.type === "html") return "";
  if (node.type === "break") return " ";
  if (!Array.isArray(node.children)) return "";
  return node.children.map(plainText).join("");
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
