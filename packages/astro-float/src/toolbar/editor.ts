import { blockToMarkdown, type SerializeContext } from "./html-to-md";

export interface SourceBlock {
  type: string;
  src: string;
  trailer: string;
  island?: boolean;
}

export interface BodySource {
  lead: string;
  blocks: SourceBlock[];
}

export interface SaveSnapshot {
  markdown: string;
  html: string;
  keys: string[];
}

export interface PageEditorHooks {
  /** Any DOM change inside the editable body (already debounced to a microtask). */
  onChange(): void;
  /** Image files dropped or pasted onto the body; `range` is where they landed. */
  onFiles(files: File[], range: Range | null): void;
}

const PAGE_STYLE_ID = "astro-float-page-style";
const ISLAND_DRAG_TYPE = "text/x-astro-float-island";
const ISLAND_SELECTOR = "astro-island, iframe, video, [data-float-island]";

const PAGE_STYLE = /* css */ `
[data-float-editing] {
  position: relative;
  outline: none;
  caret-color: currentColor;
  --float-edge: transparent;
}
/* A quiet dashed frame: 1px edges drawn as gradients so the dash/gap rhythm is ours (5px on, 9px off), square corners. */
[data-float-editing]::before {
  content: "";
  position: absolute;
  inset: -16px -18px;
  pointer-events: none;
  background-image:
    repeating-linear-gradient(90deg, var(--float-edge) 0 5px, transparent 5px 14px),
    repeating-linear-gradient(90deg, var(--float-edge) 0 5px, transparent 5px 14px),
    repeating-linear-gradient(180deg, var(--float-edge) 0 5px, transparent 5px 14px),
    repeating-linear-gradient(180deg, var(--float-edge) 0 5px, transparent 5px 14px);
  background-size: 100% 1px, 100% 1px, 1px 100%, 1px 100%;
  background-position: 0 0, 0 100%, 0 0, 100% 0;
  background-repeat: no-repeat;
  transition: background-color 150ms ease;
}
[data-float-editing]:hover { --float-edge: color-mix(in srgb, currentColor 16%, transparent); }
[data-float-editing]:focus { --float-edge: color-mix(in srgb, currentColor 24%, transparent); }
[data-float-editing][data-float-dragging] { --float-edge: color-mix(in srgb, currentColor 55%, transparent); }
[data-float-editing][data-float-dragging]::before { background-color: color-mix(in srgb, currentColor 3%, transparent); }
[data-float-editing] a { cursor: text; }
[data-float-editing] img { cursor: default; }

/* Islands: rendered components / raw HTML. Atomic — no caret, move or remove only. */
[data-float-editing] [data-float-island] { cursor: default; user-select: none; -webkit-user-select: none; }
[data-float-editing] [data-float-island] * { cursor: default; }

/* Frontmatter fields edited in place (title, description, …). */
[data-float-editing-field] { outline: none; caret-color: currentColor; border-radius: 3px; transition: background-color 120ms ease; }
[data-float-editing-field]:hover { background-color: color-mix(in srgb, currentColor 4%, transparent); box-shadow: 0 0 0 4px color-mix(in srgb, currentColor 4%, transparent); }
[data-float-editing-field]:focus { background-color: transparent; box-shadow: none; }
[data-float-editing-field]:empty::before { content: attr(data-float-placeholder); color: color-mix(in srgb, currentColor 35%, transparent); pointer-events: none; }

/* Overlays live in the page, never inside the editable body. */
.astro-float-frame, .astro-float-dropline, .astro-float-bar { position: fixed; z-index: 2000000001; pointer-events: none; box-sizing: border-box; }
.astro-float-frame { border: 1px solid color-mix(in srgb, currentColor 30%, transparent); border-radius: 6px; }
.astro-float-frame[data-selected] { border-color: color-mix(in srgb, currentColor 60%, transparent); border-style: solid; }
.astro-float-dropline { height: 2px; background: #6b7280; border-radius: 1px; }
.astro-float-bar {
  pointer-events: auto;
  display: flex;
  align-items: center;
  gap: 2px;
  padding: 3px;
  background: linear-gradient(180deg, #13151a 0%, rgba(19, 21, 26, 0.92) 100%);
  border: 1px solid #343841;
  border-radius: 9px;
  box-shadow: 0 1px 2px rgba(19, 21, 26, 0.29), 0 4px 4px rgba(19, 21, 26, 0.26), 0 10px 6px rgba(19, 21, 26, 0.15);
  color: #d5d8de;
  font: 12.5px/1 system-ui, -apple-system, sans-serif;
}
.astro-float-bar button {
  all: unset;
  display: grid;
  place-items: center;
  width: 30px;
  height: 30px;
  border-radius: 6px;
  color: #d5d8de;
  cursor: pointer;
}
.astro-float-bar button:hover { background: rgba(255, 255, 255, 0.08); color: #fff; }
.astro-float-bar button:disabled { opacity: 0.3; cursor: default; background: none; }
.astro-float-bar button[data-grip] { cursor: grab; }
.astro-float-bar button[data-danger]:hover { color: #f87171; }
.astro-float-bar .astro-float-sep { width: 1px; height: 18px; background: #343841; margin: 0 2px; }
.astro-float-bar .astro-float-confirm { display: flex; align-items: center; gap: 6px; padding: 0 4px 0 8px; white-space: nowrap; }
.astro-float-bar .astro-float-confirm button { width: auto; height: 26px; padding: 0 9px; font-weight: 500; }
.astro-float-bar .astro-float-confirm button[data-danger] { background: #f87171; color: #13151a; }
.astro-float-bar .astro-float-confirm button[data-danger]:hover { background: #fca5a5; color: #13151a; }
@media (pointer: coarse) { .astro-float-bar button { width: 40px; height: 40px; } .astro-float-bar .astro-float-confirm button { height: 34px; } }
`;

