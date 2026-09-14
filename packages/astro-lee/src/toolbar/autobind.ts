import type { SourceBlock as ApiBlock } from "./api";

/** A server block plus the plain-text hint `blocks.js` adds for matching rendered elements. */
type SourceBlock = ApiBlock & { text?: string };

/**
 * Zero-attribute binding: find the rendered body and the frontmatter fields on
 * a page that carries no `data-lee-*` markup.
 *
 * - The body is the element whose direct children line up with the server's
 *   top-level source blocks (tag per block type, text per block). When nothing
 *   lines up 1:1 (footnotes, remark wrappers), it is the deepest wrapper whose
 *   text starts with the first block and ends with the last.
 * - A field is the smallest element whose text is the frontmatter value (or a
 *   rendering of a date value), outside the body, site chrome and dev tooling.
 * - A string array (tags) is a run of sibling elements whose texts are the
 *   items in order, each optionally behind a one-character prefix ("#design").
 *
 * Attributes remain overrides: callers look at `[data-lee-body]` and
 * `[data-lee-field]` first. Anything found here gets the same attribute plus
 * `data-lee-auto`, so the rest of the editor needs no second code path and
 * `unmarkAuto()` can take it all back.
 */

/** Dev tooling and site chrome: never a body, never a field. Subtrees are skipped whole. */
const CHROME_SELECTOR =
  "astro-dev-toolbar, [data-lee-host], [class^='lee-'], nav, script, style, template, svg, noscript";
/** Interactive / verbatim elements: nothing inside them is a field. */
const NO_FIELD_SELECTOR = "a, button, input, textarea, select, option, label, code, pre, kbd, samp";
/** Inline children a plain-text field may still contain. */
const INLINE_SELECTOR = "b, i, em, strong, span, br, small, mark, s, u, sub, sup, abbr, wbr";
/** Tags that are content, never the wrapper of the whole body. */
const BLOCK_TAGS = new Set([
  "P", "H1", "H2", "H3", "H4", "H5", "H6", "LI", "PRE", "BLOCKQUOTE", "TABLE", "UL", "OL", "HR", "FIGURE", "IMG", "DL",
]);

const AUTO_ATTR = "data-lee-auto";

/** Collapse whitespace; the strict comparison used for string fields. */
export function normalizeText(text: string) {
  return text.replace(/\s+/g, " ").trim();
}

/**
 * The prefix a chip prints before `item` ("#" in "#design", "# " in "# design"),
 * "" when the chip is the item verbatim, null when the chip isn't this item.
 */
export function chipPrefix(text: string, item: string): string | null {
  text = normalizeText(text);
  item = normalizeText(item);
  if (!item) return null;
  if (text === item) return "";
  if (!text.endsWith(item)) return null;
  const prefix = text.slice(0, -item.length);
  return /^[^\p{L}\p{N}\s] ?$/u.test(prefix) ? prefix : null;
}

/** The prefixes of `els` when their texts are `items` in order (see `chipPrefix`); null otherwise. */
export function matchChips(els: Element[], items: string[]): string[] | null {
  if (!items.length || els.length !== items.length) return null;
  const prefixes: string[] = [];
  for (let i = 0; i < items.length; i++) {
    const prefix = chipPrefix(els[i].textContent ?? "", items[i]);
    if (prefix === null) return null;
    prefixes.push(prefix);
  }
  return prefixes;
}

/** Loose comparison for body text: smartypants punctuation and all whitespace folded away. */
function compact(text: string) {
  return text
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[–—]/g, "-")
    .replace(/-{2,}/g, "-")
    .replace(/…/g, "...")
    .replace(/\s+/g, "");
}

/** `<header>` / `<footer>` outside `<main>` / `<article>` are site chrome, not the entry. */
function isChrome(el: Element) {
  if (el.matches(CHROME_SELECTOR)) return true;
  return (el.tagName === "HEADER" || el.tagName === "FOOTER") && !el.parentElement?.closest("main, article");
}

