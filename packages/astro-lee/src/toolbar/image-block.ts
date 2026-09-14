/**
 * An image block is a top-level block that is one picture:
 *
 * - `<p><img></p>` — what Astro renders `![alt](./x.png)` to (the image may
 *   sit inside a link);
 * - that paragraph inside a `<div style="…">` wrapper that carries a width
 *   and an alignment.
 *
 * The wrapper is how a sized or aligned image is written to Markdown: the
 * `![alt](./x.png)` inside keeps Astro's asset processing (a raw `<img>` in
 * `.md` gets none — its relative `src` breaks), the `<div>` carries the
 * presentation, and Astro renders exactly what the page showed. Everything
 * here is DOM-only and pure; the editor decides what to do with it.
 */

export type ImageAlign = "left" | "center" | "right";

export interface ImageLayout {
  /** Percent of the prose width; 100 means "no wrapper" — plain `![alt](./x.png)`. */
  size: number;
  align: ImageAlign;
}

export interface ImageBlock {
  /** The `<div>` carrying width / alignment, or null for a plain image paragraph. */
  wrapper: HTMLElement | null;
  paragraph: HTMLElement;
  img: HTMLImageElement;
}

export const IMAGE_SIZES = [25, 50, 75, 100] as const;

/** The declarations Lee writes on a wrapper; any other one belongs to the site. */
const OWN_DECLARATIONS = new Set(["width", "margin-left", "margin-right"]);

/** The image block `el` is (a top-level `<p>` or wrapper `<div>`), or null. */
export function imageBlockOf(el: Element): ImageBlock | null {
  if (!(el instanceof HTMLElement)) return null;
  if (el.tagName === "P") {
    const img = onlyImage(el);
    return img ? { wrapper: null, paragraph: el, img } : null;
  }
  if (el.tagName === "DIV") {
    if ((el.textContent ?? "").trim()) return null;
    const children = Array.from(el.children);
    if (children.length !== 1 || children[0].tagName !== "P") return null;
    const paragraph = children[0] as HTMLElement;
    const img = onlyImage(paragraph);
    return img ? { wrapper: el, paragraph, img } : null;
  }
  return null;
}

/** The one `<img>` a paragraph holds and nothing else (a link around it is fine). */
function onlyImage(p: HTMLElement): HTMLImageElement | null {
  if ((p.textContent ?? "").trim()) return null;
  const imgs = p.querySelectorAll("img");
  if (imgs.length !== 1) return null;
  for (const child of Array.from(p.children)) {
    if (child.tagName === "IMG") continue;
    if (child.tagName === "A" && child.children.length === 1 && child.children[0].tagName === "IMG") continue;
    return null;
  }
  return imgs[0];
}

/** Width and alignment as the block's wrapper declares them; a plain paragraph is 100% / left. */
export function imageLayoutOf(block: ImageBlock): ImageLayout {
  if (!block.wrapper) return { size: 100, align: "left" };
  const decl = declarations(block.wrapper.getAttribute("style") ?? "");
  const width = decl.get("width")?.match(/^(\d+(?:\.\d+)?)%$/);
  const size = width ? Number(width[1]) : 100;
  const left = decl.get("margin-left") === "auto";
  const right = decl.get("margin-right") === "auto";
  return { size, align: left && right ? "center" : left ? "right" : "left" };
}

/**
 * The wrapper's `style` for a layout (null: none of Lee's), keeping any
 * declaration that isn't Lee's (a site may have added its own). Lee's own
 * are written in one fixed form so an unchanged image never re-serializes
 * differently.
 */
export function imageStyle(layout: ImageLayout | null, current = ""): string {
  const kept = Array.from(declarations(current))
    .filter(([k]) => !OWN_DECLARATIONS.has(k))
    .map(([k, v]) => `${k}:${v}`);
  const mine: string[] = [];
  if (layout && layout.size < 100) {
    mine.push(`width:${layout.size}%`);
    if (layout.align === "center") mine.push("margin-left:auto", "margin-right:auto");
    else if (layout.align === "right") mine.push("margin-left:auto");
  }
  return [...kept, ...mine].join(";");
}

function declarations(style: string): Map<string, string> {
  const map = new Map<string, string>();
  for (const part of style.split(";")) {
    const i = part.indexOf(":");
    if (i < 0) continue;
    const key = part.slice(0, i).trim().toLowerCase();
    const value = part.slice(i + 1).trim();
    if (key) map.set(key, value);
  }
  return map;
}

/**
 * Give an image block a layout in the DOM, exactly as Astro will render it
 * after save: 100% is the bare paragraph, anything else the paragraph inside a
 * `<div style="…">` (with the newlines Astro's render leaves around it). A
 * wrapper the site wrote itself is never taken away, only Lee's declarations
 * on it. Returns the top-level block afterwards — the paragraph or the wrapper.
 */
export function applyImageLayout(block: ImageBlock, layout: ImageLayout): HTMLElement {
  let wrapper = block.wrapper;
  if (layout.size >= 100) {
    if (!wrapper) return block.paragraph;
    const rest = imageStyle(null, wrapper.getAttribute("style") ?? "");
    if (!rest && isLeeWrapper(wrapper)) {
      wrapper.replaceWith(block.paragraph);
      return block.paragraph;
    }
    if (rest) wrapper.setAttribute("style", rest);
    else wrapper.removeAttribute("style");
    return wrapper;
  }
  if (!wrapper) {
    wrapper = document.createElement("div");
    block.paragraph.replaceWith(wrapper);
    wrapper.append("\n", block.paragraph, "\n");
  }
  wrapper.setAttribute("style", imageStyle(layout, wrapper.getAttribute("style") ?? ""));
  return wrapper;
}

/** Nothing on the `<div>` but a style and the editor's own marks: the wrapper Lee writes. */
function isLeeWrapper(el: HTMLElement): boolean {
  return Array.from(el.attributes).every((a) => a.name === "style" || a.name === "contenteditable" || a.name === "draggable" || a.name.startsWith("data-lee-"));
}