const ICON = {
  up: `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><path d="m18 15-6-6-6 6"/></svg>`,
  down: `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><path d="m6 9 6 6 6-6"/></svg>`,
  grip: `<svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor"><circle cx="9" cy="6" r="1.6"/><circle cx="15" cy="6" r="1.6"/><circle cx="9" cy="12" r="1.6"/><circle cx="15" cy="12" r="1.6"/><circle cx="9" cy="18" r="1.6"/><circle cx="15" cy="18" r="1.6"/></svg>`,
  trash: `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18"/><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"/><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"/></svg>`,
};

/**
 * Makes the rendered Markdown body editable in place and turns it back into
 * Markdown on demand.
 *
 * Fidelity strategy: the body's top-level DOM children are lined up with the
 * top-level source blocks the server parsed. On serialize, blocks whose HTML is
 * unchanged emit their original Markdown verbatim; only changed/new blocks go
 * through the HTML→Markdown serializer. If the two sides don't line up (raw
 * HTML blocks, footnotes, custom remark plugins) we fall back to serializing
 * everything and say so.
 *
 * Islands (MDX components, raw HTML) are matched by identity rather than by
 * HTML, so they can be reordered or removed and still write back their source.
 */
export class PageEditor {
  container: HTMLElement | null = null;
  mapped = false;

  private source: BodySource = { lead: "", blocks: [] };
  private snapshot: Array<{ key: string; block: SourceBlock }> = [];
  private baselineHTML = "";
  private absDir = "";
  private attached = false;
  private observer: MutationObserver | null = null;
  private changeQueued = false;
  private dragDepth = 0;
  private keyCounter = 0;

  // islands
  private selected: HTMLElement | null = null;
  private hovered: HTMLElement | null = null;
  private dragging: HTMLElement | null = null;
  private dropTarget: { block: HTMLElement; before: boolean } | null = null;
  private frame: HTMLElement | null = null;
  private bar: HTMLElement | null = null;
  private dropLine: HTMLElement | null = null;
  private confirming = false;

  constructor(private hooks: PageEditorHooks) {}

  get bound() {
    return this.container !== null;
  }

  static find(): HTMLElement | null {
    return document.querySelector<HTMLElement>("[data-float-body]");
  }

  // ---- lifecycle --------------------------------------------------------------

  /** Point the editor at a container and take a fresh clean baseline. */
  bind(container: HTMLElement, source: BodySource, absDir: string) {
    if (this.attached) this.detach();
    this.container = container;
    this.absDir = absDir.replace(/\/$/, "");
    this.decorateIslands(source);
    this.setBaseline(source);
  }

  /** Fresh clean baseline from the DOM as it is right now. */
  setBaseline(source: BodySource) {
    this.commit(this.snapshotForSave(), source);
  }

  /**
   * What a save should write, plus the DOM state it was derived from. Kept
   * separate from `commit` so keystrokes that land while the request is in
   * flight still count as unsaved afterwards.
   */
  snapshotForSave(): SaveSnapshot {
    return {
      markdown: this.toMarkdown(),
      html: this.container?.innerHTML ?? "",
      keys: this.domBlocks().map((n) => keyOf(n)),
    };
  }

  /** Make a snapshot the new source of truth (call after the server confirmed it). */
  commit(snapshot: SaveSnapshot, source: BodySource) {
    if (!this.container) return;
    this.source = source;
    this.baselineHTML = snapshot.html;
    this.mapped = snapshot.keys.length === source.blocks.length;
    this.snapshot = this.mapped ? snapshot.keys.map((key, i) => ({ key, block: source.blocks[i] })) : [];
  }

