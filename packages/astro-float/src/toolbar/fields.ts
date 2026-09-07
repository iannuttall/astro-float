/**
 * Frontmatter fields rendered on the page (`<h1 data-float-field="title">`)
 * become editable in place. Only string fields whose rendered text matches the
 * frontmatter value verbatim are bound — anything transformed on the way out
 * (formatted dates, joined tags) stays in the Fields panel.
 */
export interface FieldBindingHooks {
  onChange(key: string, value: string): void;
}

const PLACEHOLDERS: Record<string, string> = { title: "Untitled", description: "Add a description…" };

export class FieldBindings {
  private els = new Map<string, HTMLElement>();
  private attached = false;
  private listeners: Array<() => void> = [];

  constructor(private hooks: FieldBindingHooks) {}

  bind(frontmatter: Record<string, unknown>) {
    this.unbind();
    for (const el of Array.from(document.querySelectorAll<HTMLElement>("[data-float-field]"))) {
      const key = el.dataset.floatField;
      if (!key || this.els.has(key)) continue;
      const value = frontmatter[key];
      if (typeof value !== "string" && value !== undefined && value !== null) continue;
      if (normalize(el.textContent ?? "") !== normalize(typeof value === "string" ? value : "")) continue;
      this.els.set(key, el);
    }
  }

  attach() {
    if (this.attached) return;
    this.attached = true;
    for (const [key, el] of this.els) {
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
  }

  detach() {
    if (!this.attached) return;
    this.attached = false;
    for (const off of this.listeners) off();
    this.listeners = [];
    for (const el of this.els.values()) {
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

  /** Push a value from the Fields panel into the page (skipped while that element has the caret). */
  setValue(key: string, value: unknown) {
    const el = this.els.get(key);
    if (!el || document.activeElement === el) return;
    const text = typeof value === "string" ? value : "";
    if (normalize(el.textContent ?? "") !== normalize(text)) el.textContent = text;
  }

  hasFocus() {
    return Array.from(this.els.values()).some((el) => el === document.activeElement);
  }
}

function normalize(text: string) {
  return text.replace(/\s+/g, " ").trim();
}
