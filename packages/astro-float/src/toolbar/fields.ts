/**
 * Frontmatter fields rendered on the page (`<h1 data-float-field="title">`)
 * become editable in place.
 *
 * - String fields bind when the rendered text matches the frontmatter value
 *   verbatim (title, description).
 * - Date fields (`YYYY-MM-DD` in frontmatter) bind when the element prints a
 *   formatted version of that date. Float works out which Intl format the page
 *   used by reproducing the rendered text, so what you type is parsed back to
 *   `YYYY-MM-DD` for the file and re-formatted the same way on the page.
 *
 * Everything else (joined tags, booleans, numbers) stays sidebar-only.
 */
export interface FieldBindingHooks {
  onChange(key: string, value: string): void;
}

type Binding =
  | { kind: "string"; el: HTMLElement }
  | { kind: "date"; el: HTMLElement; format: (iso: string) => string; last: string };

const PLACEHOLDERS: Record<string, string> = { title: "Untitled", description: "Add a description…", pubDate: "Add a date…" };
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

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
      if (typeof value === "string" && ISO_DATE.test(value)) {
        const format = detectDateFormat(el, value, text);
        if (format) this.els.set(key, { kind: "date", el, format, last: value });
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
      const { el } = binding;
      el.contentEditable = "plaintext-only";
      if (el.contentEditable !== "plaintext-only") el.contentEditable = "true";
      el.setAttribute("data-float-editing-field", "");
      el.setAttribute("data-float-placeholder", PLACEHOLDERS[key] ?? `Add ${key}…`);
      el.spellcheck = binding.kind === "string";

      const onInput = () => {
        const text = normalize(el.textContent ?? "");
        // Chrome leaves a <br> behind when the last character goes; clear it so :empty (placeholder) applies.
        if (text === "" && el.innerHTML !== "") el.textContent = "";
        if (binding.kind === "date") {
          const iso = parseDateText(text);
          el.toggleAttribute("data-float-invalid", !iso && text !== "");
          if (iso) {
            binding.last = iso;
            this.hooks.onChange(key, iso);
          }
          return;
        }
        this.hooks.onChange(key, text);
      };
      const onBlur = () => {
        if (binding.kind !== "date") return;
        // Settle on the page's own format; an unparseable edit falls back to the last real date.
        el.removeAttribute("data-float-invalid");
        this.paintDate(binding, binding.last);
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
      });
    }
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
      el.removeAttribute("data-float-invalid");
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

  /** Push a value from the sidebar into the page (skipped while that element has the caret). */
  setValue(key: string, value: unknown) {
    const binding = this.els.get(key);
    if (!binding || document.activeElement === binding.el) return;
    if (binding.kind === "date") {
      const iso = typeof value === "string" && ISO_DATE.test(value) ? value : "";
      binding.last = iso;
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

/** "September 2, 2026", "2 Sep 2026", "2026-09-02", "09/02/2026" → "2026-09-02"; anything else → null. */
export function parseDateText(text: string): string | null {
  const t = text.trim();
  if (!t) return null;
  if (ISO_DATE.test(t)) return Number.isNaN(utcDate(t).valueOf()) ? null : t;
  const d = new Date(t);
  if (Number.isNaN(d.valueOf()) || !/\d{4}/.test(t)) return null;
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function unique(values: Array<string | undefined>): string[] {
  return Array.from(new Set(values.filter((v): v is string => !!v)));
}
