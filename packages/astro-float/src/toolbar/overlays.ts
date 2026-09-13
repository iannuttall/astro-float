import { icon, type IconName } from "./icons";

/**
 * The selection bubble: bold / italic / link (and H1–H3) for a text selection
 * inside the body. It lives in `document.body`, never inside the editable
 * prose, and sits above the selection so nothing stacks on the words.
 */

function makeButton(iconName: IconName | null, label: string, onClick: (e: MouseEvent) => void, text?: string): HTMLButtonElement {
  const b = document.createElement("button");
  b.type = "button";
  if (iconName) b.appendChild(icon(iconName, 14));
  if (text) b.appendChild(Object.assign(document.createElement("span"), { textContent: text }));
  b.title = label;
  b.setAttribute("aria-label", label);
  // Keep the page selection / focus where it is.
  b.addEventListener("mousedown", (e) => e.preventDefault());
  b.addEventListener("click", (e) => {
    e.preventDefault();
    e.stopPropagation();
    onClick(e);
  });
  return b;
}

// ---- selection bubble ----------------------------------------------------------------

/**
 * H1 / H2 / H3 · bold / italic / link for the current text selection inside a
 * container. Appears above the selection while it's non-collapsed, goes away
 * on click-away.
 */
export class SelectionBubble {
  private el: HTMLElement | null = null;
  private linkMode = false;
  private raf = 0;

  constructor(
    private container: () => HTMLElement | null,
    private allowed: () => boolean,
    private onHeading: (level: 1 | 2 | 3) => void,
  ) {
    document.addEventListener("selectionchange", this.onSelectionChange);
    document.addEventListener("mousedown", this.onMouseDown, true);
  }

  dispose() {
    document.removeEventListener("selectionchange", this.onSelectionChange);
    document.removeEventListener("mousedown", this.onMouseDown, true);
    this.el?.remove();
    this.el = null;
  }

  hide() {
    this.linkMode = false;
    if (this.el) this.el.hidden = true;
  }

  private onMouseDown = (e: MouseEvent) => {
    if (this.el && !this.el.hidden && !this.el.contains(e.target as Node)) this.hide();
  };

  private onSelectionChange = () => {
    cancelAnimationFrame(this.raf);
    this.raf = requestAnimationFrame(() => this.update());
  };

  private currentRange(): Range | null {
    const container = this.container();
    const sel = document.getSelection();
    if (!container || !sel || sel.rangeCount === 0 || sel.isCollapsed) return null;
    const range = sel.getRangeAt(0);
    if (!container.contains(range.commonAncestorContainer)) return null;
    if ((range.commonAncestorContainer as Element).closest?.("[data-float-island]")) return null;
    if (!range.toString().trim()) return null;
    return range;
  }

  private update() {
    if (this.linkMode) return; // typing a URL: leave it alone until applied or cancelled
    const range = this.allowed() ? this.currentRange() : null;
    if (!range) {
      this.hide();
      return;
    }
    this.render(range);
  }

  private render(range: Range) {
    if (!this.el) {
      this.el = document.createElement("div");
      this.el.className = "astro-float-bubble";
    }
    if (!this.el.isConnected) document.body.appendChild(this.el);
    const el = this.el;
    el.textContent = "";

    const anchorEl = range.commonAncestorContainer instanceof Element ? range.commonAncestorContainer : range.commonAncestorContainer.parentElement;
    const inLink = anchorEl?.closest("a") ?? null;
    const inBold = !!anchorEl?.closest("b, strong");
    const inItalic = !!anchorEl?.closest("i, em");
    const heading = anchorEl?.closest("h1, h2, h3")?.tagName ?? "";
    // Headings only make sense on a plain block; inside a list, quote or code the buttons stay out of the way.
    const plainBlock = !anchorEl?.closest("li, blockquote, pre, td, th");
    if (plainBlock) {
      for (const level of [1, 2, 3] as const) {
        const hb = makeButton(`heading${level}`, heading === `H${level}` ? `Back to paragraph` : `Heading ${level}`, () => this.onHeading(level));
        if (heading === `H${level}`) hb.setAttribute("data-on", "");
        el.appendChild(hb);
      }
      const sep = document.createElement("span");
      sep.className = "astro-float-sep";
      el.appendChild(sep);
    }
    const b = makeButton("bold", "Bold (⌘B)", () => document.execCommand("bold"));
    const i = makeButton("italic", "Italic (⌘I)", () => document.execCommand("italic"));
    const link = makeButton("link", inLink ? "Edit link (⌘K)" : "Link (⌘K)", () => this.enterLinkMode(range, inLink?.getAttribute("href") ?? ""));
    if (inBold) b.setAttribute("data-on", "");
    if (inItalic) i.setAttribute("data-on", "");
    if (inLink) link.setAttribute("data-on", "");
    el.append(b, i, link);
    el.hidden = false;
    this.position(range);
  }

  private enterLinkMode(range: Range, current: string) {
    const el = this.el!;
    this.linkMode = true;
    el.textContent = "";
    const input = document.createElement("input");
    input.type = "url";
    input.placeholder = "https://";
    input.value = current || "https://";
    input.setAttribute("aria-label", "Link URL");
    const apply = () => {
      const url = input.value.trim();
      const sel = document.getSelection();
      sel?.removeAllRanges();
      sel?.addRange(range);
      if (url && url !== "https://") document.execCommand("createLink", false, url);
      else if (current) document.execCommand("unlink");
      this.hide();
    };
    input.addEventListener("keyup", (e) => e.stopPropagation());
    input.addEventListener("keydown", (e) => {
      e.stopPropagation();
      if (e.key === "Enter") {
        e.preventDefault();
        apply();
      } else if (e.key === "Escape") {
        e.preventDefault();
        this.hide();
      }
    });
    const ok = makeButton("check", "Apply", apply);
    el.append(input, ok);
    this.position(range);
    input.focus();
    input.select();
  }

  private position(range: Range) {
    const el = this.el!;
    const r = range.getBoundingClientRect();
    const w = el.offsetWidth;
    const hgt = el.offsetHeight;
    const left = Math.max(8, Math.min(r.left + r.width / 2 - w / 2, window.innerWidth - w - 8));
    const above = r.top - hgt - 8;
    const top = above >= 4 ? above : r.bottom + 8;
    el.toggleAttribute("data-below", above < 4);
    Object.assign(el.style, { left: `${left}px`, top: `${top}px` });
  }
}
