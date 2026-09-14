import type { EntryDoc, Frontmatter } from "../api";
import { slugError } from "../../shared/slug.js";
import { h, replaceChildren } from "../dom";
import { icon } from "../icons";
import { describe } from "./util";

/**
 * The Address row at the top of the popover: the entry's id in quiet
 * monospace, with a pencil on hover. Click it and the last segment becomes an
 * input in the same spot, the file path it would give underneath (like New
 * entry). Enter applies — the file or folder moves and the page follows —
 * Esc (or clicking away) puts the id back. What went wrong ("taken", a bad
 * character) shows under the row; nothing pops up.
 */
export interface AddressHost {
  doc(): EntryDoc | null;
  draft(): Frontmatter;
  /** Move the entry to its new address and navigate there; rejects with the reason when it can't. */
  rename(slug: string): Promise<void>;
}

export const PUBLISHED_NOTE = "Changing the address of a published post breaks existing links unless you add a redirect.";

export function renderAddressRow(host: AddressHost): HTMLElement | null {
  const doc = host.doc();
  if (!doc) return null;
  const segments = doc.id.split("/");
  const original = segments[segments.length - 1];
  const prefix = segments.slice(0, -1).map((s) => `${s}/`).join("");
  // A frontmatter `slug` names the entry, not the file: the file can move, the address wouldn't.
  const pinned = typeof doc.frontmatter.slug === "string";

  const side = h("div", { class: "row-side" });
  const below = h("div", { class: "address-below" });
  const row = h(
    "div",
    { class: "row address-row", "data-inline": "", "data-key": "address" },
    h("div", { class: "row-head" }, h("div", { class: "row-text" }, h("span", { class: "row-label" }, h("span", { class: "row-name" }, "Address"))), side),
    below,
  );

  const show = () => {
    replaceChildren(
      side,
      pinned
        ? h("span", { class: "row-static mono", "data-tip": "Set by the slug field" }, doc.id)
        : h("button", { class: "address", type: "button", "data-tip": "Change the address", onClick: edit }, h("span", { class: "mono" }, doc.id), icon("pencil", 12)),
    );
    replaceChildren(below);
  };

  const edit = () => {
    const input = h("input", {
      class: "input mono address-input",
      value: original,
      spellcheck: false,
      autocapitalize: "off",
      autocomplete: "off",
      "aria-label": "Address",
      // The popover closes on Escape; here Escape means "put the address back" and no more.
      "data-escape": "self",
    }) as HTMLInputElement;
    const where = h("div", { class: "muted mono address-path" });
    const note = h("div", { class: "address-note", hidden: true }, PUBLISHED_NOTE);
    const error = h("div", { class: "form-error" });
    const refresh = () => {
      const slug = input.value;
      where.textContent = pathFor(doc, slug || "…");
      const published = host.draft().draft !== true;
      note.hidden = !(published && slug !== original);
    };
    let busy = false;
    let done = false;
    const cancel = () => {
      if (done || busy) return;
      done = true;
      show();
    };
    const apply = async () => {
      if (busy || done) return;
      const slug = input.value;
      if (slug === original) return cancel();
      const problem = slugError(slug);
      if (problem) {
        error.textContent = problem;
        return;
      }
      busy = true;
      input.disabled = true;
      error.textContent = "";
      try {
        await host.rename(slug);
        done = true;
      } catch (err) {
        error.textContent = describe(err);
        input.disabled = false;
        input.focus();
      } finally {
        busy = false;
      }
    };
    input.addEventListener("input", () => {
      // Typed as it will be written: lowercase, spaces to dashes, nothing else.
      const clean = input.value.toLowerCase().replace(/\s+/g, "-").replace(/[^a-z0-9-]/g, "");
      if (clean !== input.value) input.value = clean;
      error.textContent = "";
      refresh();
    });
    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        void apply();
      } else if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        cancel();
      }
    });
    input.addEventListener("blur", () => window.setTimeout(cancel, 0));

    replaceChildren(side, prefix ? h("span", { class: "muted mono address-prefix" }, prefix) : null, input);
    replaceChildren(below, where, note, error);
    refresh();
    input.focus();
    input.select();
  };

  show();
  return row;
}

/** The file the entry would live in at `slug`: `src/content/blog/<slug>/` for a folder entry, `src/content/notes/<slug>.md` for a flat one. */
export function pathFor(doc: Pick<EntryDoc, "file" | "folder">, slug: string): string {
  const parts = doc.file.split("/");
  const name = parts.pop() ?? "";
  if (doc.folder) {
    parts.pop();
    return `${parts.join("/")}/${slug}/`;
  }
  const ext = name.includes(".") ? name.slice(name.lastIndexOf(".")) : "";
  return `${parts.join("/")}/${slug}${ext}`;
}
