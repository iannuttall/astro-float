/**
 * HTML → Markdown for prose that Astro rendered from Markdown (and that the
 * user then edited in place). Scope is deliberately "what remark-rehype emits":
 * headings, paragraphs, lists (incl. GFM task lists), links, images, inline
 * code, fenced code (Shiki output), blockquotes, rules, GFM tables, strong /
 * emphasis / strikethrough, hard breaks. Anything else is passed through as
 * raw HTML, which Markdown tolerates.
 *
 * Only blocks the user actually changed run through this — untouched blocks
 * keep their original source (see editor.ts), so normalization here only
 * affects edited paragraphs.
 */

export interface SerializeContext {
  /** Map an <img src> as found in the DOM back to what belongs in the Markdown. */
  imageSrc: (src: string) => string;
}

const BLOCK_TAGS = new Set([
  "P", "DIV", "H1", "H2", "H3", "H4", "H5", "H6", "UL", "OL", "LI", "BLOCKQUOTE", "PRE", "HR",
  "TABLE", "FIGURE", "SECTION", "ARTICLE", "ASIDE", "HEADER", "FOOTER", "NAV", "DETAILS", "DL",
]);

export function isBlockElement(node: Node): node is HTMLElement {
  return node instanceof HTMLElement && BLOCK_TAGS.has(node.tagName);
}

/** Serialize one top-level node (element or stray text) of the editable container. */
export function blockToMarkdown(node: Node, ctx: SerializeContext): string {
  if (node.nodeType === Node.TEXT_NODE) {
    return finishInline(escapeText(collapse(node.textContent ?? "")));
  }
  if (!(node instanceof HTMLElement)) return "";
  const el = node;

  switch (el.tagName) {
    case "H1": case "H2": case "H3": case "H4": case "H5": case "H6": {
      const level = Number(el.tagName[1]);
      const text = inlineOf(el, ctx).replace(/\s*\n\s*/g, " ").trim();
      return text ? `${"#".repeat(level)} ${text}` : "";
    }
    case "P": case "DIV": case "SECTION": case "ARTICLE": case "ASIDE": case "HEADER": case "FOOTER": case "NAV": {
      if (hasBlockChildren(el)) return childrenBlocks(el, ctx);
      return finishInline(inlineOf(el, ctx));
    }
    case "UL": case "OL":
      return listToMarkdown(el, ctx, 0);
    case "BLOCKQUOTE": {
      const inner = hasBlockChildren(el) ? childrenBlocks(el, ctx) : finishInline(inlineOf(el, ctx));
      return inner.split("\n").map((l) => (l ? `> ${l}` : ">")).join("\n");
    }
    case "PRE":
      return preToMarkdown(el);
    case "HR":
      return "---";
    case "TABLE":
      return tableToMarkdown(el, ctx);
    case "IMG":
      return imageToMarkdown(el as HTMLImageElement, ctx);
    case "FIGURE": {
      const img = el.querySelector("img");
      const caption = el.querySelector("figcaption");
      if (img) {
        const alt = caption ? collapse(caption.textContent ?? "").trim() : img.getAttribute("alt") ?? "";
        return `![${escapeAlt(alt)}](${ctx.imageSrc(img.getAttribute("src") ?? "")})`;
      }
      return rawHtml(el);
    }
    case "BR":
      return "";
    default:
      return rawHtml(el);
  }
}

function childrenBlocks(el: HTMLElement, ctx: SerializeContext): string {
  const out: string[] = [];
  let inlineRun: Node[] = [];
  const flush = () => {
    if (!inlineRun.length) return;
    const wrapper = document.createElement("p");
    for (const n of inlineRun) wrapper.appendChild(n.cloneNode(true));
    const md = finishInline(inlineOf(wrapper, ctx));
    if (md) out.push(md);
    inlineRun = [];
  };
  for (const child of Array.from(el.childNodes)) {
    if (isBlockElement(child)) {
      flush();
      const md = blockToMarkdown(child, ctx);
      if (md) out.push(md);
    } else if (child.nodeType === Node.TEXT_NODE && !(child.textContent ?? "").trim()) {
      continue;
    } else {
      inlineRun.push(child);
    }
  }
  flush();
  return out.join("\n\n");
}

function hasBlockChildren(el: HTMLElement): boolean {
  return Array.from(el.children).some((c) => BLOCK_TAGS.has(c.tagName));
}

// ---- lists --------------------------------------------------------------------