  attach() {
    const el = this.container;
    if (!el || this.attached) return;
    this.attached = true;

    if (!document.getElementById(PAGE_STYLE_ID)) {
      const style = document.createElement("style");
      style.id = PAGE_STYLE_ID;
      style.textContent = PAGE_STYLE;
      document.head.appendChild(style);
    }

    if (!el.children.length) el.appendChild(emptyParagraph());
    el.contentEditable = "true";
    el.setAttribute("data-float-editing", "");
    try {
      document.execCommand("defaultParagraphSeparator", false, "p");
    } catch {
      /* not supported */
    }

    el.addEventListener("keydown", this.onKeydown);
    el.addEventListener("keyup", this.onKeyup);
    el.addEventListener("paste", this.onPaste);
    el.addEventListener("click", this.onClick);
    el.addEventListener("mouseover", this.onMouseOver);
    el.addEventListener("mouseleave", this.onMouseLeave);
    el.addEventListener("dragstart", this.onDragStart);
    el.addEventListener("dragenter", this.onDragEnter);
    el.addEventListener("dragover", this.onDragOver);
    el.addEventListener("dragleave", this.onDragLeave);
    el.addEventListener("drop", this.onDrop);
    el.addEventListener("dragend", this.onDragEnd);
    document.addEventListener("click", this.onDocumentClick, true);
    window.addEventListener("scroll", this.reposition, true);
    window.addEventListener("resize", this.reposition);

    this.observer = new MutationObserver(() => this.queueChange());
    this.observer.observe(el, { childList: true, characterData: true, subtree: true, attributes: true });
  }

  /** Stop editing but keep the DOM (and dirty state) exactly as it is. */
  detach() {
    const el = this.container;
    if (!el || !this.attached) return;
    this.attached = false;
    el.contentEditable = "false";
    el.removeAttribute("contenteditable");
    el.removeAttribute("data-float-editing");
    el.removeAttribute("data-float-dragging");
    el.removeEventListener("keydown", this.onKeydown);
    el.removeEventListener("keyup", this.onKeyup);
    el.removeEventListener("paste", this.onPaste);
    el.removeEventListener("click", this.onClick);
    el.removeEventListener("mouseover", this.onMouseOver);
    el.removeEventListener("mouseleave", this.onMouseLeave);
    el.removeEventListener("dragstart", this.onDragStart);
    el.removeEventListener("dragenter", this.onDragEnter);
    el.removeEventListener("dragover", this.onDragOver);
    el.removeEventListener("dragleave", this.onDragLeave);
    el.removeEventListener("drop", this.onDrop);
    el.removeEventListener("dragend", this.onDragEnd);
    document.removeEventListener("click", this.onDocumentClick, true);
    window.removeEventListener("scroll", this.reposition, true);
    window.removeEventListener("resize", this.reposition);
    this.observer?.disconnect();
    this.observer = null;
    this.select(null);
    this.hovered = null;
    this.hideOverlays();
    document.getElementById(PAGE_STYLE_ID)?.remove();
  }

  unbind() {
    this.detach();
    this.container = null;
    this.snapshot = [];
    this.mapped = false;
  }

  // ---- state ---------------------------------------------------------------------

  isDirty() {
    return this.container ? this.container.innerHTML !== this.baselineHTML : false;
  }

  /** Focus the body with the first block selected — a fresh entry's placeholder gets replaced by whatever you type. */
  focusStart() {
    const el = this.container;
    if (!el) return;
    el.focus();
    const first = el.firstElementChild ?? el;
    const range = document.createRange();
    range.selectNodeContents(first);
    const sel = document.getSelection();
    sel?.removeAllRanges();
    sel?.addRange(range);
  }

  /** True while the caret lives in the body (focus, not just a lingering selection). */
  hasFocus() {
    const el = this.container;
    if (!el) return false;
    return document.activeElement === el || el.contains(document.activeElement);
  }

  /** Current body as Markdown. Unchanged blocks reuse their original source; islands always do. */
  toMarkdown(): string {
    if (!this.container) return "";
    const ctx: SerializeContext = { imageSrc: (src) => this.relativeImageSrc(src) };
    const nodes = this.domBlocks();
    const parts: string[] = [];
    if (this.source.lead) parts.push(this.source.lead);

    const matches = new Array<number>(nodes.length).fill(-1);
    if (this.mapped) {
      // Islands match by identity (their key travels with the element when moved) …
      const byKey = new Map<string, number>();
      this.snapshot.forEach((s, j) => {
        if (s.key.startsWith("key:")) byKey.set(s.key, j);
      });
      const restDom: number[] = [];
      nodes.forEach((node, i) => {
        const key = keyOf(node);
        const j = byKey.get(key);
        if (j !== undefined) matches[i] = j;
        else restDom.push(i);
      });
      // … and everything else lines up by content.
      const restSnap = this.snapshot.map((s, j) => j).filter((j) => !this.snapshot[j].key.startsWith("key:"));
      const lcs = alignByLcs(
        restSnap.map((j) => this.snapshot[j].key),
        restDom.map((i) => keyOf(nodes[i])),
      );
      restDom.forEach((i, k) => {
        if (lcs[k] >= 0) matches[i] = restSnap[lcs[k]];
      });
    }

    nodes.forEach((node, i) => {
      const j = matches[i];
      if (j >= 0) {
        const { block } = this.snapshot[j];
        parts.push(block.src);
        if (block.trailer) parts.push(block.trailer);
      } else {
        const md = blockToMarkdown(node, ctx);
        if (md) parts.push(md);
      }
    });
    return parts.join("\n\n").replace(/\n{3,}/g, "\n\n") + "\n";
  }

