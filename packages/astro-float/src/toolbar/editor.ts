import { blockToMarkdown, isBlockElement, type SerializeContext } from "./html-to-md";

export interface SourceBlock {
  type: string;
  src: string;
  trailer: string;
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
const PAGE_STYLE = /* css */ `
[data-float-editing] {
  outline: 1px dashed transparent;
  outline-offset: 16px;
  border-radius: 4px;
  transition: outline-color 150ms ease, background-color 150ms ease;
  caret-color: currentColor;
}
[data-float-editing]:hover { outline-color: color-mix(in srgb, currentColor 18%, transparent); }
[data-float-editing]:focus { outline-color: color-mix(in srgb, currentColor 30%, transparent); }
[data-float-editing][data-float-dragging] {
  outline: 1px dashed currentColor;
  background-color: color-mix(in srgb, currentColor 4%, transparent);
}
[data-float-editing] a { cursor: text; }
[data-float-editing] img { cursor: default; }
`;

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
    el.addEventListener("dragenter", this.onDragEnter);
    el.addEventListener("dragover", this.onDragOver);
    el.addEventListener("dragleave", this.onDragLeave);
    el.addEventListener("drop", this.onDrop);

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
    el.removeEventListener("dragenter", this.onDragEnter);
    el.removeEventListener("dragover", this.onDragOver);
    el.removeEventListener("dragleave", this.onDragLeave);
    el.removeEventListener("drop", this.onDrop);
    this.observer?.disconnect();
    this.observer = null;
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

  /** True while the caret lives in the body (focus, not just a lingering selection). */
  hasFocus() {
    const el = this.container;
    if (!el) return false;
    return document.activeElement === el || el.contains(document.activeElement);
  }

  /** Current body as Markdown. Unchanged blocks reuse their original source. */
  toMarkdown(): string {
    if (!this.container) return "";
    const ctx: SerializeContext = { imageSrc: (src) => this.relativeImageSrc(src) };
    const nodes = this.domBlocks();
    const parts: string[] = [];
    if (this.source.lead) parts.push(this.source.lead);

    if (this.mapped) {
      const matches = alignByLcs(
        this.snapshot.map((s) => s.key),
        nodes.map((n) => keyOf(n)),
      );
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
    } else {
      for (const node of nodes) {
        const md = blockToMarkdown(node, ctx);
        if (md) parts.push(md);
      }
    }
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

  // ---- events --------------------------------------------------------------------

  private queueChange() {
    if (this.changeQueued) return;
    this.changeQueued = true;
    queueMicrotask(() => {
      this.changeQueued = false;
      this.hooks.onChange();
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
      el.blur();
      return;
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

  /** Links stay editable text while the float is on; ⌘-click still follows them. */
  private onClick = (e: MouseEvent) => {
    const a = (e.target as HTMLElement).closest("a");
    if (a && !e.metaKey && !e.ctrlKey) e.preventDefault();
  };

  private onDragEnter = (e: DragEvent) => {
    if (!hasFiles(e)) return;
    e.preventDefault();
    this.dragDepth++;
    this.container?.setAttribute("data-float-dragging", "");
  };
  private onDragOver = (e: DragEvent) => {
    if (!hasFiles(e)) return;
    e.preventDefault();
    if (e.dataTransfer) e.dataTransfer.dropEffect = "copy";
  };
  private onDragLeave = () => {
    this.dragDepth = Math.max(0, this.dragDepth - 1);
    if (this.dragDepth === 0) this.container?.removeAttribute("data-float-dragging");
  };
  private onDrop = (e: DragEvent) => {
    this.dragDepth = 0;
    this.container?.removeAttribute("data-float-dragging");
    const files = Array.from(e.dataTransfer?.files ?? []);
    if (!files.length) return;
    e.preventDefault();
    this.hooks.onFiles(files, rangeFromPoint(e.clientX, e.clientY));
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

function keyOf(node: Node): string {
  if (node instanceof Element) return node.outerHTML;
  return "#text:" + (node.textContent ?? "");
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
}

function isCaretAtEnd(block: HTMLElement, range: Range): boolean {
  const probe = range.cloneRange();
  probe.selectNodeContents(block);
  probe.setStart(range.endContainer, range.endOffset);
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

export { isBlockElement };
