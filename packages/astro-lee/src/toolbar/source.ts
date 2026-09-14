/**
 * The body's raw Markdown, edited right where the prose was.
 *
 * A wrapper takes the prose container's place with the same box (margins,
 * padding, font, line height) so the wash and the corner control don't move by
 * a pixel. Inside it, a highlighted <pre> mirror sits under a textarea whose
 * text is transparent: the textarea owns typing, selection, caret and native
 * undo; the mirror paints the same characters with Markdown dressing — bold
 * and italic runs, muted markers, `#` markers hanging to the left of headings,
 * a bar beside quotes, monospace code — using exactly the font, padding and
 * wrapping the textarea has, so the caret lands on the glyph it belongs to.
 *
 * No external dependency: a small line + inline tokenizer is all it needs.
 */
export interface SourceEditorHooks {
  /** The text changed (typing, a shortcut, a paste). */
  onInput(text: string): void;
}

const MONO = "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace";
const LIST_RE = /^(\s*)([-*+]|\d+[.)])(\s+)(\[[ xX]\]\s+)?(.*)$/;
const QUOTE_RE = /^(\s*>\s?)(.*)$/;
const HEADING_RE = /^(#{1,6})(\s+)(.*)$/;
const HR_RE = /^\s*([-*_])(\s*\1){2,}\s*$/;
const FENCE_RE = /^\s*(```|~~~)/;
const INLINE_RE = /(`+)([^`]|[^`][\s\S]*?[^`])\1(?!`)|(!?\[)([^\]]*)(\]\()([^)]*)(\))|(\*\*|__)(?=\S)([\s\S]*?\S)\8|(\*|_)(?=\S)([^*_\n]*?\S)\10/g;

export class SourceEditor {
  readonly el: HTMLElement;
  readonly area: HTMLTextAreaElement;
  private mirror: HTMLElement;

  constructor(
    container: HTMLElement,
    text: string,
    private hooks: SourceEditorHooks,
  ) {
    const cs = getComputedStyle(container);
    const rect = container.getBoundingClientRect();

    this.el = document.createElement("div");
    this.el.className = "lee-source";
    // The prose box, exactly: its margins on the wrapper, its padding and type on the two layers.
    Object.assign(this.el.style, { marginTop: cs.marginTop, marginRight: cs.marginRight, marginBottom: cs.marginBottom, marginLeft: cs.marginLeft, minHeight: `${Math.round(rect.height)}px` });
    const type: Partial<CSSStyleDeclaration> = {
      paddingTop: cs.paddingTop,
      paddingRight: cs.paddingRight,
      paddingBottom: cs.paddingBottom,
      paddingLeft: cs.paddingLeft,
      fontFamily: cs.fontFamily,
      fontSize: cs.fontSize,
      fontWeight: cs.fontWeight,
      lineHeight: cs.lineHeight,
      letterSpacing: cs.letterSpacing,
      wordSpacing: cs.wordSpacing,
    };

    this.mirror = document.createElement("pre");
    this.mirror.className = "lee-src-mirror";
    this.mirror.setAttribute("aria-hidden", "true");
    Object.assign(this.mirror.style, type);

    this.area = document.createElement("textarea");
    this.area.className = "lee-src-area";
    this.area.spellcheck = false;
    this.area.setAttribute("aria-label", "Markdown source");
    this.area.setAttribute("autocapitalize", "off");
    this.area.setAttribute("autocorrect", "off");
    Object.assign(this.area.style, type);
    // The textarea paints its glyphs transparent (the mirror shows them); the caret needs the real colour.
    this.area.style.caretColor = cs.color;
    this.area.value = text;

    this.el.append(this.mirror, this.area);
    this.paint();

    this.area.addEventListener("input", () => {
      this.paint();
      this.hooks.onInput(this.area.value);
    });
    this.area.addEventListener("keydown", this.onKeydown);
    this.area.addEventListener("keyup", (e) => {
      if (e.key === "Escape") e.stopPropagation();
    });
  }

  get value() {
    return this.area.value;
  }

  /** Replace the text from outside (a discard, a normalized save); the caret stays where it can. */
  setValue(text: string) {
    if (this.area.value === text) return;
    const start = Math.min(this.area.selectionStart, text.length);
    this.area.value = text;
    this.area.setSelectionRange(start, start);
    this.paint();
  }

  focus() {
    this.area.focus({ preventScroll: true });
  }

  setSelection(start: number, end = start) {
    this.area.setSelectionRange(start, end);
  }

  /** Viewport top of the line that holds `offset` (the mirror's line, so wrapped rows count). */
  lineTop(offset: number): number {
    const line = this.area.value.slice(0, Math.max(0, offset)).split("\n").length - 1;
    const row = this.mirror.children[Math.min(line, this.mirror.children.length - 1)];
    return row ? row.getBoundingClientRect().top : this.el.getBoundingClientRect().top;
  }

