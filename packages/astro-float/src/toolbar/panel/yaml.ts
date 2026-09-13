import { parse, stringify } from "yaml";
import type { Frontmatter } from "../api";
import { h } from "../dom";

/**
 * The YAML view: the raw frontmatter, monospace with line numbers. It is
 * parsed on blur and whenever the tab is left; valid YAML replaces the same
 * draft the Fields view edits, invalid YAML keeps the text (and the last valid
 * draft), shows the error under the editor and puts a red dot on the tab.
 */
export interface YamlHost {
  draft(): Frontmatter;
  replaceDraft(next: Frontmatter): void;
  onErrorChange(hasError: boolean): void;
}

export interface YamlView {
  el: HTMLElement;
  /** Show the current draft, unless the text has a pending error (it would be lost). */
  refresh(): void;
  /** Parse what was typed; true when the draft was updated (or nothing changed). */
  commit(): boolean;
  hasError(): boolean;
  hasFocus(): boolean;
}

export function createYamlView(host: YamlHost): YamlView {
  const gutter = h("pre", { class: "code-gutter", "aria-hidden": "true" });
  const ta = h("textarea", { class: "code code-yaml", spellcheck: false, autocapitalize: "off", autocorrect: "off", wrap: "off", "aria-label": "Frontmatter as YAML" }) as HTMLTextAreaElement;
  const error = h("div", { class: "code-error" });
  const el = h("div", { class: "code-view" }, h("div", { class: "code-box" }, gutter, ta), error);

  let lastText = "";
  let errored = false;
  const setError = (message: string | null) => {
    error.textContent = message ?? "";
    ta.toggleAttribute("data-invalid", !!message);
    if (errored !== !!message) {
      errored = !!message;
      host.onErrorChange(errored);
    }
  };
  const numbers = () => {
    const n = Math.max(1, ta.value.split("\n").length);
    gutter.textContent = Array.from({ length: n }, (_, i) => String(i + 1)).join("\n");
    gutter.scrollTop = ta.scrollTop;
  };
  ta.addEventListener("input", numbers);
  ta.addEventListener("scroll", () => (gutter.scrollTop = ta.scrollTop));
  ta.addEventListener("blur", () => commit());
  ta.addEventListener("keydown", (e) => {
    if (e.key === "Tab") {
      e.preventDefault();
      ta.setRangeText("  ", ta.selectionStart, ta.selectionEnd, "end");
      numbers();
    }
  });

  const render = (fm: Frontmatter) => (Object.keys(fm).length ? stringify(fm, { lineWidth: 0 }) : "");

  const commit = () => {
    const text = ta.value;
    if (text === lastText && !errored) return true;
    let data: unknown;
    try {
      data = parse(text, { schema: "core" });
    } catch (err) {
      setError(yamlMessage(err));
      return false;
    }
    if (data == null) data = {};
    if (typeof data !== "object" || Array.isArray(data)) {
      setError("Frontmatter must be a mapping of key: value lines.");
      return false;
    }
    setError(null);
    lastText = text;
    host.replaceDraft(data as Frontmatter);
    return true;
  };

  const refresh = () => {
    if (errored) return;
    const text = render(host.draft());
    if (text === lastText && ta.value === text) return;
    lastText = text;
    if (ta.value !== text) ta.value = text;
    numbers();
  };

  return {
    el,
    refresh,
    commit,
    hasError: () => errored,
    hasFocus: () => (el.getRootNode() as Document | ShadowRoot).activeElement === ta,
  };
}

function yamlMessage(err: unknown): string {
  if (err && typeof err === "object") {
    const e = err as { message?: string; linePos?: Array<{ line: number; col: number }> };
    const pos = e.linePos?.[0];
    const first = (e.message ?? "Invalid YAML").split("\n")[0];
    return pos ? `Line ${pos.line}: ${first}` : first;
  }
  return "Invalid YAML";
}
