import { h, replaceChildren } from "../dom";
import { icon } from "../icons";

/**
 * The Markdown view: the whole body as source. It is the same "source mode"
 * the region control's Source button opens on the page — the same draft, the
 * same save (write, re-render the page, keep going) — only the textarea lives
 * in the panel instead of standing in for the prose.
 */
export interface MarkdownHost {
  body(): { bound: boolean; readOnly: boolean; text: string };
  /** Enter source mode with this textarea as the source editor. */
  openSource(area: HTMLTextAreaElement): void;
  sourceState(): { active: boolean; busy: boolean; error: string | null };
  /** Drop the source edits and show the body as it is on disk. */
  discardSource(): void;
}

export interface MarkdownView {
  el: HTMLElement;
  area: HTMLTextAreaElement;
  /** The tab became active: hook the textarea up as the body's source editor. */
  open(): void;
  /** Busy / error state changed. */
  refresh(): void;
  /** The body on disk changed under us (a save normalized it): show it, keep the caret. */
  sync(text: string): void;
}

export function createMarkdownView(host: MarkdownHost): MarkdownView {
  const area = h("textarea", { class: "code code-md", spellcheck: false, autocapitalize: "off", autocorrect: "off", "aria-label": "Markdown source" }) as HTMLTextAreaElement;
  const status = h("div", { class: "code-status" });
  const el = h("div", { class: "code-view code-view-md" }, h("div", { class: "code-box" }, area), status);

  const refresh = () => {
    const { busy, error } = host.sourceState();
    const { readOnly, bound } = host.body();
    const parts: Array<HTMLElement | string> = [];
    if (readOnly) {
      parts.push(h("span", { class: "muted" }, "MDX blocks didn't line up with the source — the body is read-only here."));
    } else if (busy) {
      parts.push(h("span", { class: "muted" }, "Saving…"));
    } else if (error) {
      parts.push(
        h("span", { class: "code-error-inline" }, icon("alert", 13), error),
        h("button", { class: "btn btn-sm btn-ghost", type: "button", onClick: () => host.discardSource() }, "Discard"),
      );
    } else if (!bound) {
      parts.push(h("span", { class: "muted" }, "No editable body on this page — this is the only place to edit it."));
    }
    replaceChildren(status, ...parts);
    status.hidden = parts.length === 0;
  };

  const open = () => {
    const { readOnly, text } = host.body();
    area.readOnly = readOnly;
    if (readOnly) area.value = text;
    else host.openSource(area);
    refresh();
  };

  const sync = (text: string) => {
    if (area.value === text) return;
    const start = Math.min(area.selectionStart, text.length);
    const end = Math.min(area.selectionEnd, text.length);
    const top = area.scrollTop;
    area.value = text;
    area.setSelectionRange(start, end);
    area.scrollTop = top;
  };

  return { el, area, open, refresh, sync };
}