  /** Insert an image as its own block after the caret's block (or at the end). */
  insertImage(url: string, alt: string, at: Range | null = null) {
    const el = this.container;
    if (!el) return;
    const figure = document.createElement("p");
    const img = document.createElement("img");
    img.src = url;
    img.alt = alt;
    figure.appendChild(img);

    const range = at ?? this.selectionRange();
    const anchor = range ? this.topLevelBlock(range.startContainer) : null;
    if (anchor && anchor.parentNode === el) {
      const isEmptyParagraph = anchor.tagName === "P" && !anchor.textContent?.trim() && !anchor.querySelector("img");
      if (isEmptyParagraph) anchor.replaceWith(figure);
      else anchor.after(figure);
    } else {
      el.appendChild(figure);
    }
    const after = emptyParagraph();
    figure.after(after);
    placeCaret(after);
  }

  // ---- islands -----------------------------------------------------------------------

  /**
   * Mark the DOM blocks that came from component / raw-HTML source as islands.
   * Static attributes only, applied before the baseline is taken so they never
   * count as edits. Without a source map, fall back to DOM heuristics.
   */
  private decorateIslands(source: BodySource) {
    const nodes = this.domBlocks();
    const mapped = nodes.length === source.blocks.length;
    nodes.forEach((node, i) => {
      if (!(node instanceof HTMLElement)) return;
      const isIsland = mapped ? Boolean(source.blocks[i].island) : node.matches(ISLAND_SELECTOR) || node.tagName.includes("-");
      if (!isIsland) {
        node.removeAttribute("data-float-island");
        node.removeAttribute("data-float-key");
        return;
      }
      node.setAttribute("data-float-island", "");
      if (!node.dataset.floatKey) node.dataset.floatKey = `island-${++this.keyCounter}-${Date.now().toString(36)}`;
      node.contentEditable = "false";
      node.draggable = true;
    });
  }

  private islandFrom(target: EventTarget | null): HTMLElement | null {
    if (!(target instanceof Element) || !this.container) return null;
    const island = target.closest<HTMLElement>("[data-float-island]");
    return island && island.parentElement === this.container ? island : null;
  }

  private select(island: HTMLElement | null) {
    if (this.selected === island) return;
    this.selected = island;
    this.confirming = false;
    if (island) document.getSelection()?.removeAllRanges();
    this.renderOverlays();
  }

  private moveIsland(island: HTMLElement, dir: -1 | 1) {
    const sibling = dir < 0 ? island.previousElementSibling : island.nextElementSibling;
    if (!sibling) return;
    if (dir < 0) sibling.before(island);
    else sibling.after(island);
    island.scrollIntoView({ block: "nearest", behavior: "smooth" });
    requestAnimationFrame(this.reposition);
  }

  private removeIsland(island: HTMLElement) {
    const next = island.nextElementSibling ?? island.previousElementSibling;
    island.remove();
    this.select(null);
    if (!this.container?.children.length) this.container?.appendChild(emptyParagraph());
    if (next instanceof HTMLElement && !next.hasAttribute("data-float-island")) placeCaret(next);
  }

  private ensureOverlays() {
    if (this.frame) return;
    this.frame = document.createElement("div");
    this.frame.className = "astro-float-frame";
    this.dropLine = document.createElement("div");
    this.dropLine.className = "astro-float-dropline";
    this.bar = document.createElement("div");
    this.bar.className = "astro-float-bar";
    this.bar.addEventListener("mousedown", (e) => e.preventDefault()); // keep page selection where it is
    for (const el of [this.frame, this.dropLine, this.bar]) {
      el.hidden = true;
      document.body.appendChild(el);
    }
  }

  private hideOverlays() {
    for (const el of [this.frame, this.bar, this.dropLine]) if (el) el.hidden = true;
  }

