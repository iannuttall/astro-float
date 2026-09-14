import { api, type Collection, type EntryDoc } from "../api";
import { h, replaceChildren } from "../dom";
import { icon } from "../icons";
import { routeFor } from "../page";
import { renderDeleteLine } from "./confirm";
import { describe, keepInView, slugify } from "./util";

/**
 * The panel's footer: which collection, its entries (the current one marked),
 * and the two create flows — a new entry here, or a whole new collection.
 * The entries end with a quiet "Delete collection", so it's only there with
 * the list open.
 */
export interface CollectionHost {
  doc(): EntryDoc | null;
  collections(): Collection[];
  listCollection(): string | null;
  setListCollection(name: string): void;
  navigate(href: string, opts?: { focusBody?: boolean }): Promise<void>;
  notify(message: string): void;
  releaseFocus(): void;
  /** Delete the collection (folder, media, config) and go home; rejects when it can't (the pill says why). */
  deleteCollection(name: string): Promise<void>;
}

export interface FootState {
  open: boolean;
}

export function renderCollectionFooter(host: CollectionHost, state: FootState, rerender: () => void): HTMLElement {
  const collections = host.collections();
  const selected = collections.find((c) => c.name === host.listCollection()) ?? collections[0];
  if (selected) host.setListCollection(selected.name);

  const formHost = h("div");
  let openForm: "entry" | "collection" | null = null;
  // Cancel/close puts the list back exactly as it was: keyboard down, no zoom left behind.
  const setForm = (kind: "entry" | "collection" | null) => {
    openForm = kind;
    if (kind === null) host.releaseFocus();
    replaceChildren(formHost, kind === "entry" && selected ? renderNewEntryForm(host, selected, () => setForm(null)) : kind === "collection" ? renderNewCollectionForm(host, () => setForm(null)) : null);
  };

  const picker = !selected
    ? h("span", { class: "muted" }, "No collections yet")
    : collections.length > 1
      ? (h(
          "select",
          {
            class: "select select-inline",
            "aria-label": "Collection",
            onChange: (e: Event) => {
              host.setListCollection((e.target as HTMLSelectElement).value);
              state.open = true;
              rerender();
            },
          },
          collections.map((c) => h("option", { value: c.name, selected: c.name === selected.name }, c.name)),
        ) as HTMLSelectElement)
      : h("span", { class: "foot-name" }, selected.name);

  const list = h("div", { class: "list" });
  if (selected) {
    if (!selected.entries.length) list.appendChild(h("p", { class: "empty" }, "This collection is empty."));
    for (const entry of selected.entries) {
      const doc = host.doc();
      const isCurrent = doc?.collection === selected.name && doc.id === entry.id;
      const route = routeFor(selected, entry.id);
      list.appendChild(
        h(
          "a",
          { class: "list-item", href: route.href, "aria-current": isCurrent ? "page" : null, "data-tip": route.guessed ? `${entry.id} · guessed route` : entry.id },
          h("span", { class: "title" }, entry.title),
          isCurrent ? icon("check", 13) : null,
        ),
      );
    }
    list.appendChild(renderDeleteLine("Delete collection", () => host.deleteCollection(selected.name)));
  }
  list.appendChild(
    h(
      "button",
      { class: "list-item list-action", type: "button", "data-tip": "New collection under src/content/", onClick: () => setForm(openForm === "collection" ? null : "collection") },
      icon("folderPlus", 14),
      h("span", { class: "title" }, "New collection"),
    ),
  );

  const count = selected ? selected.entries.length : 0;
  const toggle = h(
    "button",
    {
      class: "foot-toggle",
      type: "button",
      "aria-expanded": String(state.open),
      "data-tip": state.open ? "Hide entries" : "Show entries",
      onClick: () => {
        state.open = !state.open;
        toggle.setAttribute("aria-expanded", String(state.open));
        body.hidden = !state.open;
      },
    },
    icon("chevronDown", 14),
    h("span", { class: "foot-count" }, count === 1 ? "1 entry" : `${count} entries`),
  );

  const body = h("div", { class: "foot-body", hidden: !state.open }, formHost, list);

  return h(
    "footer",
    { class: "foot" },
    h(
      "div",
      { class: "foot-bar" },
      picker,
      toggle,
      selected
        ? h(
            "button",
            {
              class: "btn btn-sm",
              type: "button",
              "data-tip": `New entry in ${selected.name}`,
              onClick: () => {
                if (!state.open) {
                  state.open = true;
                  toggle.setAttribute("aria-expanded", "true");
                  body.hidden = false;
                }
                setForm(openForm === "entry" ? null : "entry");
              },
            },
            icon("plus", 13),
            "New entry",
          )
        : null,
    ),
    body,
  );
}

