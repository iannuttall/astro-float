import { BindingMemory, FieldIndex, chipPrefix, matchChips, normalizeText as normalize, offLimits, unmarkAuto } from "./autobind";
import { DatePicker } from "./datepicker";
import { humanize, type CollectionSchema, type FieldDef } from "./schema";

/**
 * Frontmatter fields rendered on the page become editable in place. An
 * explicit `<h1 data-lee-field="title">` is looked at first; every other
 * value is then matched against the page text (see autobind.ts), so a page
 * with no attributes at all still gets its title, description, date and tags
 * bound. The panel only needs to show what the page doesn't.
 *
 * - String fields bind when the rendered text matches the frontmatter value
 *   verbatim (title, description). Plain-text caret.
 * - Date fields (`YYYY-MM-DD`, optionally with a time suffix, in frontmatter)
 *   bind when the element prints a formatted version of that date. Clicking
 *   the date opens a calendar; the pick is written back in the value's
 *   original shape (date part swapped, any suffix kept) and re-formatted on
 *   the page the same way the page did it.
 * - String arrays (tags) bind to a run of sibling chips printing the items in
 *   order, each optionally behind a one-character prefix ("#design"). Chips
 *   rename in place (the prefix stays on the page, never in the file), an
 *   emptied chip is removed on blur, and a quiet "+" chip after the last one
 *   adds a tag. An empty array binds nothing.
 * - Numbers bind when an element prints the value verbatim; typed text is
 *   checked against the schema (min / max / integer) before it reaches the draft.
 * - Enums (schema options) bind like strings but open a small menu of the
 *   options instead of taking a caret.
 * - A string whose value is empty has no text to match. Where the same field
 *   sat on another page of the collection is remembered (see `BindingMemory`);
 *   that element is bound when it is there and empty (or prints the value),
 *   and shows a muted placeholder until something is typed.
 *
 * Booleans, images, objects and references stay panel-only.
 */
export interface FieldBindingHooks {
  onChange(key: string, value: unknown): void;
}

interface Chip {
  el: HTMLElement;
  /** What the page prints before the item ("#", "# "); kept on the page, never written back. */
  prefix: string;
  /** The item as it was when the chip took the caret, for Escape. */
  was?: string;
}

type Binding =
  | { kind: "string"; el: HTMLElement }
  | { kind: "number"; el: HTMLElement; def: FieldDef | null; last: string }
  | { kind: "enum"; el: HTMLElement; options: string[] }
  | { kind: "date"; el: HTMLElement; format: (iso: string) => string; last: string; suffix: string }
  | { kind: "tags"; el: HTMLElement; chips: Chip[]; template: HTMLElement; prefix: string; adder: HTMLElement | null };

/** Placeholders that read better than "Add a <label>…". */
const PLACEHOLDERS: Record<string, string> = { title: "Untitled", pubDate: "Add a date…" };
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
/** `2026-09-01`, `2026-09-01T10:00:00Z`, `2026-09-01 10:00` … — a date we can put a picker on. */
export const DATE_LIKE = /^\d{4}-\d{2}-\d{2}(?:[T ].*)?$/;

const isStringArray = (v: unknown): v is string[] => Array.isArray(v) && v.length > 0 && v.every((x) => typeof x === "string");

export class FieldBindings {
  private els = new Map<string, Binding>();
  private attached = false;
  private listeners: Array<() => void> = [];
  private schema: CollectionSchema | null = null;
  private memory: BindingMemory | null = null;
  private menu: HTMLElement | null = null;

  constructor(private hooks: FieldBindingHooks) {}

