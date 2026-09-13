import type { EntryDoc } from "../api";
import { h } from "../dom";

/** Behind the gear: autosave, the on-page cheat sheet, and where this entry lives. */
export interface SettingsHost {
  autosave(): boolean;
  setAutosave(on: boolean): void;
  doc(): EntryDoc | null;
  body(): { bound: boolean; mapped: boolean; readOnly: boolean };
}

export function renderSettings(host: SettingsHost): HTMLElement {
  const autosave = h(
    "button",
    {
      class: "setting toggle",
      type: "button",
      role: "switch",
      "aria-checked": String(host.autosave()),
      onClick: () => {
        const next = !host.autosave();
        host.setAutosave(next);
        autosave.setAttribute("aria-checked", String(next));
      },
    },
    h("div", null, h("div", { class: "label" }, "Autosave"), h("div", { class: "desc" }, "Write to disk shortly after you stop typing")),
    h("span", { class: "switch" }),
  );

  const doc = host.doc();
  const body = host.body();
  const bodyState = !doc
    ? "No entry bound to this page."
    : body.readOnly
      ? `${doc.file} — MDX blocks unmapped; body read-only, fields editable.`
      : body.bound
        ? `Editing ${doc.file} in place${body.mapped ? "" : " (blocks unmapped — whole body re-serialized on save)"}.`
        : `${doc.file} — no editable body on this page; use the Markdown tab.`;

  return h(
    "div",
    { class: "settings" },
    h("div", { class: "settings-title" }, "Settings"),
    autosave,
    h(
      "div",
      { class: "setting" },
      h(
        "div",
        null,
        h("div", { class: "label" }, "On the page"),
        h(
          "div",
          { class: "desc" },
          "Hover anything grey to edit it · select text for bold / italic / link · ⌘/Ctrl+S save · ⌘B / ⌘I / ⌘K · Tab / ⇧Tab nest lists · type “# ”, “- ”, “1. ”, “> ”, “```” at a line start · drop or paste images into the text · click a component block to move or remove it · the small control above a region copies its Markdown or opens it as source · Esc leaves the text",
        ),
      ),
    ),
    h("div", { class: "meta" }, bodyState, h("br"), "astro-float · dev only · writes stay on localhost"),
  );
}