  private renderOverlays() {
    this.ensureOverlays();
    const frame = this.frame!;
    const bar = this.bar!;
    const target = this.selected ?? this.hovered;
    if (!target || !this.attached || !target.isConnected) {
      frame.hidden = true;
      bar.hidden = true;
      return;
    }
    const r = target.getBoundingClientRect();
    const pad = 6;
    Object.assign(frame.style, { left: `${r.left - pad}px`, top: `${r.top - pad}px`, width: `${r.width + pad * 2}px`, height: `${r.height + pad * 2}px` });
    frame.toggleAttribute("data-selected", target === this.selected);
    frame.hidden = false;

    if (target !== this.selected) {
      bar.hidden = true;
      return;
    }
    bar.textContent = "";
    if (this.confirming) {
      const wrap = document.createElement("span");
      wrap.className = "astro-float-confirm";
      wrap.append("Remove this block?");
      const yes = button(ICON.trash, "Remove", () => this.removeIsland(target));
      yes.textContent = "Remove";
      yes.setAttribute("data-danger", "");
      const no = button("", "Keep", () => {
        this.confirming = false;
        this.renderOverlays();
      });
      no.textContent = "Keep";
      wrap.append(yes, no);
      bar.appendChild(wrap);
    } else {
      const up = button(ICON.up, "Move up", () => this.moveIsland(target, -1));
      const down = button(ICON.down, "Move down", () => this.moveIsland(target, 1));
      up.disabled = !target.previousElementSibling;
      down.disabled = !target.nextElementSibling;
      const grip = button(ICON.grip, "Drag to reorder", () => {});
      grip.setAttribute("data-grip", "");
      grip.draggable = true;
      grip.addEventListener("dragstart", (e) => this.startIslandDrag(e, target));
      const sep = document.createElement("span");
      sep.className = "astro-float-sep";
      const del = button(ICON.trash, "Remove", () => {
        this.confirming = true;
        this.renderOverlays();
      });
      del.setAttribute("data-danger", "");
      bar.append(up, down, grip, sep, del);
    }
    bar.hidden = false;
    const bw = bar.offsetWidth;
    const left = Math.min(Math.max(8, r.right - bw - 2), window.innerWidth - bw - 8);
    const top = r.top - pad - bar.offsetHeight - 6 >= 4 ? r.top - pad - bar.offsetHeight - 6 : r.top + pad + 4;
    Object.assign(bar.style, { left: `${left}px`, top: `${top}px` });
  }

  private reposition = () => {
    if (this.selected || this.hovered) this.renderOverlays();
  };

  private startIslandDrag(e: DragEvent, island: HTMLElement) {
    this.dragging = island;
    if (e.dataTransfer) {
      e.dataTransfer.setData(ISLAND_DRAG_TYPE, island.dataset.floatKey ?? "");
      e.dataTransfer.effectAllowed = "move";
      const r = island.getBoundingClientRect();
      e.dataTransfer.setDragImage(island, Math.min(40, r.width / 2), 20);
    }
    this.hovered = null;
    if (this.bar) this.bar.hidden = true;
  }

  private updateDropTarget(y: number) {
    const el = this.container!;
    const blocks = Array.from(el.children).filter((c) => c !== this.dragging) as HTMLElement[];
    let best: { block: HTMLElement; before: boolean; dist: number } | null = null;
    for (const block of blocks) {
      const r = block.getBoundingClientRect();
      const mid = r.top + r.height / 2;
      const before = y < mid;
      const edge = before ? r.top : r.bottom;
      const dist = Math.abs(y - edge);
      if (!best || dist < best.dist) best = { block, before, dist };
    }
    this.dropTarget = best ? { block: best.block, before: best.before } : null;
    this.ensureOverlays();
    const line = this.dropLine!;
    if (!best) {
      line.hidden = true;
      return;
    }
    const r = best.block.getBoundingClientRect();
    const cr = el.getBoundingClientRect();
    Object.assign(line.style, { left: `${cr.left}px`, width: `${cr.width}px`, top: `${(best.before ? r.top : r.bottom) - 1}px` });
    line.hidden = false;
  }

  // ---- events --------------------------------------------------------------------

  private queueChange() {
    if (this.changeQueued) return;
    this.changeQueued = true;
    queueMicrotask(() => {
      this.changeQueued = false;
      this.hooks.onChange();
      this.reposition();
    });
  }

  /** The dev toolbar closes the active app on Escape keyup; inside the body Escape only leaves the text. */
  private onKeyup = (e: KeyboardEvent) => {
    if (e.key === "Escape") e.stopPropagation();
  };

  private onKeydown = (e: KeyboardEvent) => {
    const el = this.container!;
    const mod = e.metaKey || e.ctrlKey;

    if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      if (this.selected) this.select(null);
      else el.blur();
      return;
    }