  /**
   * Bind to the page. Explicit `[data-lee-field]` elements win; the remaining
   * values are auto-bound to the smallest matching element (or chip run)
   * outside `body` (the rendered body region).
   */
  bind(
    frontmatter: Record<string, unknown>,
    { body, schema, collection }: { body?: Element | null; schema?: CollectionSchema | null; collection?: string | null } = {},
  ) {
    this.unbind();
    this.schema = schema ?? null;
    this.memory = collection ? new BindingMemory(collection) : null;
    unmarkAuto("field");
    for (const el of Array.from(document.querySelectorAll<HTMLElement>("[data-lee-field]"))) {
      const key = el.dataset.leeField;
      if (!key || this.els.has(key)) continue;
      const value = frontmatter[key];
      const text = normalize(el.textContent ?? "");
      if (isStringArray(value)) {
        const chips = Array.from(el.children).filter((c): c is HTMLElement => c instanceof HTMLElement);
        const prefixes = matchChips(chips, value);
        if (prefixes) this.els.set(key, this.tagsBinding(el, chips, prefixes));
        continue;
      }
      if (typeof value === "number") {
        if (text === String(value)) this.els.set(key, { kind: "number", el, def: this.def(key), last: text });
        continue;
      }
      if (typeof value === "string" && DATE_LIKE.test(value)) {
        const iso = value.slice(0, 10);
        const format = detectDateFormat(el, iso, text);
        if (format) this.els.set(key, { kind: "date", el, format, last: iso, suffix: value.slice(10) });
        continue;
      }
      if (typeof value !== "string" && value !== undefined && value !== null) continue;
      if (text !== normalize(typeof value === "string" ? value : "")) continue;
      this.els.set(key, this.stringBinding(key, el));
    }
    this.autoBind(frontmatter, body);
  }

  /** Match every unbound value with a rendering we can recognise against the page text. */
  private autoBind(frontmatter: Record<string, unknown>, body: Element | null | undefined) {
    let index: FieldIndex | null = null;
    for (const [key, value] of Object.entries(frontmatter)) {
      if (this.els.has(key) || key === "slug") continue;
      const isText = typeof value === "string" && !!value.trim();
      if (!isText && typeof value !== "number" && !isStringArray(value)) continue;
      index ??= new FieldIndex([body, ...Array.from(this.els.values(), (b) => b.el)]);
      if (isStringArray(value)) {
        const group = index.findGroup(value);
        if (!group || !group.chips[0].parentElement) continue;
        index.takeGroup(group.chips, key);
        this.els.set(key, this.tagsBinding(group.chips[0].parentElement, group.chips, group.prefixes));
        continue;
      }
      if (typeof value === "number") {
        const el = index.find(String(value));
        if (!el) continue;
        index.take(el, key);
        this.els.set(key, { kind: "number", el, def: this.def(key), last: String(value) });
        continue;
      }
      if (DATE_LIKE.test(value as string)) {
        const iso = (value as string).slice(0, 10);
        const el = index.findTime(iso) ?? index.findAny(dateRenderings(iso));
        if (!el) continue;
        const format = detectDateFormat(el, iso, normalize(el.textContent ?? ""));
        if (!format) continue;
        index.take(el, key);
        this.els.set(key, { kind: "date", el, format, last: iso, suffix: (value as string).slice(10) });
        continue;
      }
      const el = index.find(value as string);
      if (!el) continue;
      index.take(el, key);
      this.els.set(key, this.stringBinding(key, el));
      this.memory?.remember(key, el);
    }
    this.recallBind(frontmatter, body, index);
  }

  /**
   * Fields with nothing to match (empty, or text that matched nowhere): the
   * element the same field sat in on another page of this collection, if it
   * is here, outside the body, unbound, and empty or printing the value. An
   * element printing something else is never taken; two misses forget it.
   */
  private recallBind(frontmatter: Record<string, unknown>, body: Element | null | undefined, index: FieldIndex | null) {
    const memory = this.memory;
    if (!memory) return;
    const keys = new Set([...Object.keys(frontmatter), ...(this.schema?.fields.map((f) => f.key) ?? [])]);
    for (const key of keys) {
      if (this.els.has(key) || key === "slug") continue;
      const selector = memory.get(key);
      if (!selector) continue;
      const value = frontmatter[key];
      const type = this.def(key)?.type;
      if (value !== undefined && value !== null && typeof value !== "string") continue;
      if (typeof value === "string" && DATE_LIKE.test(value)) continue;
      if (type && !["string", "text", "enum"].includes(type)) continue;
      let el: HTMLElement | null = null;
      try {
        el = document.querySelector<HTMLElement>(selector);
      } catch {
        /* a selector this browser can't parse */
      }
      const taken = (node: Element) => Array.from(this.els.values()).some((b) => b.el === node || b.el.contains(node) || node.contains(b.el));
      const ok =
        el &&
        !offLimits(el) &&
        !(body && (body === el || body.contains(el))) &&
        !el.hasAttribute("data-lee-field") &&
        !el.hasAttribute("data-lee-body") &&
        !taken(el) &&
        !el.querySelector(":scope > :not(b, i, em, strong, span, br, small, mark, s, u, sub, sup, abbr, wbr)");
      const text = ok ? normalize(el!.textContent ?? "") : "";
      if (!ok || (text !== "" && text !== normalize(typeof value === "string" ? value : ""))) {
        memory.miss(key);
        continue;
      }
      index ??= new FieldIndex([body, ...Array.from(this.els.values(), (b) => b.el)]);
      index.take(el!, key);
      this.els.set(key, this.stringBinding(key, el!));
      memory.hit(key);
    }
  }

