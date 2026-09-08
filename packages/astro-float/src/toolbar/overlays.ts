/**
 * Small page-side helpers shared by the body editor and the field bindings:
 *
 * - `RegionControl` is the tiny copy / source toggle that sits just above the
 *   top-right corner of whichever region is being edited.
 * - `SelectionBubble` is the bold / italic / link bubble for a text selection.
 *
 * Overlays live in `document.body`, never inside an editable region, and are
 * positioned above/beside their target so nothing stacks on the words.
 */

const ICON = {
  copy: `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><rect width="14" height="14" x="8" y="8" rx="2" ry="2"/><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/></svg>`,
  check: `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5"/></svg>`,
  source: `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><path d="m16 18 6-6-6-6"/><path d="m8 6-6 6 6 6"/></svg>`,
  eye: `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><path d="M2.062 12.348a1 1 0 0 1 0-.696 10.75 10.75 0 0 1 19.876 0 1 1 0 0 1 0 .696 10.75 10.75 0 0 1-19.876 0"/><circle cx="12" cy="12" r="3"/></svg>`,
  link: `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/></svg>`,
};

function makeButton(html: string, label: string, onClick: (e: MouseEvent) => void): HTMLButtonElement {
  const b = document.createElement("button");
  b.type = "button";
  b.innerHTML = html;
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

// ---- region control -----------------------------------------------------------------

export interface RegionActions {
  /** Return the text to copy for this region (markdown for the body, plain text for a field). */
  copy(): string;
  /** Present only for the body: flip between rendered and in-page source editing. */
  toggleSource?: () => void;
  isSource?: () => boolean;
}

/** Copy / Source control anchored just above the top-right corner of the region being edited. */
export class RegionControl {
  private el: HTMLElement | null = null;
  private target: HTMLElement | null = null;
  private actions: RegionActions | null = null;
  private hideTimer: number | undefined;

  show(target: HTMLElement, actions: RegionActions) {
    window.clearTimeout(this.hideTimer);
    this.target = target;
    this.actions = actions;
    this.render();
  }

  /** Hide after a beat, unless focus moved into the control itself. */
  scheduleHide() {
    window.clearTimeout(this.hideTimer);
    this.hideTimer = window.setTimeout(() => {
      if (this.el?.contains(document.activeElement)) return;
      this.hide();
    }, 120);
  }

  hide() {
    window.clearTimeout(this.hideTimer);
    this.target = null;
    this.actions = null;
    if (this.el) this.el.hidden = true;
  }

  reposition = () => {
    if (!this.el || this.el.hidden || !this.target) return;
    if (!this.target.isConnected) {
      this.hide();
      return;
    }
    const r = this.target.getBoundingClientRect();
    const w = this.el.offsetWidth;
    const hgt = this.el.offsetHeight;
    // Region scrolled out of view entirely: nothing to anchor to.
    if (r.bottom < 40 || r.top > window.innerHeight - 40) {
      this.el.style.opacity = "0";
      return;
    }
    this.el.style.opacity = "";
    const above = r.top - hgt - 6;
    let left: number;
    let top: number;
    if (above >= 4) {
      // Normal case: in the margin above the region's top-right corner, never on the words.
      left = r.right - w;
      top = above;
    } else {
      // The corner is scrolled off; hold at the viewport top, beside the text column when there's room.
      top = 8;
      left = window.innerWidth - r.right >= w + 16 ? r.right + 8 : r.right - w;
    }
    left = Math.max(8, Math.min(left, window.innerWidth - w - 8));
    Object.assign(this.el.style, { left: `${left}px`, top: `${top}px` });
  };

  private render() {
    if (!this.el) {
      this.el = document.createElement("div");
      this.el.className = "astro-float-region";
      document.body.appendChild(this.el);
      window.addEventListener("scroll", this.reposition, true);
      window.addEventListener("resize", this.reposition);
    }
    const el = this.el;
    const actions = this.actions!;
    el.textContent = "";

    const copy = makeButton(ICON.copy, "Copy markdown", () => {
      void navigator.clipboard?.writeText(actions.copy()).then(() => {
        copy.innerHTML = ICON.check;
        window.setTimeout(() => (copy.innerHTML = ICON.copy), 1200);
      });
    });
    el.appendChild(copy);

    if (actions.toggleSource) {
      const isSource = actions.isSource?.() ?? false;
      const toggle = makeButton(isSource ? ICON.eye : ICON.source, isSource ? "Back to the rendered view" : "Edit this region as Markdown", () => actions.toggleSource!());
      toggle.appendChild(Object.assign(document.createElement("span"), { textContent: isSource ? "Rendered" : "Source" }));
      toggle.setAttribute("data-wide", "");
      el.appendChild(toggle);
    }

    el.hidden = false;
    this.reposition();
  }
}

// ---- selection bubble ----------------------------------------------------------------

/**
 * Bold / italic / link for the current text selection inside a container.
 * Appears above the selection while it's non-collapsed, goes away on click-away.
 */
export class SelectionBubble {
  private el: HTMLElement | null = null;
  private linkMode = false;
  private raf = 0;

  constructor(
    private container: () => HTMLElement | null,
    private allowed: () => boolean,
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
      document.body.appendChild(this.el);
    }
    const el = this.el;
    el.textContent = "";

    const inLink = (range.commonAncestorContainer as Element).closest?.("a") ?? range.startContainer.parentElement?.closest("a");
    const b = makeButton("<b>B</b>", "Bold (⌘B)", () => document.execCommand("bold"));
    const i = makeButton("<i>I</i>", "Italic (⌘I)", () => document.execCommand("italic"));
    const link = makeButton(ICON.link, inLink ? "Edit link (⌘K)" : "Link (⌘K)", () => this.enterLinkMode(range, inLink?.getAttribute("href") ?? ""));
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
    const ok = makeButton(ICON.check, "Apply", apply);
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