    // An island is selected: it is atomic. Nothing types into it; Backspace asks first.
    if (this.selected) {
      if (mod && ["c", "x", "v", "z", "y", "s"].includes(e.key.toLowerCase())) {
        if (e.key.toLowerCase() === "x") e.preventDefault();
        return;
      }
      if (e.key === "Backspace" || e.key === "Delete") {
        e.preventDefault();
        this.confirming = true;
        this.renderOverlays();
        return;
      }
      if (e.key === "Enter") {
        e.preventDefault();
        const p = emptyParagraph();
        this.selected.after(p);
        this.select(null);
        placeCaret(p);
        return;
      }
      if (e.key === "ArrowUp" || e.key === "ArrowDown") {
        e.preventDefault();
        const sibling = e.key === "ArrowUp" ? this.selected.previousElementSibling : this.selected.nextElementSibling;
        if (sibling instanceof HTMLElement) {
          if (sibling.hasAttribute("data-float-island")) this.select(sibling);
          else {
            this.select(null);
            placeCaret(sibling);
          }
        }
        return;
      }
      if (!mod && e.key.length === 1) {
        e.preventDefault();
        return;
      }
    }

    if (mod && !e.shiftKey && !e.altKey) {
      const key = e.key.toLowerCase();
      if (key === "b" || key === "i") {
        e.preventDefault();
        document.execCommand(key === "b" ? "bold" : "italic");
        return;
      }
      if (key === "k") {
        e.preventDefault();
        const current = (this.selectionRange()?.startContainer.parentElement?.closest("a") as HTMLAnchorElement | null)?.href;
        const url = window.prompt("Link URL", current ?? "https://");
        if (url === null) return;
        if (url === "" && current) document.execCommand("unlink");
        else if (url) document.execCommand("createLink", false, url);
        return;
      }
      return;
    }

    const range = this.selectionRange();
    if (!range) return;

    // Backspace/Delete against an island edge selects it instead of silently eating it.
    if ((e.key === "Backspace" || e.key === "Delete") && range.collapsed) {
      const block = this.topLevelBlock(range.startContainer);
      if (block) {
        const neighbour = e.key === "Backspace" ? block.previousElementSibling : block.nextElementSibling;
        const atEdge = e.key === "Backspace" ? isCaretAtStart(block, range) : isCaretAtEnd(block, range);
        if (atEdge && neighbour instanceof HTMLElement && neighbour.hasAttribute("data-float-island")) {
          e.preventDefault();
          this.select(neighbour);
          return;
        }
      }
    }

    const pre = closestWithin(range.startContainer, el, "pre");
    if (pre) {
      if (e.key === "Enter" && e.shiftKey) {
        e.preventDefault();
        const p = emptyParagraph();
        pre.after(p);
        placeCaret(p);
        return;
      }
      if (e.key === "Enter") {
        e.preventDefault();
        document.execCommand("insertText", false, "\n");
        return;
      }
      if (e.key === "Tab") {
        e.preventDefault();
        document.execCommand("insertText", false, "  ");
        return;
      }
      return;
    }

    if (e.key === "Tab") {
      const li = closestWithin(range.startContainer, el, "li");
      if (li) {
        e.preventDefault();
        if (e.shiftKey) outdentListItem(li);
        else indentListItem(li);
      }
      return;
    }