  /** "Untitled" for the title, else "Add a <label>…" from the schema label (or the humanized key). */
  private placeholder(key: string) {
    if (PLACEHOLDERS[key]) return PLACEHOLDERS[key];
    const label = this.def(key)?.label ?? humanize(key);
    return `Add a ${label.charAt(0).toLowerCase()}${label.slice(1)}…`;
  }

  private def(key: string): FieldDef | null {
    return this.schema?.fields.find((f) => f.key === key) ?? null;
  }

  /** A string with schema options is an enum: a menu, not a caret. */
  private stringBinding(key: string, el: HTMLElement): Binding {
    const def = this.def(key);
    if (def?.type === "enum" && def.options?.length) return { kind: "enum", el, options: def.options };
    return { kind: "string", el };
  }

  private tagsBinding(parent: HTMLElement, chips: HTMLElement[], prefixes: string[]): Binding {
    const template = chips[0].cloneNode(false) as HTMLElement;
    template.removeAttribute("href");
    template.removeAttribute("id");
    for (const attr of Array.from(template.attributes)) if (attr.name.startsWith("data-lee")) template.removeAttribute(attr.name);
    return { kind: "tags", el: parent, chips: chips.map((el, i) => ({ el, prefix: prefixes[i] })), template, prefix: prefixes[0], adder: null };
  }

  attach() {
    if (this.attached) return;
    this.attached = true;
    for (const [key, binding] of this.els) {
      if (binding.kind === "date") this.attachDate(key, binding);
      else if (binding.kind === "tags") this.attachTags(key, binding);
      else if (binding.kind === "enum") this.attachEnum(key, binding);
      else if (binding.kind === "number") this.attachText(key, binding.el, binding);
      else this.attachText(key, binding.el);
    }
  }

