import { icon, type IconName } from "./icons";
import { refreshTooltip } from "./tooltip";

/**
 * Small page-side helpers for the body:
 *
 * - `RegionControl` is the quiet copy / source control tucked inside the
 *   top-right corner of the body's wash.
 * - `SelectionBubble` is the bold / italic / link bubble for a text selection.
 *
 * Both live in `document.body`, never inside the editable prose.
 */

function makeButton(iconName: IconName | null, label: string, onClick: (e: MouseEvent) => void, text?: string): HTMLButtonElement {
  const b = document.createElement("button");
  b.type = "button";
  if (iconName) b.appendChild(icon(iconName, 14));
  if (text) b.appendChild(Object.assign(document.createElement("span"), { textContent: text }));
  b.setAttribute("data-tip", label);
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

// ---- body control (copy / source) ------------------------------------------------------

export interface RegionActions {
  /** The body's Markdown, for the clipboard. */
  copy(): string;
  /** Flip between the rendered prose and the in-page Markdown textarea. */
  toggleSource(): void;
  isSource(): boolean;
  /** A save is running as part of leaving source view. */
  busy(): boolean;
  /** The last attempt to leave source view failed; shown next to a Discard escape hatch. */
  error(): string | null;
  discard(): void;
}

/**
 * Copy / Source for the body: two quiet icons inside the top-right corner of
 * the wash, part of it rather than floating over it. Shown while the body has
 * the caret or the pointer (the wash's own conditions), fading with it; pinned
 * inside the visible part of the region when its corner scrolls off.
 */
export class RegionControl {
  private el: HTMLElement | null = null;
  private target: HTMLElement | null = null;
  private actions: RegionActions | null = null;
  private hideTimer: number | undefined;
  private visible = false;

  show(target: HTMLElement, actions: RegionActions) {
    window.clearTimeout(this.hideTimer);
    if (this.target !== target) this.unbindTarget();
    this.target = target;
    this.actions = actions;
    target.addEventListener("pointerenter", this.paint);
    target.addEventListener("pointerleave", this.paint);
    this.render();
  }

  /** The pointer is on the control, which sits outside the body element: keep the body's wash on. */
  private onEnter = () => {
    this.target?.setAttribute("data-float-hover", "");
    this.paint();
  };

  private onLeave = () => {
    this.target?.removeAttribute("data-float-hover");
    this.paint();
    this.scheduleHide(); // unless the body still has the pointer or the caret
  };

  private unbindTarget() {
    const t = this.target;
    if (!t) return;
    t.removeAttribute("data-float-hover");
    t.removeEventListener("pointerenter", this.paint);
    t.removeEventListener("pointerleave", this.paint);
  }

  /**
   * An opaque surface the colour of the wash: the page's effective background
   * (first ancestor with a painted one) with the wash's tint of the text colour
   * over it, so the label never lets the prose bleed through.
   */
  private paint = () => {
    if (!this.el || !this.target) return;
    const t = this.target;
    const fg = parseColor(getComputedStyle(t).color) ?? { r: 0, g: 0, b: 0, a: 1 };
    const over = t.matches(":hover") || t.hasAttribute("data-float-hover");
    const tint = over ? 0.045 : 0.025;
    const bg = pageBackground(t);
    const mix = (k: "r" | "g" | "b") => Math.round(bg[k] * (1 - tint) + fg[k] * tint);
    this.el.style.background = `rgb(${mix("r")}, ${mix("g")}, ${mix("b")})`;
  };

  /** Re-draw with the same target (source / busy / error state changed). */
  refresh() {
    if (this.target && this.actions && this.visible) this.render();
  }

  get shown() {
    return this.visible;
  }

  /** Hide after a beat — unless the pointer or the focus is still on the region or the control itself. */
  scheduleHide() {
    window.clearTimeout(this.hideTimer);
    this.hideTimer = window.setTimeout(() => {
      const t = this.target;
      if (this.actions?.isSource()) return; // in source view the control is the way back
      if (this.el?.contains(document.activeElement) || this.el?.matches(":hover")) return;
      if (t && (t.matches(":hover") || t === document.activeElement || t.contains(document.activeElement))) return;
      this.hide();
    }, 120);
  }

  hide() {
    window.clearTimeout(this.hideTimer);
    this.unbindTarget();
    this.target = null;
    this.actions = null;
    this.visible = false;
    this.el?.removeAttribute("data-show");
  }

  /**
   * Edit off: take the element out of the page. Left behind, it would sit
   * there unstyled once the page stylesheet is gone, and fade out in plain
   * view when the next Edit on brings the stylesheet back.
   */
  dispose() {
    this.hide();
    if (!this.el) return;
    window.removeEventListener("scroll", this.reposition, true);
    window.removeEventListener("resize", this.reposition);
    this.el.remove();
    this.el = null;
  }

  reposition = () => {
    if (!this.el || !this.visible || !this.target) return;
    if (!this.target.isConnected) {
      this.hide();
      return;
    }
    const r = this.target.getBoundingClientRect();
    const hgt = this.el.offsetHeight || 28;
    // Region scrolled out of view entirely: nothing to sit in.
    if (r.bottom < 40 || r.top > window.innerHeight - 40) {
      this.el.style.opacity = "0";
      return;
    }
    this.el.style.opacity = "";
    // Inside the wash's top-right corner (the wash reaches ~14px above and ~18px right of the box),
    // held at the top of the viewport once that corner scrolls off, always flush with the right edge.
    const inset = 8;
    const right = Math.max(inset, window.innerWidth - (r.right + 18) + inset);
    const top = Math.max(r.top - 14 + inset, inset);
    const maxTop = r.bottom + 14 - inset - hgt;
    Object.assign(this.el.style, { right: `${right}px`, top: `${Math.min(top, maxTop)}px` });
  };

  private render() {
    if (!this.el) {
      this.el = document.createElement("div");
      this.el.className = "astro-float-region";
      this.el.addEventListener("pointerenter", this.onEnter);
      this.el.addEventListener("pointerleave", this.onLeave);
      window.addEventListener("scroll", this.reposition, true);
      window.addEventListener("resize", this.reposition);
    }
    // A page swap may have dropped it from the document; put it back — hidden, and painted once
    // that way, so showing it below is a fade-in rather than an instant pop.
    if (!this.el.isConnected) {
      this.el.removeAttribute("data-show");
      document.body.appendChild(this.el);
      void this.el.offsetWidth;
    }
    const el = this.el;
    const actions = this.actions!;
    el.textContent = "";

    const copy = makeButton("copy", "Copy Markdown", () => {
      void navigator.clipboard?.writeText(actions.copy()).then(() => {
        copy.replaceChildren(icon("check", 14));
        copy.setAttribute("data-tip", "Copied");
        refreshTooltip(copy);
        window.setTimeout(() => {
          copy.replaceChildren(icon("copy", 14));
          copy.setAttribute("data-tip", "Copy Markdown");
          refreshTooltip(copy);
        }, 1000);
      });
    });
    el.appendChild(copy);

    const isSource = actions.isSource();
    const busy = actions.busy();
    const error = actions.error();
    // Icon only, always the same size and place; the tooltip says what it does.
    const toggle = makeButton(isSource ? "eye" : "code", busy ? "Saving…" : isSource ? "Back to rendered" : "Edit as Markdown", () => actions.toggleSource());
    toggle.disabled = busy;
    toggle.toggleAttribute("data-on", isSource);
    el.appendChild(toggle);
    if (error && isSource) {
      const note = document.createElement("span");
      note.className = "astro-float-region-error";
      note.append(icon("alert", 13), Object.assign(document.createElement("span"), { textContent: error }));
      const discard = makeButton(null, "Discard the source edits and show the page as it was", () => actions.discard(), "Discard");
      discard.setAttribute("data-danger", "");
      el.append(note, discard);
    }

    this.visible = true;
    el.setAttribute("data-show", "");
    this.paint();
    this.reposition();
  }
}

interface Rgba {
  r: number;
  g: number;
  b: number;
  a: number;
}

function parseColor(color: string): Rgba | null {
  const m = color.match(/rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)(?:[,\s/]+([\d.]+%?))?/);
  if (!m) return null;
  const a = m[4] === undefined ? 1 : m[4].endsWith("%") ? parseFloat(m[4]) / 100 : parseFloat(m[4]);
  return { r: parseFloat(m[1]), g: parseFloat(m[2]), b: parseFloat(m[3]), a };
}

/** The page's painted background behind an element; white or near-black by Float's theme when nothing paints one. */
function pageBackground(el: Element): Rgba {
  for (let node: Element | null = el; node; node = node.parentElement) {
    const c = parseColor(getComputedStyle(node).backgroundColor);
    if (c && c.a >= 0.99) return c;
  }
  return document.documentElement.getAttribute("data-float-theme") === "dark" ? { r: 15, g: 17, b: 20, a: 1 } : { r: 255, g: 255, b: 255, a: 1 };
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