  /** Insert at the caret (images dropped while in source view), through the undo stack. */
  insertText(text: string) {
    this.replace(this.area.selectionStart, this.area.selectionEnd, text);
  }

  dispose() {
    this.el.remove();
  }

  // ---- editing ----------------------------------------------------------------------

  /** Replace a range and place the selection, keeping native undo (execCommand) where the browser has it. */
  private replace(start: number, end: number, text: string, selStart = start + text.length, selEnd = selStart) {
    const area = this.area;
    area.focus({ preventScroll: true });
    area.setSelectionRange(start, end);
    let done = false;
    try {
      done = document.execCommand("insertText", false, text);
    } catch {
      done = false;
    }
    if (!done || area.value.slice(start, start + text.length) !== text) {
      area.setRangeText(text, start, end, "end");
      this.paint();
      this.hooks.onInput(area.value);
    }
    area.setSelectionRange(selStart, selEnd);
  }

  private onKeydown = (e: KeyboardEvent) => {
    const area = this.area;
    if (e.key === "Escape") {
      e.stopPropagation();
      area.blur();
      return;
    }
    const mod = e.metaKey || e.ctrlKey;
    if (mod && !e.shiftKey && !e.altKey && (e.key === "b" || e.key === "B")) {
      e.preventDefault();
      this.toggleWrap("**");
      return;
    }
    if (mod && !e.shiftKey && !e.altKey && (e.key === "i" || e.key === "I")) {
      e.preventDefault();
      this.toggleWrap("*");
      return;
    }
    if (mod && !e.shiftKey && !e.altKey && (e.key === "k" || e.key === "K")) {
      e.preventDefault();
      this.link();
      return;
    }
    if (e.key === "Tab") {
      e.preventDefault();
      this.indent(e.shiftKey ? -1 : 1);
      return;
    }
    if (e.key === "Enter" && !mod && !e.shiftKey && !e.altKey && !e.isComposing) {
      if (this.continueLine()) e.preventDefault();
    }
  };

  /** ⌘B / ⌘I: wrap the selection in the marker, or take the marker off if it's already there. */
  private toggleWrap(mark: string) {
    const { selectionStart: s, selectionEnd: e, value } = this.area;
    const sel = value.slice(s, e);
    const n = mark.length;
    if (sel.length >= 2 * n && sel.startsWith(mark) && sel.endsWith(mark)) {
      const inner = sel.slice(n, sel.length - n);
      this.replace(s, e, inner, s, s + inner.length);
      return;
    }
    if (value.slice(s - n, s) === mark && value.slice(e, e + n) === mark) {
      this.replace(s - n, e + n, sel, s - n, s - n + sel.length);
      return;
    }
    this.replace(s, e, `${mark}${sel}${mark}`, s + n, s + n + sel.length);
  }

  /** ⌘K: `[text](url)` with the url selected; a selected URL becomes the link target with the caret in the brackets. */
  private link() {
    const { selectionStart: s, selectionEnd: e, value } = this.area;
    const sel = value.slice(s, e);
    if (/^(https?:\/\/|mailto:|\/)\S+$/.test(sel)) {
      this.replace(s, e, `[](${sel})`, s + 1, s + 1);
      return;
    }
    const text = `[${sel}](url)`;
    const urlAt = s + 1 + sel.length + 2;
    this.replace(s, e, text, urlAt, urlAt + 3);
  }

  /** Tab / ⇧Tab: indent or outdent the selected lines (list items nest); elsewhere Tab is two spaces. */
  private indent(dir: 1 | -1) {
    const area = this.area;
    const { selectionStart: s, selectionEnd: e, value } = area;
    const lineStart = value.lastIndexOf("\n", s - 1) + 1;
    const lineEndIdx = value.indexOf("\n", e);
    const lineEnd = lineEndIdx === -1 ? value.length : lineEndIdx;
    const block = value.slice(lineStart, lineEnd);
    const lines = block.split("\n");
    const listy = lines.some((l) => LIST_RE.test(l) || QUOTE_RE.test(l));
    if (dir === 1 && s === e && !listy) {
      this.replace(s, e, "  ");
      return;
    }
    let firstDelta = 0;
    const next = lines
      .map((l, i) => {
        let out: string;
        if (dir === 1) out = "  " + l;
        else out = l.replace(/^ {1,2}/, "");
        if (i === 0) firstDelta = out.length - l.length;
        return out;
      })
      .join("\n");
    if (next === block) return;
    const delta = next.length - block.length;
    this.replace(lineStart, lineEnd, next, Math.max(lineStart, s + firstDelta), Math.max(lineStart, e + delta));
  }