/** Inside dev tooling, site chrome or an interactive element: never a field. */
export function offLimits(el: Element) {
  for (let node: Element | null = el; node && node !== document.body; node = node.parentElement) if (isChrome(node)) return true;
  return !!el.closest(NO_FIELD_SELECTOR);
}

/** Every element of the page that is not chrome, in document order. */
function* walk(root: Element): Generator<HTMLElement> {
  for (const child of Array.from(root.children)) {
    if (!(child instanceof HTMLElement) || isChrome(child)) continue;
    yield child;
    yield* walk(child);
  }
}

// ---- body ----------------------------------------------------------------------

function tagMatches(type: string, tag: string) {
  switch (type) {
    case "heading":
      return /^H[1-6]$/.test(tag);
    case "paragraph":
      return tag === "P";
    case "list":
      return tag === "UL" || tag === "OL";
    case "code":
      return tag === "PRE";
    case "blockquote":
      return tag === "BLOCKQUOTE";
    case "thematicBreak":
      return tag === "HR";
    case "table":
      return tag === "TABLE";
    default:
      return true;
  }
}

/** How many of `blocks` the element's direct children reproduce (tag and, where known, text); -1 if the count is off. */
function scoreChildren(el: Element, blocks: SourceBlock[]) {
  const children = Array.from(el.children);
  if (children.length !== blocks.length) return -1;
  let score = 0;
  for (let i = 0; i < blocks.length; i++) {
    const block = blocks[i];
    const child = children[i];
    if (block.island) {
      score++;
      continue;
    }
    if (!tagMatches(block.type, child.tagName)) continue;
    if (!block.text || compact(child.textContent ?? "") === compact(block.text)) score++;
  }
  return score;
}

/**
 * The element that wraps the rendered body. Exact alignment with the source
 * blocks wins; among equal scores the smallest (deepest) element wins.
 */
export function findBody(blocks: SourceBlock[]): HTMLElement | null {
  if (!blocks.length) return null;
  let best: { el: HTMLElement; score: number } | null = null;
  for (const el of walk(document.body)) {
    if (BLOCK_TAGS.has(el.tagName)) continue;
    const score = scoreChildren(el, blocks);
    if (score < 0) continue;
    if (!best || score > best.score || (score === best.score && best.el.contains(el))) best = { el, score };
  }
  const need = Math.max(1, Math.ceil(blocks.length * 0.6));
  if (best && best.score >= need) return best.el;
  return findBodyLoosely(blocks);
}

/**
 * No 1:1 match: the deepest wrapper whose text *starts* with the first block's
 * text and *ends* with the last block's. A wrapper that also holds the title
 * (or the site footer) fails at one end, so it can't be the body; a wrapper
 * holding an element bound as a field never is. When the renderer appends
 * something after the last block (footnotes), no wrapper ends with it: the
 * deepest one that starts right and still contains it is the fallback. A
 * first or last block with no text (an image, an island) leaves its end open.
 */
function findBodyLoosely(blocks: SourceBlock[]): HTMLElement | null {
  const texts = blocks.map((b) => compact(b.text ?? ""));
  const anchor = texts.find((t) => t.length >= 8);
  if (!anchor) return null;
  const head = texts[0];
  const tail = texts[texts.length - 1];
  let strict: HTMLElement | null = null;
  let loose: HTMLElement | null = null;
  for (const el of walk(document.body)) {
    if (BLOCK_TAGS.has(el.tagName) || el.children.length < blocks.length) continue;
    if (el.querySelector("[data-lee-field]")) continue;
    const text = compact(el.textContent ?? "");
    if (!text.startsWith(head) || !text.includes(anchor) || !text.includes(tail)) continue;
    if (!loose || loose.contains(el)) loose = el;
    if (text.endsWith(tail) && (!strict || strict.contains(el))) strict = el;
  }
  return strict ?? loose;
}

/** Give an auto-detected body the attribute the rest of the editor keys off. */
export function markBody(el: HTMLElement) {
  el.setAttribute("data-lee-body", "");
  el.setAttribute(AUTO_ATTR, "body");
}

