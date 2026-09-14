import type { Collection, EntryDoc, Frontmatter } from "../api";
import { h } from "../dom";
import { icon } from "../icons";
import { helpFor, inferField, type CollectionSchema, type FieldDef } from "../schema";
import { makeControl } from "./controls";

/**
 * The Fields view: one row per field — humanized label, a line of help, and
 * the control the schema asks for. Rows follow the schema when there is one
 * (unset optional fields included, so the form shows what *can* be set); with
 * an inferred schema they follow the file, and fields can be added or removed.
 */
export interface FormHost {
  canvas: ShadowRoot;
  doc(): EntryDoc | null;
  schema(): CollectionSchema | null;
  draft(): Frontmatter;
  original(): Frontmatter;
  onPage(key: string): boolean;
  /** Leave this key out entirely (it's edited on the page). */
  omit?(key: string): boolean;
  collections(): Collection[];
  setField(key: string, value: unknown): void;
  removeField(key: string): void;
  revertField(key: string): void;
  changed(key: string): boolean;
}

/** Frontmatter keys that never get an input: they name the entry's address, which the Address row changes (by moving the file), not the form. */
export const READ_ONLY_KEYS = new Set(["slug", "id"]);

export function renderForm(host: FormHost, syncs: Map<string, () => void>): HTMLElement {
  const doc = host.doc();
  const schema = host.schema();
  syncs.clear();
  if (!doc || !schema) return h("div", { class: "form-empty" });

  const draft = host.draft();
  const original = host.original();
  const inferred = schema.source !== "zod";
  const byKey = new Map(schema.fields.map((f) => [f.key, f]));

  // Which keys, in which order.
  const keys: string[] = [];
  if (inferred) {
    for (const key of Object.keys(draft)) keys.push(key);
  } else {
    for (const f of schema.fields) keys.push(f.key);
    for (const key of Object.keys(draft)) if (!byKey.has(key)) keys.push(key);
  }

  const rows: HTMLElement[] = [];
  for (const key of keys) {
    if (host.omit?.(key)) continue;
    const value = draft[key];
    if (READ_ONLY_KEYS.has(key)) {
      rows.push(
        h(
          "div",
          { class: "row", "data-inline": "" },
          h("div", { class: "row-head" }, h("div", { class: "row-text" }, h("span", { class: "row-label" }, key), h("span", { class: "row-help" }, key === "slug" ? "Sets the address instead of the file name" : "Set by the file name; change it in Address")), h("div", { class: "row-side" }, h("span", { class: "row-static mono" }, String(value)))),
        ),
      );
      continue;
    }
    const def = byKey.get(key) ?? inferField(key, value);
    rows.push(renderRow(host, doc, def, value, key in draft, inferred || !byKey.has(key), syncs));
  }

  // Keys on disk that the draft dropped stay listed so the removal can be undone before it's written.
  for (const key of Object.keys(original)) {
    if (key in draft || (!inferred && byKey.has(key)) || host.omit?.(key)) continue;
    rows.push(
      h(
        "div",
        { class: "row row-removed", "data-inline": "" },
        h(
          "div",
          { class: "row-head" },
          h("div", { class: "row-text" }, h("span", { class: "row-label" }, byKey.get(key)?.label ?? inferField(key, original[key]).label), h("span", { class: "row-help" }, "Removed when you save")),
          h("div", { class: "row-side" }, h("button", { class: "btn btn-sm btn-ghost", type: "button", onClick: () => host.revertField(key) }, icon("undo", 13), "Restore")),
        ),
      ),
    );
  }

  const children: HTMLElement[] = [rows.length ? h("div", { class: "rows" }, rows) : h("p", { class: "empty" }, "No frontmatter yet.")];

  if (inferred) {
    const newKey = h("input", { class: "input", placeholder: "New field", "aria-label": "New field name", spellcheck: false, autocapitalize: "off" }) as HTMLInputElement;
    const add = () => {
      const key = newKey.value.trim();
      if (!key || key in host.draft() || READ_ONLY_KEYS.has(key)) return;
      host.setField(key, "");
    };
    newKey.addEventListener("keydown", (e) => {
      if (e.key === "Enter") add();
    });
    children.push(h("div", { class: "field-add" }, newKey, h("button", { class: "btn btn-icon", type: "button", "aria-label": "Add field", "data-tip": "Add field", onClick: add }, icon("plus", 14))));
  }

  return h("div", { class: "form" }, children);
}

function renderRow(host: FormHost, doc: EntryDoc, def: FieldDef, value: unknown, isSet: boolean, removable: boolean, syncs: Map<string, () => void>): HTMLElement {
  const key = def.key;
  const onPage = host.onPage(key);
  const note = h("div", { class: "row-note" });
  const revert = h(
    "button",
    { class: "row-revert", type: "button", "aria-label": `Revert ${def.label}`, "data-tip": "Back to the saved value", hidden: !host.changed(key), onClick: () => host.revertField(key) },
    icon("undo", 12),
  ) as HTMLButtonElement;

  const control = makeControl(def, value, {
    canvas: host.canvas,
    doc,
    collections: () => host.collections(),
    note: (t) => (note.textContent = t),
    onChange: (next) => {
      if (next === undefined) host.removeField(key);
      else host.setField(key, next);
      revert.hidden = !host.changed(key);
      row.toggleAttribute("data-unset", !(key in host.draft()));
    },
  });

  // The page (or the YAML view) can change this field too: mirror it here unless this control has the caret.
  syncs.set(key, () => {
    revert.hidden = !host.changed(key);
    row.toggleAttribute("data-unset", !(key in host.draft()));
    control.set(host.draft()[key]);
  });

  const remove = removable
    ? h(
        "button",
        { class: "row-remove", type: "button", "aria-label": `Remove ${def.label}`, "data-tip": "Remove field", onClick: () => host.removeField(key) },
        icon("close", 12),
      )
    : null;

  const row = h(
    "div",
    { class: "row", "data-key": key, "data-type": def.type, "data-inline": control.inline ? "" : null, "data-on-page": onPage ? "" : null, "data-unset": isSet ? null : "" },
    h(
      "div",
      { class: "row-head" },
      h(
        "div",
        { class: "row-text" },
        h(
          "span",
          { class: "row-label" },
          h("span", { class: "row-name" }, def.label),
          def.required ? h("span", { class: "req", "aria-hidden": "true" }, "*") : null,
          onPage ? h("span", { class: "on-page" }, "on page") : null,
        ),
        h("span", { class: "row-help" }, helpFor(def)),
      ),
      h("div", { class: "row-side" }, revert, control.inline ? control.el : null, remove),
    ),
    control.inline ? null : control.el,
    note,
  );
  return row;
}