  /** A date on the page: click (or Enter / Space) opens the calendar; no caret. */
  private attachDate(key: string, binding: Extract<Binding, { kind: "date" }>) {
    const { el } = binding;
    el.setAttribute("data-lee-editing-field", "");
    el.setAttribute("data-lee-date", "");
    el.setAttribute("data-lee-placeholder", this.placeholder(key));
    el.setAttribute("role", "button");
    el.setAttribute("aria-haspopup", "dialog");
    el.setAttribute("data-tip", "Change the date");
    el.tabIndex = 0;
    const open = () => {
      DatePicker.toggle({
        anchor: el,
        value: binding.last || null,
        locale: el.closest<HTMLElement>("[lang]")?.lang || undefined,
        onPick: (iso) => {
          binding.last = iso;
          this.paintDate(binding, iso);
          this.hooks.onChange(key, iso + binding.suffix);
        },
      });
    };
    const onClick = (e: MouseEvent) => {
      e.preventDefault();
      open();
    };
    const onKeydown = (e: KeyboardEvent) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        open();
      } else if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        el.blur();
      }
    };
    const onKeyup = (e: KeyboardEvent) => {
      if (e.key === "Escape") e.stopPropagation();
    };
    el.addEventListener("click", onClick);
    el.addEventListener("keydown", onKeydown);
    el.addEventListener("keyup", onKeyup);
    this.listeners.push(() => {
      if (DatePicker.isOpenFor(el)) DatePicker.close();
      el.removeEventListener("click", onClick);
      el.removeEventListener("keydown", onKeydown);
      el.removeEventListener("keyup", onKeyup);
      el.removeAttribute("role");
      el.removeAttribute("aria-haspopup");
      el.removeAttribute("data-tip");
      el.removeAttribute("tabindex");
      el.removeAttribute("data-lee-date");
    });
  }

  /**
   * Plain-text caret. A number binding checks the text against its schema
   * first: invalid text is marked and never reaches the draft; on blur the
   * last good value comes back.
   */
  private attachText(key: string, el: HTMLElement, number?: Extract<Binding, { kind: "number" }>) {
    el.contentEditable = "plaintext-only";
    if (el.contentEditable !== "plaintext-only") el.contentEditable = "true";
    el.setAttribute("data-lee-editing-field", "");
    el.setAttribute("data-lee-placeholder", this.placeholder(key));
    const spellcheck = el.getAttribute("spellcheck");
    el.spellcheck = !number;

    const onInput = () => {
      const text = normalize(el.textContent ?? "");
      // Chrome leaves a <br> behind when the last character goes; clear it so :empty (placeholder) applies.
      if (text === "" && el.innerHTML !== "") el.textContent = "";
      if (!number) {
        this.hooks.onChange(key, text);
        return;
      }
      const value = parseNumber(text, number.def);
      el.toggleAttribute("data-lee-invalid", value === null);
      if (value === null) return;
      number.last = text;
      this.hooks.onChange(key, value);
    };
    const onBlur = () => {
      if (!number || !el.hasAttribute("data-lee-invalid")) return;
      el.removeAttribute("data-lee-invalid");
      el.textContent = number.last;
    };
    const onKeydown = (e: KeyboardEvent) => {
      if (e.key === "Enter") {
        e.preventDefault();
        el.blur();
      } else if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        el.blur();
      }
    };
    const onKeyup = (e: KeyboardEvent) => {
      if (e.key === "Escape") e.stopPropagation();
    };
    const onPaste = (e: ClipboardEvent) => {
      if (el.contentEditable === "plaintext-only") return;
      e.preventDefault();
      document.execCommand("insertText", false, (e.clipboardData?.getData("text/plain") ?? "").replace(/\s+/g, " "));
    };
    el.addEventListener("input", onInput);
    el.addEventListener("blur", onBlur);
    el.addEventListener("keydown", onKeydown);
    el.addEventListener("keyup", onKeyup);
    el.addEventListener("paste", onPaste);
    this.listeners.push(() => {
      el.removeEventListener("input", onInput);
      el.removeEventListener("blur", onBlur);
      el.removeEventListener("keydown", onKeydown);
      el.removeEventListener("keyup", onKeyup);
      el.removeEventListener("paste", onPaste);
      el.removeAttribute("data-lee-invalid");
      if (spellcheck === null) el.removeAttribute("spellcheck");
      else el.setAttribute("spellcheck", spellcheck);
    });
  }

  /** An enum printed on the page: click (or Enter / Space) opens a menu of the options; no caret. */
  private attachEnum(key: string, binding: Extract<Binding, { kind: "enum" }>) {
    const { el } = binding;
    el.setAttribute("data-lee-editing-field", "");
    el.setAttribute("data-lee-enum", "");
    el.setAttribute("data-lee-placeholder", this.placeholder(key));
    el.setAttribute("role", "button");
    el.setAttribute("aria-haspopup", "menu");
    el.setAttribute("data-tip", `Change ${key}`);
    el.tabIndex = 0;
    const open = () => {
      if (this.menu?.dataset.for === key) return this.closeMenu();
      this.closeMenu();
      const menu = document.createElement("div");
      menu.className = "lee-menu";
      menu.dataset.for = key;
      menu.setAttribute("role", "menu");
      const current = normalize(el.textContent ?? "");
      for (const option of binding.options) {
        const b = document.createElement("button");
        b.type = "button";
        b.setAttribute("role", "menuitem");
        b.textContent = option;
        if (option === current) b.setAttribute("data-on", "");
        b.addEventListener("click", () => {
          this.closeMenu();
          if (normalize(el.textContent ?? "") !== option) el.textContent = option;
          this.hooks.onChange(key, option);
          el.focus();
        });
        menu.appendChild(b);
      }
      const r = el.getBoundingClientRect();
      menu.style.top = `${Math.round(r.bottom + 4)}px`;
      menu.style.left = `${Math.round(r.left)}px`;
      document.body.appendChild(menu);
      this.menu = menu;
      document.addEventListener("pointerdown", this.onDocumentDown, true);
      document.addEventListener("keydown", this.onDocumentKey, true);
      window.addEventListener("scroll", this.onDocumentDown, true);
      (menu.querySelector("[data-on]") as HTMLElement | null)?.focus();
    };
    const onClick = (e: MouseEvent) => {
      e.preventDefault();
      open();
    };
    const onKeydown = (e: KeyboardEvent) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        open();
      } else if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        el.blur();
      }
    };
    const onKeyup = (e: KeyboardEvent) => {
      if (e.key === "Escape") e.stopPropagation();
    };
    el.addEventListener("click", onClick);
    el.addEventListener("keydown", onKeydown);
    el.addEventListener("keyup", onKeyup);
    this.listeners.push(() => {
      if (this.menu?.dataset.for === key) this.closeMenu();
      el.removeEventListener("click", onClick);
      el.removeEventListener("keydown", onKeydown);
      el.removeEventListener("keyup", onKeyup);
      el.removeAttribute("role");
      el.removeAttribute("aria-haspopup");
      el.removeAttribute("data-tip");
      el.removeAttribute("tabindex");
      el.removeAttribute("data-lee-enum");
    });
  }

  private onDocumentDown = (e: Event) => {
    if (this.menu && !this.menu.contains(e.target as Node)) this.closeMenu();
  };
  private onDocumentKey = (e: KeyboardEvent) => {
    if (e.key === "Escape" && this.menu) {
      e.stopPropagation();
      this.closeMenu();
    }
  };
  private closeMenu() {
    if (!this.menu) return;
    this.menu.remove();
    this.menu = null;
    document.removeEventListener("pointerdown", this.onDocumentDown, true);
    document.removeEventListener("keydown", this.onDocumentKey, true);
    window.removeEventListener("scroll", this.onDocumentDown, true);
  }

  // ---- tags -----------------------------------------------------------------------

  /** Every chip takes a caret; a "+" chip after the last one adds a tag. */
  private attachTags(key: string, binding: Extract<Binding, { kind: "tags" }>) {
    for (const chip of binding.chips) this.attachChip(key, binding, chip);

    const adder = binding.template.cloneNode(false) as HTMLElement;
    adder.textContent = "+";
    adder.setAttribute("data-lee-add", "");
    adder.setAttribute("role", "button");
    adder.setAttribute("data-tip", key === "tags" ? "Add tag" : `Add to ${key}`);
    adder.tabIndex = 0;
    binding.adder = adder;
    this.placeChip(binding, adder);

    const reset = () => {
      adder.removeAttribute("data-lee-adding");
      adder.removeAttribute("contenteditable");
      adder.textContent = "+";
    };
    const start = () => {
      if (adder.hasAttribute("data-lee-adding")) return;
      adder.setAttribute("data-lee-adding", "");
      adder.contentEditable = "plaintext-only";
      if (adder.contentEditable !== "plaintext-only") adder.contentEditable = "true";
      adder.textContent = binding.prefix;
      adder.focus();
      placeCaretAtEnd(adder);
    };
    const commit = () => {
      if (!adder.hasAttribute("data-lee-adding")) return;
      const item = stripPrefix(adder.textContent ?? "", binding.prefix);
      reset();
      if (!item || binding.chips.some((c) => chipValue(c) === item)) return;
      const chip: Chip = { el: binding.template.cloneNode(false) as HTMLElement, prefix: binding.prefix };
      chip.el.textContent = binding.prefix + item;
      binding.chips.push(chip);
      this.placeChip(binding, chip.el, adder);
      this.attachChip(key, binding, chip);
      this.emitTags(key, binding);
    };
    const onClick = (e: MouseEvent) => {
      e.preventDefault();
      start();
    };
    const onKeydown = (e: KeyboardEvent) => {
      if (!adder.hasAttribute("data-lee-adding")) {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          start();
        }
        return;
      }
      if (e.key === "Enter") {
        e.preventDefault();
        commit();
        adder.blur();
      } else if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        reset();
        adder.blur();
      }
    };
    const onKeyup = (e: KeyboardEvent) => {
      if (e.key === "Escape") e.stopPropagation();
    };
    adder.addEventListener("click", onClick);
    adder.addEventListener("keydown", onKeydown);
    adder.addEventListener("keyup", onKeyup);
    adder.addEventListener("blur", commit);
    this.listeners.push(() => {
      adder.removeEventListener("click", onClick);
      adder.removeEventListener("keydown", onKeydown);
      adder.removeEventListener("keyup", onKeyup);
      adder.removeEventListener("blur", commit);
      this.removeChip(adder);
      binding.adder = null;
    });
  }

  private attachChip(key: string, binding: Extract<Binding, { kind: "tags" }>, chip: Chip) {
    if (!this.attached) return;
    const { el } = chip;
    el.contentEditable = "plaintext-only";
    if (el.contentEditable !== "plaintext-only") el.contentEditable = "true";
    el.setAttribute("data-lee-chip", "");
    const onFocus = () => {
      chip.was = chipValue(chip);
    };
    const onInput = () => {
      if (normalize(el.textContent ?? "") === "" && el.innerHTML !== "") el.textContent = "";
      this.emitTags(key, binding);
    };
    const onBlur = () => {
      const item = chipValue(chip);
      if (!item) {
        binding.chips = binding.chips.filter((c) => c !== chip);
        this.removeChip(el);
      } else if (normalize(el.textContent ?? "") !== normalize(chip.prefix + item)) {
        el.textContent = chip.prefix + item;
      }
      this.emitTags(key, binding);
    };
    const onKeydown = (e: KeyboardEvent) => {
      if (e.key === "Enter") {
        e.preventDefault();
        el.blur();
      } else if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        if (chip.was !== undefined) el.textContent = chip.prefix + chip.was;
        el.blur();
      }
    };
    const onKeyup = (e: KeyboardEvent) => {
      if (e.key === "Escape") e.stopPropagation();
    };
    const onClick = (e: MouseEvent) => {
      if (el.tagName === "A") e.preventDefault(); // a linked chip edits, it doesn't navigate
    };
    const onPaste = (e: ClipboardEvent) => {
      if (el.contentEditable === "plaintext-only") return;
      e.preventDefault();
      document.execCommand("insertText", false, (e.clipboardData?.getData("text/plain") ?? "").replace(/\s+/g, " "));
    };
    el.addEventListener("focus", onFocus);
    el.addEventListener("input", onInput);
    el.addEventListener("blur", onBlur);
    el.addEventListener("keydown", onKeydown);
    el.addEventListener("keyup", onKeyup);
    el.addEventListener("click", onClick);
    el.addEventListener("paste", onPaste);
    this.listeners.push(() => {
      el.removeEventListener("focus", onFocus);
      el.removeEventListener("input", onInput);
      el.removeEventListener("blur", onBlur);
      el.removeEventListener("keydown", onKeydown);
      el.removeEventListener("keyup", onKeyup);
      el.removeEventListener("click", onClick);
      el.removeEventListener("paste", onPaste);
      el.removeAttribute("contenteditable");
      el.removeAttribute("data-lee-chip");
      dropEmptyStyle(el);
    });
  }

  private emitTags(key: string, binding: Extract<Binding, { kind: "tags" }>) {
    this.hooks.onChange(key, binding.chips.map(chipValue).filter(Boolean));
  }

  /** Put a chip after the last one (or before `before`), copying the whitespace the page keeps between chips. */
  private placeChip(binding: Extract<Binding, { kind: "tags" }>, el: HTMLElement, before: HTMLElement | null = null) {
    const last = binding.chips[binding.chips.length - 1]?.el ?? null;
    const anchor = before ?? last;
    const gap = anchor?.previousSibling;
    const space = gap instanceof Text && !gap.textContent?.trim() ? gap.cloneNode() : null;
    if (before) {
      before.before(...(space ? [space, el] : [el]));
    } else if (last?.parentNode) {
      last.after(...(space ? [space, el] : [el]));
    } else {
      binding.el.append(...(space ? [space, el] : [el]));
    }
  }

  private removeChip(el: HTMLElement) {
    const gap = el.previousSibling;
    if (gap instanceof Text && !gap.textContent?.trim()) gap.remove();
    el.remove();
  }

  // ---- lifecycle ----------------------------------------------------------------------

  detach() {
    if (!this.attached) return;
    this.attached = false;
    this.closeMenu();
    for (const off of this.listeners) off();
    this.listeners = [];
    for (const { el } of this.els.values()) {
      el.removeAttribute("contenteditable");
      el.removeAttribute("data-lee-editing-field");
      el.removeAttribute("data-lee-placeholder");
      dropEmptyStyle(el);
    }
  }

  unbind() {
    this.detach();
    this.els.clear();
    this.schema = null;
    this.memory = null;
  }

  has(key: string) {
    return this.els.has(key);
  }

  /** The bound page element for a key, if any (for tags: the chips' parent). */
  element(key: string): HTMLElement | undefined {
    return this.els.get(key)?.el;
  }

  /** Keys editable on the page: the panel can leave these out. */
  boundKeys(): string[] {
    return Array.from(this.els.keys());
  }

  /** Push a value from the sidebar into the page (skipped while the field has the caret; a date or enum has none). */
  setValue(key: string, value: unknown) {
    const binding = this.els.get(key);
    if (!binding) return;
    const active = document.activeElement;
    if (binding.kind === "date") {
      const iso = typeof value === "string" && DATE_LIKE.test(value) ? value.slice(0, 10) : "";
      binding.last = iso;
      if (typeof value === "string" && DATE_LIKE.test(value)) binding.suffix = value.slice(10);
      this.paintDate(binding, iso);
      return;
    }
    if (binding.kind === "tags") {
      if (binding.el.contains(active)) return;
      this.paintTags(key, binding, Array.isArray(value) ? value.map(String) : []);
      return;
    }
    if (active === binding.el) return;
    const text = typeof value === "string" ? value : typeof value === "number" ? String(value) : "";
    if (binding.kind === "number") {
      binding.last = text;
      binding.el.removeAttribute("data-lee-invalid");
    }
    if (normalize(binding.el.textContent ?? "") !== normalize(text)) binding.el.textContent = text;
  }

  /** Make the chips on the page show `items`: rename in place, drop extras, clone the template for new ones. */
  private paintTags(key: string, binding: Extract<Binding, { kind: "tags" }>, items: string[]) {
    for (const chip of binding.chips.slice(items.length)) this.removeChip(chip.el);
    binding.chips = binding.chips.slice(0, items.length);
    items.forEach((item, i) => {
      const chip = binding.chips[i];
      if (chip) {
        if (chipValue(chip) !== normalize(item)) chip.el.textContent = chip.prefix + item;
        return;
      }
      const next: Chip = { el: binding.template.cloneNode(false) as HTMLElement, prefix: binding.prefix };
      next.el.textContent = binding.prefix + item;
      binding.chips.push(next);
      this.placeChip(binding, next.el, binding.adder);
      this.attachChip(key, binding, next);
    });
  }

  hasFocus() {
    const active = document.activeElement;
    return Array.from(this.els.values()).some((b) => b.el === active || (b.kind === "tags" && b.el.contains(active)));
  }

  private paintDate(binding: Extract<Binding, { kind: "date" }>, iso: string) {
    const text = iso ? binding.format(iso) : "";
    if (normalize(binding.el.textContent ?? "") !== text) binding.el.textContent = text;
    if (binding.el instanceof HTMLTimeElement || binding.el.hasAttribute("datetime")) {
      if (iso) binding.el.setAttribute("datetime", iso);
      else binding.el.removeAttribute("datetime");
    }
  }
}