/** Remove the attributes auto-binding added to the current DOM (all of them, or just one kind). */
export function unmarkAuto(kind?: "body" | "field") {
  const selector = kind ? `[${AUTO_ATTR}="${kind}"]` : `[${AUTO_ATTR}]`;
  for (const el of Array.from(document.querySelectorAll<HTMLElement>(selector))) {
    el.removeAttribute(el.getAttribute(AUTO_ATTR) === "body" ? "data-lee-body" : "data-lee-field");
    el.removeAttribute(AUTO_ATTR);
  }
}

// ---- selector memory --------------------------------------------------------------

const MEMORY_PREFIX = "astro-lee:bindings:";
const MEMORY_DEPTH = 6;
const MEMORY_STRIKES = 2;

/**
 * A selector that should find `el` again on a sibling page of the same
 * layout: its id, else a data attribute, else tag + classes up from `el` to
 * the nearest article / main (at most 6 levels). Null unless it is unique.
 */
export function stableSelector(el: HTMLElement): string | null {
  const unique = (sel: string) => {
    try {
      const hits = document.querySelectorAll(sel);
      return hits.length === 1 && hits[0] === el;
    } catch {
      return false;
    }
  };
  const tag = el.tagName.toLowerCase();
  if (el.id && unique(`#${CSS.escape(el.id)}`)) return `#${CSS.escape(el.id)}`;
  for (const attr of Array.from(el.attributes)) {
    if (!attr.name.startsWith("data-") || /^data-(astro|lee)-/.test(attr.name)) continue;
    const sel = `${tag}[${attr.name}="${attr.value.replace(/["\\]/g, "\\$&")}"]`;
    if (unique(sel)) return sel;
  }
  const parts: string[] = [];
  for (let node: HTMLElement | null = el, depth = 0; node && depth < MEMORY_DEPTH; node = node.parentElement, depth++) {
    const root = node.matches("article, main, body");
    let part = node.tagName.toLowerCase();
    if (!root) {
      part += Array.from(node.classList)
        .filter((c) => !/^(astro|lee)-/.test(c))
        .map((c) => `.${CSS.escape(c)}`)
        .join("");
      const parent = node.parentElement;
      if (parent) {
        const sameTag = Array.from(parent.children).filter((s) => s.tagName === node!.tagName);
        const twins = sameTag.filter((s) => s.className === node!.className);
        if (twins.length > 1) part += `:nth-of-type(${sameTag.indexOf(node) + 1})`;
      }
    }
    parts.unshift(part);
    if (root) break;
  }
  const sel = parts.join(" > ");
  return unique(sel) ? sel : null;
}

interface Remembered {
  selector: string;
  fails: number;
}

/**
 * Where a collection's fields sat on the pages we have seen, keyed by field,
 * in localStorage. On a later page of the same collection whose value is
 * empty (or doesn't match any text), the remembered element is the field.
 * An entry that fails twice in a row is forgotten.
 */
export class BindingMemory {
  private map: Record<string, Remembered>;
  private storageKey: string;

  constructor(collection: string) {
    this.storageKey = MEMORY_PREFIX + collection;
    try {
      this.map = JSON.parse(localStorage.getItem(this.storageKey) ?? "{}") ?? {};
    } catch {
      this.map = {};
    }
  }

  get(key: string): string | null {
    return this.map[key]?.selector ?? null;
  }

  /** A field bound by text: note where it was. */
  remember(key: string, el: HTMLElement) {
    const selector = stableSelector(el);
    if (!selector) return;
    if (this.map[key]?.selector !== selector || this.map[key].fails) this.write({ ...this.map, [key]: { selector, fails: 0 } });
  }

  hit(key: string) {
    const entry = this.map[key];
    if (entry?.fails) this.write({ ...this.map, [key]: { ...entry, fails: 0 } });
  }

  miss(key: string) {
    const entry = this.map[key];
    if (!entry) return;
    const next = { ...this.map };
    if (entry.fails + 1 >= MEMORY_STRIKES) delete next[key];
    else next[key] = { ...entry, fails: entry.fails + 1 };
    this.write(next);
  }