/** Title only — the slug is derived and shown, never edited. */
function renderNewEntryForm(host: CollectionHost, collection: Collection, close: () => void): HTMLElement {
  const title = h("input", { class: "input", placeholder: "Title", autocomplete: "off" }) as HTMLInputElement;
  const where = h("div", { class: "muted mono" }, `${collection.dir}/…`);
  const error = h("div", { class: "form-error" });
  title.addEventListener("input", () => {
    const s = slugify(title.value);
    where.textContent = `${collection.dir}/${s || "…"}/`;
  });

  const submit = async () => {
    const s = slugify(title.value);
    if (!s) {
      error.textContent = "Give it a title";
      return;
    }
    create.disabled = true;
    error.textContent = "";
    try {
      const created = await api.create({ collection: collection.name, slug: s, title: title.value.trim() });
      await host.navigate(routeFor(collection, created.id).href, { focusBody: true });
    } catch (err) {
      error.textContent = describe(err);
      create.disabled = false;
    }
  };

  const create = h("button", { class: "btn btn-primary", type: "button", onClick: () => void submit() }, "Create entry") as HTMLButtonElement;
  const form = h(
    "div",
    { class: "card" },
    h("div", { class: "card-title" }, `New entry in ${collection.name}`),
    h("label", null, "Title", title, where),
    error,
    h("div", { class: "card-actions" }, h("button", { class: "btn btn-ghost", type: "button", onClick: close }, "Cancel"), create),
  );
  form.addEventListener("keydown", (e) => {
    if (e.key === "Enter") void submit();
  });
  keepInView(form);
  queueMicrotask(() => title.focus({ preventScroll: true }));
  return form;
}

function renderNewCollectionForm(host: CollectionHost, close: () => void): HTMLElement {
  const name = h("input", { class: "input", placeholder: "til", spellcheck: false, autocapitalize: "off", autocomplete: "off" }) as HTMLInputElement;
  const first = h("input", { class: "input", placeholder: "First entry", value: "First entry", autocomplete: "off" }) as HTMLInputElement;
  const error = h("div", { class: "form-error" });
  const preview = h("div", { class: "muted mono" }, "src/content/…/");

  name.addEventListener("input", () => {
    name.value = name.value.toLowerCase().replace(/[^a-z0-9-]+/g, "-").replace(/^-+/, "");
    preview.textContent = `src/content/${name.value || "…"}/ · registered in content.config.ts`;
  });

  const submit = async () => {
    const n = name.value.replace(/-+$/, "");
    if (!/^[a-z][a-z0-9-]*$/.test(n)) {
      error.textContent = "Name must start with a letter: a-z, 0-9, dashes";
      return;
    }
    create.disabled = true;
    error.textContent = "";
    try {
      const created = await api.createCollection({ name: n, title: first.value.trim() || "First entry" });
      if (!created.config.updated) host.notify(created.config.note ?? "content.config.ts not updated");
      host.setListCollection(created.collection);
      await host.navigate(routeFor({ name: created.collection, dir: created.dir, entries: [] }, created.id).href, { focusBody: true });
    } catch (err) {
      error.textContent = describe(err);
      create.disabled = false;
    }
  };

  const create = h("button", { class: "btn btn-primary", type: "button", onClick: () => void submit() }, "Create collection") as HTMLButtonElement;
  const form = h(
    "div",
    { class: "card" },
    h("div", { class: "card-title" }, "New collection"),
    h("label", null, "Name", name, preview),
    h("label", null, "First entry title", first),
    h("p", { class: "card-note" }, "Creates the folder, adds a defineCollection() with a starter schema to content.config.ts, and seeds one entry."),
    error,
    h("div", { class: "card-actions" }, h("button", { class: "btn btn-ghost", type: "button", onClick: close }, "Cancel"), create),
  );
  form.addEventListener("keydown", (e) => {
    if (e.key === "Enter") void submit();
  });
  keepInView(form);
  queueMicrotask(() => name.focus({ preventScroll: true }));
  return form;
}