function listToMarkdown(list: HTMLElement, ctx: SerializeContext, depth: number): string {
  const ordered = list.tagName === "OL";
  const start = ordered ? Number(list.getAttribute("start") ?? "1") || 1 : 1;
  const items = Array.from(list.children).filter((c) => c.tagName === "LI") as HTMLElement[];
  const loose = items.some((li) => Array.from(li.children).some((c) => c.tagName === "P"));

  const lines: string[] = [];
  items.forEach((li, i) => {
    const marker = ordered ? `${start + i}. ` : "- ";
    const indent = " ".repeat(marker.length);

    let task = "";
    const checkbox = li.querySelector(':scope > input[type="checkbox"], :scope > p > input[type="checkbox"]') as HTMLInputElement | null;
    if (checkbox) task = checkbox.checked ? "[x] " : "[ ] ";

    const nested: HTMLElement[] = [];
    const own = document.createElement("li");
    for (const child of Array.from(li.childNodes)) {
      if (child instanceof HTMLElement && (child.tagName === "UL" || child.tagName === "OL")) nested.push(child);
      else if (child === checkbox) continue;
      else own.appendChild(child.cloneNode(true));
    }
    own.querySelectorAll('input[type="checkbox"]').forEach((n) => n.remove());

    const content = hasBlockChildren(own) ? childrenBlocks(own, ctx) : finishInline(inlineOf(own, ctx));
    const contentLines = (content || "").split("\n");
    lines.push(marker + task + (contentLines[0] ?? ""));
    for (const l of contentLines.slice(1)) lines.push(l ? indent + l : "");

    for (const sub of nested) {
      const subMd = listToMarkdown(sub, ctx, depth + 1);
      if (!subMd) continue;
      if (loose) lines.push("");
      for (const l of subMd.split("\n")) lines.push(l ? indent + l : "");
    }
    if (loose && i < items.length - 1) lines.push("");
  });

  return lines.join("\n").replace(/\n{3,}/g, "\n\n");
}

// ---- code ---------------------------------------------------------------------

function preToMarkdown(pre: HTMLElement): string {
  const code = pre.querySelector("code") ?? pre;
  const lang =
    pre.getAttribute("data-language") ??
    (code.className.match(/language-([\w+-]+)/)?.[1] ?? pre.className.match(/language-([\w+-]+)/)?.[1] ?? "");
  const text = preText(code).replace(/\n$/, "");
  const longest = Math.max(2, ...Array.from(text.matchAll(/`+/g)).map((m) => m[0].length));
  const fence = "`".repeat(longest + 1);
  return `${fence}${lang}\n${text}\n${fence}`;
}

/** textContent, except <br> (which the browser inserts on Enter) counts as a newline. */
function preText(node: Node): string {
  let out = "";
  for (const child of Array.from(node.childNodes)) {
    if (child.nodeType === Node.TEXT_NODE) out += child.textContent ?? "";
    else if (child instanceof HTMLElement && child.tagName === "BR") out += "\n";
    else if (child instanceof HTMLElement && (child.tagName === "DIV" || child.tagName === "P")) out += preText(child) + "\n";
    else out += preText(child);
  }
  return out;
}

// ---- tables -------------------------------------------------------------------

function tableToMarkdown(table: HTMLElement, ctx: SerializeContext): string {
  const rows = Array.from(table.querySelectorAll("tr"));
  if (!rows.length) return rawHtml(table);
  const cellsOf = (tr: Element) =>
    Array.from(tr.children).map((c) => inlineOf(c as HTMLElement, ctx).replace(/\s*\n\s*/g, " ").replace(/\|/g, "\\|").trim());
  const header = cellsOf(rows[0]);
  const aligns = Array.from(rows[0].children).map((c) => {
    const a = (c.getAttribute("align") ?? (c as HTMLElement).style.textAlign ?? "").toLowerCase();
    return a === "center" ? ":---:" : a === "right" ? "---:" : a === "left" ? ":---" : "---";
  });
  const body = rows.slice(1).map(cellsOf);
  const width = Math.max(header.length, ...body.map((r) => r.length));
  const pad = (r: string[]) => [...r, ...Array(Math.max(0, width - r.length)).fill("")];
  const line = (r: string[]) => `| ${pad(r).join(" | ")} |`;
  return [line(header), line(pad(aligns)), ...body.map(line)].join("\n");
}

// ---- inline -------------------------------------------------------------------

function inlineOf(el: Node, ctx: SerializeContext): string {
  let out = "";
  const kids = Array.from(el.childNodes);
  kids.forEach((node, i) => {
    if (node.nodeType === Node.TEXT_NODE) {
      out += escapeText(collapse(node.textContent ?? ""));
      return;
    }
    if (!(node instanceof HTMLElement)) return;
    const isLast = i === kids.length - 1;
    switch (node.tagName) {
      case "STRONG": case "B":
        out += wrap(inlineOf(node, ctx), "**");
        break;
      case "EM": case "I":
        out += wrap(inlineOf(node, ctx), "*");
        break;
      case "DEL": case "S": case "STRIKE":
        out += wrap(inlineOf(node, ctx), "~~");
        break;
      case "CODE":
        out += codeSpan(node.textContent ?? "");
        break;
      case "A": {
        const href = node.getAttribute("href") ?? "";
        const title = node.getAttribute("title");
        const text = inlineOf(node, ctx).trim();
        if (!href) out += text;
        else if (!text) out += `<${href}>`;
        else out += `[${text}](${href}${title ? ` "${title.replace(/"/g, '\\"')}"` : ""})`;
        break;
      }
      case "IMG":
        out += imageToMarkdown(node as HTMLImageElement, ctx);
        break;
      case "BR":
        // A trailing <br> is just the browser's caret placeholder.
        if (!isLast) out += "  \n";
        break;
      case "SPAN": case "FONT": case "U":
        out += inlineOf(node, ctx);
        break;
      case "INPUT":
        break;
      default:
        if (BLOCK_TAGS.has(node.tagName)) out += "\n\n" + blockToMarkdown(node, ctx) + "\n\n";
        else out += rawHtml(node);
    }
  });
  return out;
}

function imageToMarkdown(img: HTMLImageElement, ctx: SerializeContext): string {
  const src = ctx.imageSrc(img.getAttribute("src") ?? "");
  const title = img.getAttribute("title");
  return `![${escapeAlt(img.getAttribute("alt") ?? "")}](${src}${title ? ` "${title.replace(/"/g, '\\"')}"` : ""})`;
}