  private write(next: Record<string, Remembered>) {
    this.map = next;
    try {
      if (Object.keys(next).length) localStorage.setItem(this.storageKey, JSON.stringify(next));
      else localStorage.removeItem(this.storageKey);
    } catch {
      /* storage full or blocked: memory is a convenience */
    }
  }
}

// ---- fields -----------------------------------------------------------------------

/**
 * Every element that may hold a field, indexed by its normalized text. Built
 * once per bind; `take` keeps an element from being bound twice. Explicitly
 * marked elements and everything under `exclude` (the body) are left out.
 */
export class FieldIndex {
  private byText = new Map<string, HTMLElement[]>();
  private times: HTMLElement[] = [];
  /** Leaf elements that may be one chip of a tag list; a chip may itself be a link. */
  private chips = new Set<HTMLElement>();
  private used = new Set<Element>();

  constructor(exclude: Array<Element | null | undefined>) {
    const skip = exclude.filter((e): e is Element => !!e);
    for (const el of walk(document.body)) {
      if (el.hasAttribute("data-lee-field") || el.hasAttribute("data-lee-body")) continue;
      if (skip.some((s) => s === el || s.contains(el))) continue;
      if (el.querySelector(`:scope > :not(${INLINE_SELECTOR})`)) continue;
      const blocked = el.closest(NO_FIELD_SELECTOR);
      if (!blocked || (blocked === el && el.tagName === "A")) this.chips.add(el);
      if (blocked) continue;
      if (el instanceof HTMLTimeElement && el.dateTime) this.times.push(el);
      const text = normalizeText(el.textContent ?? "");
      if (!text || text.length > 2000) continue;
      const list = this.byText.get(text);
      if (list) list.push(el);
      else this.byText.set(text, [el]);
    }
  }

  /** The smallest unused element whose text is exactly `text` (first in document order among the smallest). */
  find(text: string): HTMLElement | null {
    const list = (this.byText.get(normalizeText(text)) ?? []).filter((el) => !this.used.has(el));
    const leaves = list.filter((el) => !list.some((other) => other !== el && el.contains(other)));
    return leaves[0] ?? null;
  }

  /** The first hit across several renderings of one value (a date in every format we know). */
  findAny(texts: string[]): HTMLElement | null {
    for (const text of texts) {
      const el = this.find(text);
      if (el) return el;
    }
    return null;
  }

  /**
   * The first run of unused sibling elements whose texts are `items` in order
   * (each may print a one-character prefix, "#design"). Returns the chips and
   * their prefixes.
   */
  findGroup(items: string[]): { chips: HTMLElement[]; prefixes: string[] } | null {
    if (!items.length) return null;
    let best: { chips: HTMLElement[]; prefixes: string[] } | null = null;
    for (const first of this.chips) {
      if (this.used.has(first)) continue;
      // Candidates come in document order, so a wrapper of the real chips shows up first; the deepest run wins.
      if (best && !best.chips[0].contains(first)) continue;
      const run: HTMLElement[] = [];
      for (let el: Element | null = first; el && run.length < items.length; el = el.nextElementSibling) {
        if (!(el instanceof HTMLElement) || !this.chips.has(el) || this.used.has(el)) break;
        run.push(el);
      }
      const prefixes = matchChips(run, items);
      if (prefixes) best = { chips: run, prefixes };
    }
    return best;
  }

  /** An unused `<time datetime="…">` for a `YYYY-MM-DD` date. */
  findTime(iso: string): HTMLElement | null {
    return this.times.find((el) => !this.used.has(el) && el.getAttribute("datetime")?.slice(0, 10) === iso) ?? null;
  }

  take(el: HTMLElement, key: string) {
    this.used.add(el);
    el.setAttribute("data-lee-field", key);
    el.setAttribute(AUTO_ATTR, "field");
  }

  /** Bind a chip run as one field: the attribute goes on their common parent, like an explicit override would. */
  takeGroup(chips: HTMLElement[], key: string) {
    for (const el of chips) this.used.add(el);
    const parent = chips[0].parentElement;
    if (parent) this.take(parent, key);
  }
}