    if (e.key === " " && range.collapsed) this.markdownShortcut(e, range);
    else if (e.key === "`" && range.collapsed) this.codeFenceShortcut(e, range);
  };

  /** `# `, `- `, `1. `, `> ` at the start of a paragraph become the matching block. */
  private markdownShortcut(e: KeyboardEvent, range: Range) {
    const block = this.topLevelBlock(range.startContainer);
    if (!block || (block.tagName !== "P" && block.tagName !== "DIV")) return;
    const text = (block.textContent ?? "").replace(/\u00a0/g, " ");
    if (!isCaretAtEnd(block, range)) return;
    const m = text.match(/^(#{1,6}|[-*+]|1\.|>)$/);
    if (!m) return;
    e.preventDefault();

    const marker = m[1];
    let replacement: HTMLElement;
    let caretTarget: HTMLElement;
    if (marker.startsWith("#")) {
      replacement = caretTarget = document.createElement(`h${marker.length}`);
    } else if (marker === ">") {
      replacement = document.createElement("blockquote");
      caretTarget = document.createElement("p");
      replacement.appendChild(caretTarget);
    } else {
      replacement = document.createElement(marker === "1." ? "ol" : "ul");
      caretTarget = document.createElement("li");
      replacement.appendChild(caretTarget);
    }
    caretTarget.appendChild(document.createElement("br"));
    block.replaceWith(replacement);
    placeCaret(caretTarget);
  }

  /** Typing the third backtick on an otherwise-empty line opens a code block. */
  private codeFenceShortcut(e: KeyboardEvent, range: Range) {
    const block = this.topLevelBlock(range.startContainer);
    if (!block || (block.tagName !== "P" && block.tagName !== "DIV")) return;
    if ((block.textContent ?? "").replace(/\u00a0/g, " ") !== "``" || !isCaretAtEnd(block, range)) return;
    e.preventDefault();
    const pre = document.createElement("pre");
    const code = document.createElement("code");
    code.appendChild(document.createElement("br"));
    pre.appendChild(code);
    block.replaceWith(pre);
    placeCaret(code);
  }

  private onPaste = (e: ClipboardEvent) => {
    if (this.selected) {
      e.preventDefault();
      return;
    }
    const files = Array.from(e.clipboardData?.files ?? []).filter((f) => f.type.startsWith("image/"));
    if (files.length) {
      e.preventDefault();
      this.hooks.onFiles(files, this.selectionRange());
      return;
    }
    const text = e.clipboardData?.getData("text/plain");
    if (text) {
      e.preventDefault();
      document.execCommand("insertText", false, text);
    }
  };

  /** Links stay editable text while editing (⌘-click follows them); clicking an island selects it. */
  private onClick = (e: MouseEvent) => {
    const island = this.islandFrom(e.target);
    if (island) {
      e.preventDefault();
      this.select(island);
      return;
    }
    if (this.selected) this.select(null);
    const a = (e.target as HTMLElement).closest("a");
    if (a && !e.metaKey && !e.ctrlKey) e.preventDefault();
  };

  private onDocumentClick = (e: MouseEvent) => {
    if (!this.selected) return;
    const path = e.composedPath();
    if (path.includes(this.selected) || (this.bar && path.includes(this.bar))) return;
    this.select(null);
  };

  private onMouseOver = (e: MouseEvent) => {
    const island = this.islandFrom(e.target);
    if (island !== this.hovered) {
      this.hovered = island;
      this.renderOverlays();
    }
  };
  private onMouseLeave = () => {
    if (this.hovered) {
      this.hovered = null;
      this.renderOverlays();
    }
  };

  private onDragStart = (e: DragEvent) => {
    const island = this.islandFrom(e.target);
    if (!island) return;
    this.startIslandDrag(e, island);
  };
  private onDragEnter = (e: DragEvent) => {
    if (this.dragging) {
      e.preventDefault();
      return;
    }
    if (!hasFiles(e)) return;
    e.preventDefault();
    this.dragDepth++;
    this.container?.setAttribute("data-float-dragging", "");
  };
  private onDragOver = (e: DragEvent) => {
    if (this.dragging) {
      e.preventDefault();
      if (e.dataTransfer) e.dataTransfer.dropEffect = "move";
      this.updateDropTarget(e.clientY);
      return;
    }
    if (!hasFiles(e)) return;
    e.preventDefault();
    if (e.dataTransfer) e.dataTransfer.dropEffect = "copy";
  };
  private onDragLeave = () => {
    if (this.dragging) return;
    this.dragDepth = Math.max(0, this.dragDepth - 1);
    if (this.dragDepth === 0) this.container?.removeAttribute("data-float-dragging");
  };
  private onDrop = (e: DragEvent) => {
    if (this.dragging) {
      e.preventDefault();
      const island = this.dragging;
      const target = this.dropTarget;
      this.onDragEnd();
      if (target && target.block !== island) {
        if (target.before) target.block.before(island);
        else target.block.after(island);
        this.select(island);
      }
      return;
    }
    this.dragDepth = 0;
    this.container?.removeAttribute("data-float-dragging");
    const files = Array.from(e.dataTransfer?.files ?? []);
    if (!files.length) return;
    e.preventDefault();
    this.hooks.onFiles(files, rangeFromPoint(e.clientX, e.clientY));
  };
  private onDragEnd = () => {
    this.dragging = null;
    this.dropTarget = null;
    if (this.dropLine) this.dropLine.hidden = true;
    this.renderOverlays();
  };

  // ---- helpers --------------------------------------------------------------------

  private domBlocks(): Node[] {
    if (!this.container) return [];
    return Array.from(this.container.childNodes).filter(
      (n) => n.nodeType === Node.ELEMENT_NODE || (n.nodeType === Node.TEXT_NODE && (n.textContent ?? "").trim() !== ""),
    );
  }

  private topLevelBlock(node: Node): HTMLElement | null {
    const el = this.container;
    if (!el) return null;
    let cur: Node | null = node;
    while (cur && cur.parentNode !== el) cur = cur.parentNode;
    return cur instanceof HTMLElement ? cur : null;
  }

  private selectionRange(): Range | null {
    const sel = document.getSelection();
    if (!sel || !sel.rangeCount) return null;
    const range = sel.getRangeAt(0);
    return this.container?.contains(range.startContainer) ? range : null;
  }

  /**
   * `/_image?href=%2F%40fs%2F…%2Fpost%2Fphoto.png…` and `/@fs/…/post/photo.png`
   * both come back as `./photo.png` when they live next to the entry.
   */
  private relativeImageSrc(src: string): string {
    try {
      let s = src;
      if (s.startsWith("/_image")) {
        const href = new URL(s, location.origin).searchParams.get("href");
        if (href) s = href;
      }
      if (s.startsWith("/@fs/")) {
        let abs = s.slice("/@fs".length).split("?")[0];
        try {
          abs = decodeURIComponent(abs);
        } catch {
          /* leave as-is */
        }
        if (/^\/[A-Za-z]:\//.test(abs)) abs = abs.slice(1);
        if (abs.startsWith(this.absDir + "/")) return "./" + abs.slice(this.absDir.length + 1);
        return abs;
      }
      return src;
    } catch {
      return src;
    }
  }
}

// ---- module helpers ------------------------------------------------------------------

/** Islands key by identity; everything else by its HTML. */
function keyOf(node: Node): string {
  if (node instanceof HTMLElement && node.dataset.floatKey) return "key:" + node.dataset.floatKey;
  if (node instanceof Element) return node.outerHTML;
  return "#text:" + (node.textContent ?? "");
}

function button(svg: string, label: string, onClick: () => void): HTMLButtonElement {
  const b = document.createElement("button");
  b.type = "button";
  b.innerHTML = svg;
  b.title = label;
  b.setAttribute("aria-label", label);
  b.addEventListener("click", (e) => {
    e.preventDefault();
    e.stopPropagation();
    onClick();
  });
  return b;
}

function emptyParagraph(): HTMLParagraphElement {
  const p = document.createElement("p");
  p.appendChild(document.createElement("br"));
  return p;
}

function placeCaret(el: HTMLElement) {
  const sel = document.getSelection();
  if (!sel) return;
  const range = document.createRange();
  range.setStart(el, 0);
  range.collapse(true);
  sel.removeAllRanges();
  sel.addRange(range);
  (el.closest("[data-float-body]") as HTMLElement | null)?.focus();
}

function isCaretAtEnd(block: HTMLElement, range: Range): boolean {
  const probe = range.cloneRange();
  probe.selectNodeContents(block);
  probe.setStart(range.endContainer, range.endOffset);
  return probe.toString().trim() === "";
}

function isCaretAtStart(block: HTMLElement, range: Range): boolean {
  const probe = range.cloneRange();
  probe.selectNodeContents(block);
  probe.setEnd(range.startContainer, range.startOffset);
  return probe.toString().trim() === "";
}

function closestWithin(node: Node, root: HTMLElement, selector: string): HTMLElement | null {
  const start = node instanceof HTMLElement ? node : node.parentElement;
  const hit = start?.closest(selector) as HTMLElement | null;
  return hit && root.contains(hit) && hit !== root ? hit : null;
}

function hasFiles(e: DragEvent): boolean {
  return Array.from(e.dataTransfer?.types ?? []).includes("Files");
}

function rangeFromPoint(x: number, y: number): Range | null {
  const doc = document as Document & {
    caretRangeFromPoint?: (x: number, y: number) => Range | null;
    caretPositionFromPoint?: (x: number, y: number) => { offsetNode: Node; offset: number } | null;
  };
  if (doc.caretRangeFromPoint) return doc.caretRangeFromPoint(x, y);
  const pos = doc.caretPositionFromPoint?.(x, y);
  if (!pos) return null;
  const r = document.createRange();
  r.setStart(pos.offsetNode, pos.offset);
  r.collapse(true);
  return r;
}

function indentListItem(li: HTMLElement) {
  const prev = li.previousElementSibling as HTMLElement | null;
  if (!prev || prev.tagName !== "LI") return;
  const parent = li.parentElement!;
  let nested = prev.querySelector(":scope > ul, :scope > ol") as HTMLElement | null;
  if (!nested) {
    nested = document.createElement(parent.tagName.toLowerCase());
    prev.appendChild(nested);
  }
  nested.appendChild(li);
}

function outdentListItem(li: HTMLElement) {
  const list = li.parentElement!;
  const parentLi = list.parentElement?.closest("li");
  if (!parentLi) return;
  parentLi.after(li);
  if (!list.children.length) list.remove();
}

/**
 * Align two block sequences by exact key equality (longest common subsequence).
 * Returns, for every entry of `next`, the matched index in `prev` or -1.
 */
function alignByLcs(prev: string[], next: string[]): number[] {
  const n = prev.length;
  const m = next.length;
  const dp: Uint16Array[] = Array.from({ length: n + 1 }, () => new Uint16Array(m + 1));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i][j] = prev[i] === next[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }
  const out = new Array<number>(m).fill(-1);
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (prev[i] === next[j]) {
      out[j] = i;
      i++;
      j++;
    } else if (dp[i + 1][j] >= dp[i][j + 1]) i++;
    else j++;
  }
  return out;
}