/** `**text**` with surrounding whitespace hoisted outside the delimiters. */
function wrap(inner: string, delim: string): string {
  const lead = inner.match(/^\s*/)?.[0] ?? "";
  const trail = inner.match(/\s*$/)?.[0] ?? "";
  const core = inner.trim();
  return core ? `${lead}${delim}${core}${delim}${trail}` : inner;
}

function codeSpan(text: string): string {
  const longest = Math.max(0, ...Array.from(text.matchAll(/`+/g)).map((m) => m[0].length));
  const fence = "`".repeat(longest + 1);
  const pad = text.startsWith("`") || text.endsWith("`") || (text.startsWith(" ") && text.endsWith(" ") && text.trim()) ? " " : "";
  return `${fence}${pad}${text}${pad}${fence}`;
}

/**
 * Whitespace as the browser would render it: runs collapse to one space, and
 * the NBSPs contenteditable sprinkles in while you type become plain spaces.
 * Typographic quotes go back to ASCII — Astro's smartypants turns `'`/`"`
 * into `’`/`“”` at render time, so the straight forms round-trip to the same page.
 */
function collapse(text: string): string {
  return text.replace(/[\t\n\r \u00a0]+/g, " ").replace(/[‘’]/g, "'").replace(/[“”]/g, '"');
}

function escapeAlt(text: string): string {
  return text.replace(/[\[\]]/g, "\\$&");
}

/** Escape characters that would otherwise be read as Markdown syntax. Intraword `_` is left alone. */
function escapeText(text: string): string {
  return text
    .replace(/\\/g, "\\\\")
    .replace(/[*`\[\]<]/g, "\\$&")
    .replace(/(^|[^A-Za-z0-9])_/g, "$1\\_")
    .replace(/_(?![A-Za-z0-9])/g, "\\_")
    .replace(/~~/g, "\\~~");
}

/** Trim, drop blank runs, and escape line-leading block syntax (`# `, `- `, `1. `, `> `). */
function finishInline(md: string): string {
  return md
    .replace(/[ \t]+\n/g, (m) => (m.startsWith("  ") ? "  \n" : "\n"))
    .split("\n")
    .map((line) =>
      line
        .replace(/^(\s*)(#{1,6}\s|[-+*]\s|>|(?:-{3,}|\*{3,}|_{3,})\s*$)/, "$1\\$2")
        .replace(/^(\s*\d+)([.)])(\s)/, "$1\\$2$3"),
    )
    .join("\n")
    .replace(/^\s+|\s+$/g, "");
}

function rawHtml(el: HTMLElement): string {
  const clone = el.cloneNode(true) as HTMLElement;
  clone.removeAttribute("contenteditable");
  return clone.outerHTML;
}