// ---- chips / numbers ------------------------------------------------------------------

/** The item a chip holds: its text minus the prefix the page prints. */
function chipValue(chip: Chip) {
  return stripPrefix(chip.el.textContent ?? "", chip.prefix);
}

function stripPrefix(text: string, prefix: string) {
  const t = normalize(text);
  const p = prefix.trim();
  return p && t.startsWith(p) ? normalize(t.slice(p.length)) : t;
}

/** Chrome leaves `style=""` on an element that took a caret; the page had none. */
function dropEmptyStyle(el: HTMLElement) {
  if (el.getAttribute("style") === "") el.removeAttribute("style");
}

function placeCaretAtEnd(el: HTMLElement) {
  const range = document.createRange();
  range.selectNodeContents(el);
  range.collapse(false);
  const sel = window.getSelection();
  sel?.removeAllRanges();
  sel?.addRange(range);
}

/** The number `text` spells, if it satisfies the field definition; null otherwise. */
function parseNumber(text: string, def: FieldDef | null): number | null {
  if (!/^-?\d+(?:\.\d+)?$/.test(text)) return null;
  const n = Number(text);
  if (!Number.isFinite(n)) return null;
  if (def?.integer && !Number.isInteger(n)) return null;
  if (def?.min !== undefined && n < def.min) return null;
  if (def?.max !== undefined && n > def.max) return null;
  return n;
}

