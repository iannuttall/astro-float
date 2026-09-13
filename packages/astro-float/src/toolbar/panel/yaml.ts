import { parse, stringify } from "yaml";
import type { Frontmatter } from "../api";
import { h } from "../dom";

/**
 * The YAML view: the raw frontmatter, monospace with line numbers. Typing
 * counts at once — the text is parsed shortly after you stop (and on blur, on
 * tab switch, and before any save), so ⌘S, autosave and the unload guard all
 * see it. Valid YAML replaces the same draft the Fields view edits; invalid
 * YAML keeps the text, shows the error under the editor and puts a red dot on
 * the tab. If the draft then changes elsewhere, the broken text is dropped for
 * a fresh render of the draft, so a typo here can never undo an edit there.
 *
 * Long lines soft-wrap. The line numbers come from a mirror: a <pre> with the
 * same text, font, width and padding sits under the (transparent) textarea, one
 * block per logical line, and each block draws its number in the gutter at the
 * start of its first visual row. Same text, same box → same wrapping, so the
 * numbers stay put on resize and the mirror also gives the textarea its height.
 */
export interface YamlHost {
  draft(): Frontmatter;
  replaceDraft(next: Frontmatter): void;
  onErrorChange(hasError: boolean): void;
  /** The text changed: the entry is dirty until it's parsed and saved. */
  onInput(): void;
}

export interface YamlView {
  el: HTMLElement;
  /** The tab became active: show the draft unless the text has pending edits or an error. */
  refresh(): void;
  /** The draft changed elsewhere (page, Fields, Discard, revert): follow it, dropping any broken text. */
  sync(): void;
  /** Parse what was typed; true when the draft was updated (or nothing changed). */
  commit(): boolean;
  /** Valid-looking text that hasn't reached the draft yet. */
  isPending(): boolean;
  hasError(): boolean;
  hasFocus(): boolean;
}

const COMMIT_DELAY = 300;

export function createYamlView(host: YamlHost): YamlView {
  const mirror = h("pre", { class: "code-mirror", "aria-hidden": "true" });
  const ta = h("textarea", { class: "code code-yaml", spellcheck: false, autocapitalize: "off", autocorrect: "off", "aria-label": "Frontmatter as YAML" }) as HTMLTextAreaElement;
  const error = h("div", { class: "code-error" });
  const el = h("div", { class: "code-view" }, h("div", { class: "code-box code-box-mirrored" }, mirror, ta), error);

  /** The text that matches the draft: last rendered from it, or last parsed into it. */
  let lastText = "";
  let errored = false;
  let timer: number | undefined;

  const setError = (message: string | null) => {
    error.textContent = message ?? "";
    ta.toggleAttribute("data-invalid", !!message);
    if (errored !== !!message) {
      errored = !!message;
      host.onErrorChange(errored);
    }
  };
  /** One block per logical line; an empty line still needs a row's worth of height. */
  const paintMirror = () => {
    const lines = ta.value.split("\n");
    mirror.textContent = "";
    for (const line of lines) mirror.appendChild(h("span", { class: "code-line" }, line === "" ? " " : line));
  };
  const schedule = () => {
    window.clearTimeout(timer);
    timer = window.setTimeout(() => commit(), COMMIT_DELAY);
  };
  ta.addEventListener("input", () => {
    paintMirror();
    schedule();
    host.onInput();
  });
  ta.addEventListener("blur", () => commit());
  ta.addEventListener("keydown", (e) => {
    if (e.key === "Tab") {
      e.preventDefault();
      ta.setRangeText("  ", ta.selectionStart, ta.selectionEnd, "end");
      paintMirror();
      schedule();
      host.onInput();
    }
  });

  const render = (fm: Frontmatter) => (Object.keys(fm).length ? stringify(fm, { lineWidth: 0 }) : "");
  const setText = (text: string) => {
    lastText = text;
    if (ta.value !== text) ta.value = text;
    paintMirror();
  };

  const commit = () => {
    window.clearTimeout(timer);
    const text = ta.value;
    if (text === lastText) {
      setError(null);
      return true;
    }
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
    // Coming back from an error the text may be stale: lay it over the draft rather than replace it.
    const wasErrored = errored;
    setError(null);
    lastText = text;
    host.replaceDraft(wasErrored ? { ...host.draft(), ...(data as Frontmatter) } : (data as Frontmatter));
    return true;
  };

  const refresh = () => {
    if (errored || ta.value !== lastText) return;
    const text = render(host.draft());
    if (text !== lastText) setText(text);
  };

  const sync = () => {
    if (errored) {
      // The draft moved on without us: the broken text would only overwrite that edit later. Drop it.
      window.clearTimeout(timer);
      setError(null);
      setText(render(host.draft()));
      return;
    }
    if (hasFocus()) return; // typing here; the debounced commit is the direction of travel
    const text = render(host.draft());
    if (text !== lastText) {
      window.clearTimeout(timer);
      setText(text);
    }
  };

  const hasFocus = () => (el.getRootNode() as Document | ShadowRoot).activeElement === ta;

  return {
    el,
    refresh,
    sync,
    commit,
    isPending: () => !errored && ta.value !== lastText,
    hasError: () => errored,
    hasFocus,
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