  /** Enter inside a list item or quote carries the prefix over; Enter on an empty item ends the list. */
  private continueLine(): boolean {
    const area = this.area;
    const { selectionStart: s, selectionEnd: e, value } = area;
    if (s !== e) return false;
    const lineStart = value.lastIndexOf("\n", s - 1) + 1;
    const lineEndIdx = value.indexOf("\n", s);
    const lineEnd = lineEndIdx === -1 ? value.length : lineEndIdx;
    const line = value.slice(lineStart, lineEnd);
    const atEnd = s === lineEnd;
    const list = line.match(LIST_RE);
    if (list) {
      const [, indent, marker, gap, task, rest] = list;
      if (rest.trim() === "" && atEnd) {
        this.replace(lineStart, lineEnd, ""); // an empty item: the list is over
        return true;
      }
      const nextMarker = /^\d+/.test(marker) ? `${parseInt(marker, 10) + 1}${marker.slice(-1)}` : marker;
      const prefix = `${indent}${nextMarker}${gap}${task ? "[ ] " : ""}`;
      this.replace(s, s, `\n${prefix}`);
      return true;
    }
    const quote = line.match(QUOTE_RE);
    if (quote) {
      const [, prefix, rest] = quote;
      if (rest.trim() === "" && atEnd) {
        this.replace(lineStart, lineEnd, "");
        return true;
      }
      this.replace(s, s, `\n${prefix}`);
      return true;
    }
    return false;
  }

  // ---- painting -----------------------------------------------------------------------

  private paint() {
    const lines = this.area.value.split("\n");
    const out: string[] = [];
    let inFence = false;
    for (const line of lines) {
      if (FENCE_RE.test(line)) {
        inFence = !inFence;
        out.push(`<span class="ln md-codeline md-fence">${esc(line) || "&nbsp;"}</span>`);
        continue;
      }
      if (inFence) {
        out.push(`<span class="ln md-codeline">${esc(line) || "&nbsp;"}</span>`);
        continue;
      }
      if (line === "") {
        out.push(`<span class="ln">&nbsp;</span>`);
        continue;
      }
      const heading = line.match(HEADING_RE);
      if (heading) {
        const [, hashes, gap, rest] = heading;
        out.push(`<span class="ln md-h md-h${hashes.length}"><span class="md-hash">${esc(hashes + gap)}</span>${inline(rest)}</span>`);
        continue;
      }
      if (HR_RE.test(line)) {
        out.push(`<span class="ln md-hr">${esc(line)}</span>`);
        continue;
      }
      const quote = line.match(QUOTE_RE);
      if (quote) {
        out.push(`<span class="ln md-quote"><span class="md-mark">${esc(quote[1])}</span>${inline(quote[2])}</span>`);
        continue;
      }
      const list = line.match(LIST_RE);
      if (list) {
        const [, indent, marker, gap, task, rest] = list;
        out.push(`<span class="ln md-li">${esc(indent)}<span class="md-mark">${esc(marker + gap + (task ?? ""))}</span>${inline(rest)}</span>`);
        continue;
      }
      out.push(`<span class="ln">${inline(line)}</span>`);
    }
    this.mirror.innerHTML = out.join("");
  }
}

function esc(s: string) {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/** Code spans, images / links, strong, emphasis — each with its markers muted. Everything else verbatim. */
function inline(text: string): string {
  let out = "";
  let last = 0;
  // A fresh instance per call: this recurses for the text inside strong / emphasis, and a shared
  // global regex would have its position clobbered by the inner pass.
  const re = new RegExp(INLINE_RE.source, "g");
  for (let m = re.exec(text); m; m = re.exec(text)) {
    if (m[0].length === 0) {
      re.lastIndex++;
      continue;
    }
    out += esc(text.slice(last, m.index));
    last = m.index + m[0].length;
    if (m[1] !== undefined) {
      out += `<span class="md-code"><span class="md-mark">${esc(m[1])}</span>${esc(m[2])}<span class="md-mark">${esc(m[1])}</span></span>`;
    } else if (m[3] !== undefined) {
      out += `<span class="md-mark">${esc(m[3])}</span><span class="md-link">${inline(m[4])}</span><span class="md-mark">${esc(m[5])}</span><span class="md-url">${esc(m[6])}</span><span class="md-mark">${esc(m[7])}</span>`;
    } else if (m[8] !== undefined) {
      out += `<span class="md-mark">${esc(m[8])}</span><span class="md-strong">${inline(m[9])}</span><span class="md-mark">${esc(m[8])}</span>`;
    } else if (m[10] !== undefined) {
      out += `<span class="md-mark">${esc(m[10])}</span><span class="md-em">${inline(m[11])}</span><span class="md-mark">${esc(m[10])}</span>`;
    }
  }
  out += esc(text.slice(last));
  return out;
}

export const SOURCE_MONO = MONO;