// ---- dates ------------------------------------------------------------------------

const DATE_OPTIONS: Intl.DateTimeFormatOptions[] = [
  { year: "numeric", month: "long", day: "numeric" },
  { dateStyle: "long" },
  { dateStyle: "medium" },
  { dateStyle: "full" },
  { year: "numeric", month: "short", day: "numeric" },
  { weekday: "long", year: "numeric", month: "long", day: "numeric" },
  { dateStyle: "short" },
  { year: "numeric", month: "2-digit", day: "2-digit" },
];

/** Date-only values are formatted in UTC so `2026-09-01` never turns into August 31 somewhere west of Greenwich. */
function utcDate(iso: string) {
  return new Date(`${iso}T00:00:00Z`);
}

/**
 * Find the Intl format the page used for this date by reproducing its text.
 * Falls back to a long date when the element carries a matching `datetime`
 * attribute (we then know it *is* this date, even if we can't name the format).
 */
function detectDateFormat(el: HTMLElement, iso: string, text: string): ((iso: string) => string) | null {
  if (text === iso) return (v) => v;
  const date = utcDate(iso);
  for (const locale of pageLocales(el)) {
    for (const opts of DATE_OPTIONS) {
      try {
        const fmt = new Intl.DateTimeFormat(locale, { ...opts, timeZone: "UTC" });
        if (normalize(fmt.format(date)) === text) return (v) => fmt.format(utcDate(v));
      } catch {
        /* unsupported locale/options combination */
      }
    }
  }
  const attr = el.getAttribute("datetime");
  if (attr && attr.slice(0, 10) === iso) {
    const fmt = new Intl.DateTimeFormat(pageLocales(el)[0], { year: "numeric", month: "long", day: "numeric", timeZone: "UTC" });
    return (v) => fmt.format(utcDate(v));
  }
  return null;
}

/** Every way the page might have printed `iso` (the raw value first), for finding an unmarked date element. */
export function dateRenderings(iso: string): string[] {
  const out = [iso];
  const date = utcDate(iso);
  for (const locale of pageLocales()) {
    for (const opts of DATE_OPTIONS) {
      try {
        out.push(normalize(new Intl.DateTimeFormat(locale, { ...opts, timeZone: "UTC" }).format(date)));
      } catch {
        /* unsupported locale/options combination */
      }
    }
  }
  return unique(out);
}

function pageLocales(el?: HTMLElement): string[] {
  return unique([el?.closest<HTMLElement>("[lang]")?.lang, document.documentElement.lang, navigator.language, "en", "en-US", "en-GB"]);
}

function unique(values: Array<string | undefined>): string[] {
  return Array.from(new Set(values.filter((v): v is string => !!v)));
}
