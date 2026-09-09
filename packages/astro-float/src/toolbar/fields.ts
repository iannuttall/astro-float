import { DatePicker } from "./datepicker";

/**
 * Frontmatter fields rendered on the page (`<h1 data-float-field="title">`)
 * become editable in place.
 *
 * - String fields bind when the rendered text matches the frontmatter value
 *   verbatim (title, description). Plain-text caret.
 * - Date fields (`YYYY-MM-DD`, optionally with a time suffix, in frontmatter)
 *   bind when the element prints a formatted version of that date. Clicking
 *   the date opens a calendar; the pick is written back in the value's
 *   original shape (date part swapped, any suffix kept) and re-formatted on
 *   the page the same way the page did it.
 *
 * Everything else (joined tags, booleans, numbers) stays sidebar-only.
 */
export interface FieldBindingHooks {
  onChange(key: string, value: string): void;
}

type Binding =
  | { kind: "string"; el: HTMLElement }
  | { kind: "date"; el: HTMLElement; format: (iso: string) => string; last: string; suffix: string };

const PLACEHOLDERS: Record<string, string> = { title: "Untitled", description: "Add a description…", pubDate: "Add a date…" };
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
/** `2026-09-01`, `2026-09-01T10:00:00Z`, `2026-09-01 10:00` … — a date we can put a picker on. */
export const DATE_LIKE = /^\d{4}-\d{2}-\d{2}(?:[T ].*)?$/;

export class FieldBindings {
  private els = new Map<string, Binding>();
  private attached = false;
  private listeners: Array<() => void> = [];

  constructor(private hooks: FieldBindingHooks) {}

  bind(frontmatter: Record<string, unknown>) {
    this.unbind();
    for (const el of Array.from(document.querySelectorAll<HTMLElement>("[data-float-field]"))) {
      const key = el.dataset.floatField;
      if (!key || this.els.has(key)) continue;
      const value = frontmatter[key];
      const text = normalize(el.textContent ?? "");
      if (typeof value === "string" && DATE_LIKE.test(value)) {
        const iso = value.slice(0, 10);
        const format = detectDateFormat(el, iso, text);
        if (format) this.els.set(key, { kind: "date", el, format, last: iso, suffix: value.slice(10) });
        continue;
      }
      if (typeof value !== "string" && value !== undefined && value !== null) continue;
      if (text !== normalize(typeof value === "string" ? value : "")) continue;
      this.els.set(key, { kind: "string", el });
    }
  }

  attach() {
    if (this.attached) return;
    this.attached = true;
    for (const [key, binding] of this.els) {
      if (binding.kind === "date") this.attachDate(key, binding);
      else this.attachText(key, binding.el);
    }
  }

  /** A date on the page: click (or Enter / Space) opens the calendar; no caret. */
  private attachDate(key: string, binding: Extract<Binding, { kind: "date" }>) {
    const { el } = binding;
    el.setAttribute("data-float-editing-field", "");
    el.setAttribute("data-float-date", "");
    el.setAttribute("data-float-placeholder", PLACEHOLDERS[key] ?? `Add ${key}…`);
    el.setAttribute("role", "button");
    el.setAttribute("aria-haspopup", "dialog");
    el.setAttribute("title", "Change the date");
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
      el.removeAttribute("title");
      el.removeAttribute("tabindex");
      el.removeAttribute("data-float-date");
    });
  }

  private attachText(key: string, el: HTMLElement) {
    el.contentEditable = "plaintext-only";
    if (el.contentEditable !== "plaintext-only") el.contentEditable = "true";
    el.setAttribute("data-float-editing-field", "");
    el.setAttribute("data-float-placeholder", PLACEHOLDERS[key] ?? `Add ${key}…`);
    el.spellcheck = true;

    const onInput = () => {
      const text = normalize(el.textContent ?? "");
      // Chrome leaves a <br> behind when the last character goes; clear it so :empty (placeholder) applies.
      if (text === "" && el.innerHTML !== "") el.textContent = "";
      this.hooks.onChange(key, text);
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
    el.addEventListener("keydown", onKeydown);
    el.addEventListener("keyup", onKeyup);
    el.addEventListener("paste", onPaste);
    this.listeners.push(() => {
      el.removeEventListener("input", onInput);
      el.removeEventListener("keydown", onKeydown);
      el.removeEventListener("keyup", onKeyup);
      el.removeEventListener("paste", onPaste);
    });
  }

  detach() {
    if (!this.attached) return;
    this.attached = false;
    for (const off of this.listeners) off();
    this.listeners = [];
    for (const { el } of this.els.values()) {
      el.removeAttribute("contenteditable");
      el.removeAttribute("data-float-editing-field");
      el.removeAttribute("data-float-placeholder");
    }
  }

  unbind() {
    this.detach();
    this.els.clear();
  }

  has(key: string) {
    return this.els.has(key);
  }

  /** The bound page element for a key, if any. */
  element(key: string): HTMLElement | undefined {
    return this.els.get(key)?.el;
  }

  /** Keys bound on the page. */
  keys(): string[] {
    return Array.from(this.els.keys());
  }

  /** Push a value from the sidebar into the page (a text field is skipped while it has the caret; a date has no caret). */
  setValue(key: string, value: unknown) {
    const binding = this.els.get(key);
    if (!binding) return;
    if (binding.kind === "string" && document.activeElement === binding.el) return;
    if (binding.kind === "date") {
      const iso = typeof value === "string" && DATE_LIKE.test(value) ? value.slice(0, 10) : "";
      binding.last = iso;
      if (typeof value === "string" && DATE_LIKE.test(value)) binding.suffix = value.slice(10);
      this.paintDate(binding, iso);
      return;
    }
    const text = typeof value === "string" ? value : "";
    if (normalize(binding.el.textContent ?? "") !== normalize(text)) binding.el.textContent = text;
  }

  hasFocus() {
    return Array.from(this.els.values()).some(({ el }) => el === document.activeElement);
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

function normalize(text: string) {
  return text.replace(/\s+/g, " ").trim();
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
  const locales = unique([el.closest<HTMLElement>("[lang]")?.lang, document.documentElement.lang, navigator.language, "en", "en-US", "en-GB"]);
  const date = utcDate(iso);
  for (const locale of locales) {
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
    const fmt = new Intl.DateTimeFormat(locales[0], { year: "numeric", month: "long", day: "numeric", timeZone: "UTC" });
    return (v) => fmt.format(utcDate(v));
  }
  return null;
}

function unique(values: Array<string | undefined>): string[] {
  return Array.from(new Set(values.filter((v): v is string => !!v)));
}
