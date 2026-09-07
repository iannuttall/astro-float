import { api, ApiError, type Collection, type EntryDoc, type Frontmatter, type MediaItem } from "./api";
import { h, replaceChildren } from "./dom";
import { PageEditor } from "./editor";
import { icon } from "./icons";
import { detectEntry, routeFor, swapPage, type DetectedEntry } from "./page";
import { STYLES } from "./styles";

type PanelId = "fields" | "media" | "collection" | "source" | "settings";
type Side = "left" | "right";
type Status = "idle" | "saving" | "refreshing" | "saved" | "error" | "conflict";

interface Prefs {
  side: Side;
  autosave: boolean;
  panel: PanelId | null;
}

const PREFS_KEY = "astro-float:prefs";
const OPEN_KEY = "astro-float:open";
const AUTOSAVE_DELAY = 800;

const ENTRY_PANELS: PanelId[] = ["fields", "media", "source"];
const PANEL_TITLES: Record<PanelId, string> = {
  fields: "Fields",
  media: "Images",
  collection: "Collection",
  source: "Source",
  settings: "Settings",
};

export interface FloatHandle {
  setOpen(open: boolean): void;
}

export function mountFloat(canvas: ShadowRoot): FloatHandle {
  const float = new Float(canvas);
  return { setOpen: (open) => float.setOpen(open) };
}

class Float {
  private root: HTMLElement;
  private rail: HTMLElement;
  private panelHost: HTMLElement;
  private statusSlot: HTMLElement;

  private prefs: Prefs = loadPrefs();
  private open = false;
  private loaded = false;
  private loading: Promise<void> | null = null;

  private collections: Collection[] = [];
  private detected: DetectedEntry | null = null;
  private doc: EntryDoc | null = null;
  private draftFrontmatter: Frontmatter = {};
  /** Body draft used only when the page has no `[data-float-body]` to edit in place. */
  private draftBody = "";
  private media: MediaItem[] | null = null;
  private listCollection: string | null = null;

  private page: PageEditor;

  private status: Status = "idle";
  private statusMessage = "";
  private savedAt: number | null = null;
  private saving = false;
  private autosaveTimer: number | undefined;
  private savedTimer: number | undefined;

  private footStatus: HTMLElement | null = null;
  private footActions: HTMLElement | null = null;
  private sourceView: HTMLTextAreaElement | null = null;

  constructor(private canvas: ShadowRoot) {
    const style = document.createElement("style");
    style.textContent = STYLES;
    canvas.appendChild(style);

    this.rail = h("nav", { class: "rail", "aria-label": "Float" });
    this.panelHost = h("div");
    this.statusSlot = h("div", { class: "status-slot" });
    this.root = h("div", { class: "float", "data-side": this.prefs.side }, this.rail, this.panelHost);
    canvas.appendChild(this.root);

    this.page = new PageEditor({
      onChange: () => this.touched(),
      onFiles: (files, range) => void this.uploadAll(files, range),
    });

    // Escape inside the rail should drop focus, not close the whole float.
    this.root.addEventListener("keyup", (e) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        (this.canvas.activeElement as HTMLElement | null)?.blur();
      }
    });
    this.root.addEventListener("keydown", (e) => {
      if (e.key === "Escape") e.stopPropagation();
    });
    document.addEventListener("keydown", (e) => {
      if (!this.open) return;
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "s") {
        e.preventDefault();
        void this.save();
      }
    });
    window.addEventListener("beforeunload", (e) => {
      if (this.isDirty()) e.preventDefault();
    });

    this.renderRail();
  }

  // ---- lifecycle ------------------------------------------------------------

  setOpen(open: boolean) {
    this.open = open;
    if (open) {
      sessionStorage.setItem(OPEN_KEY, "1");
      void this.ensureLoaded().then(() => {
        this.page.attach();
        if (this.prefs.panel !== null) this.showPanel(this.prefs.panel, false);
      });
    } else {
      sessionStorage.removeItem(OPEN_KEY);
      this.page.detach();
    }
  }

  private ensureLoaded() {
    if (this.loaded) return Promise.resolve();
    if (!this.loading) this.loading = this.load();
    return this.loading;
  }

  private async load() {
    try {
      this.collections = await api.collections();
      this.detected = detectEntry(this.collections);
      if (this.detected) {
        this.doc = await api.entry(this.detected.collection, this.detected.id);
        this.draftFrontmatter = clone(this.doc.frontmatter);
        this.draftBody = this.doc.body;
        this.listCollection = this.doc.collection;
        this.bindBody();
      } else {
        this.listCollection = this.collections[0]?.name ?? null;
        if (this.prefs.panel && ENTRY_PANELS.includes(this.prefs.panel)) this.prefs.panel = "collection";
      }
      if (this.prefs.panel === null && !this.detected) this.prefs.panel = "collection";
    } catch (err) {
      this.setStatus("error", describe(err));
    }
    this.loaded = true;
    this.renderRail();
  }

  /** Attach the in-place editor to `[data-float-body]` on the current DOM. */
  private bindBody() {
    if (!this.doc) return;
    const container = PageEditor.find();
    if (!container) {
      this.page.unbind();
      return;
    }
    this.page.bind(container, { lead: this.doc.lead, blocks: this.doc.blocks }, this.doc.absDir);
    if (this.open) this.page.attach();
  }

  private async reloadFromDisk() {
    if (!this.detected) return;
    this.doc = await api.entry(this.detected.collection, this.detected.id);
    this.draftFrontmatter = clone(this.doc.frontmatter);
    this.draftBody = this.doc.body;
    this.media = null;
    this.setStatus("refreshing");
    try {
      await swapPage();
    } catch {
      /* keep current DOM */
    }
    this.bindBody();
    this.setStatus("idle");
    this.renderPanel();
  }

  // ---- state helpers ----------------------------------------------------------

  private frontmatterDirty() {
    return !!this.doc && JSON.stringify(this.draftFrontmatter) !== JSON.stringify(this.doc.frontmatter);
  }

  private bodyDirty() {
    if (!this.doc) return false;
    return this.page.bound ? this.page.isDirty() : this.draftBody !== this.doc.body;
  }

  private isDirty() {
    return this.frontmatterDirty() || this.bodyDirty();
  }

  private currentBody(): string {
    return this.page.bound ? this.page.toMarkdown() : this.draftBody;
  }

  private setStatus(status: Status, message = "") {
    this.status = status;
    this.statusMessage = message;
    this.renderStatus();
  }

  private touched() {
    if (this.status === "saved" || this.status === "error") this.status = "idle";
    this.renderStatus();
    if (this.sourceView) this.sourceView.value = this.currentBody();
    if (this.prefs.autosave) this.scheduleAutosave();
  }

  private scheduleAutosave() {
    window.clearTimeout(this.autosaveTimer);
    this.autosaveTimer = window.setTimeout(() => void this.save(), AUTOSAVE_DELAY);
  }

  private savePrefs() {
    localStorage.setItem(PREFS_KEY, JSON.stringify(this.prefs));
  }

  // ---- saving -----------------------------------------------------------------

  private async save(force = false) {
    if (!this.doc || this.saving) return;
    if (!this.isDirty() && !force) return;
    window.clearTimeout(this.autosaveTimer);

    this.saving = true;
    this.setStatus("saving");
    const frontmatter = clone(this.draftFrontmatter);
    const snapshot = this.page.bound ? this.page.snapshotForSave() : null;
    const body = snapshot ? snapshot.markdown : this.draftBody;
    // Re-rendering from the server would move the caret; skip it while the
    // user is typing in the body and let their DOM stand as the preview.
    const refresh = !this.page.hasFocus();

    try {
      const result = await api.save({
        collection: this.doc.collection,
        id: this.doc.id,
        frontmatter,
        body,
        baseHash: this.doc.hash,
        force,
      });
      this.doc = { ...this.doc, frontmatter, body: result.body, lead: result.lead, blocks: result.blocks, hash: result.hash };
      if (snapshot) this.page.commit(snapshot, { lead: result.lead, blocks: result.blocks });
      // Source-only mode: adopt the server's normalized text unless more was typed meanwhile.
      else if (this.draftBody === body) this.draftBody = result.body;

      if (result.changed && refresh) {
        this.setStatus("refreshing");
        try {
          await swapPage();
          this.bindBody();
        } catch (err) {
          console.warn("[astro-float] page refresh failed", err);
        }
        void this.refreshCollections();
      }

      this.savedAt = Date.now();
      this.setStatus("saved");
      window.clearTimeout(this.savedTimer);
      this.savedTimer = window.setTimeout(() => {
        if (this.status === "saved") this.setStatus("idle");
      }, 2000);
    } catch (err) {
      if (err instanceof ApiError && err.status === 409) this.setStatus("conflict");
      else this.setStatus("error", describe(err));
    } finally {
      this.saving = false;
      if (this.isDirty() && this.prefs.autosave && this.status !== "conflict" && this.status !== "error") {
        this.scheduleAutosave();
      } else {
        this.renderStatus();
      }
    }
  }

  private async refreshCollections() {
    try {
      this.collections = await api.collections();
      if (this.prefs.panel === "collection") this.renderPanel();
    } catch {
      /* non-fatal */
    }
  }

  // ---- rail -------------------------------------------------------------------

  private renderRail() {
    const hasEntry = !!this.doc;
    const button = (id: PanelId, tip: string) =>
      h(
        "button",
        {
          class: "rail-btn",
          type: "button",
          "data-tip": ENTRY_PANELS.includes(id) && !hasEntry ? `${tip} · no entry on this page` : tip,
          "aria-label": tip,
          "aria-pressed": String(this.prefs.panel === id && this.panelHost.childElementCount > 0),
          disabled: ENTRY_PANELS.includes(id) && !hasEntry,
          onClick: () => this.togglePanel(id),
        },
        icon(id),
      );

    replaceChildren(
      this.rail,
      button("fields", "Fields"),
      button("media", "Images"),
      button("collection", "Collection"),
      h("span", { class: "rail-sep" }),
      button("source", "Source"),
      button("settings", "Settings"),
      this.statusSlot,
    );
    this.renderStatus();
  }

  private togglePanel(id: PanelId) {
    if (this.prefs.panel === id && this.panelHost.childElementCount > 0) {
      this.closePanel();
      return;
    }
    this.showPanel(id, true);
  }

  private closePanel() {
    this.panelHost.textContent = "";
    this.sourceView = null;
    this.footStatus = null;
    this.footActions = null;
    this.renderRail();
  }

  private showPanel(id: PanelId, persist: boolean) {
    this.prefs.panel = id;
    if (persist) this.savePrefs();
    this.renderPanel();
    this.renderRail();
  }

  // ---- panel shell --------------------------------------------------------------

  private renderPanel() {
    const id = this.prefs.panel;
    if (!id) return;
    this.footStatus = null;
    this.footActions = null;
    this.sourceView = null;

    const sub = this.doc ? `${this.doc.collection}/${this.doc.id}` : "no entry on this page";
    const head = h(
      "header",
      { class: "panel-head" },
      h("span", { class: "panel-title" }, PANEL_TITLES[id]),
      h("span", { class: "panel-sub", title: this.doc?.file ?? "" }, sub),
      h("button", { class: "icon-btn", type: "button", "aria-label": "Collapse", onClick: () => this.closePanel() }, icon("close", 14)),
    );

    let body: HTMLElement;
    let showFoot = false;
    switch (id) {
      case "fields":
        body = this.renderFields();
        showFoot = true;
        break;
      case "media":
        body = this.renderMedia();
        showFoot = true;
        break;
      case "source":
        body = this.renderSource();
        showFoot = true;
        break;
      case "collection":
        body = this.renderCollection();
        break;
      default:
        body = this.renderSettings();
    }

    const panel = h("section", { class: "panel", "data-panel": id }, head, body);
    if (showFoot && this.doc) {
      this.footStatus = h("span", { class: "foot-status" });
      this.footActions = h("div", { style: { display: "flex", gap: "6px" } });
      panel.appendChild(h("footer", { class: "panel-foot" }, this.footStatus, this.footActions));
    }
    replaceChildren(this.panelHost, panel);
    this.renderStatus();
  }

  private renderStatus() {
    const dirty = this.isDirty();
    const busy = this.status === "saving" || this.status === "refreshing";
    const dotState = busy
      ? "saving"
      : this.status === "error" || this.status === "conflict"
        ? this.status
        : this.status === "saved"
          ? "saved"
          : dirty
            ? "dirty"
            : "idle";

    // The rail's bottom slot is either the status dot or, when there's something
    // to save and autosave is off, the Save button itself.
    const showRailSave = dirty && !busy && !this.prefs.autosave && this.status !== "conflict";
    replaceChildren(
      this.statusSlot,
      showRailSave
        ? h(
            "button",
            { class: "rail-save", type: "button", "data-tip": "Save · ⌘S", "aria-label": "Save", onClick: () => void this.save() },
            icon("check", 14),
          )
        : h("span", {
            class: "status-dot",
            "data-state": dotState,
            title: dotState === "dirty" ? "Unsaved changes" : dotState === "saved" ? "Saved" : this.statusMessage || "",
          }),
    );

    if (!this.footStatus || !this.footActions) return;

    let text = "";
    let tone = "";
    const actions: HTMLElement[] = [];

    switch (this.status) {
      case "saving":
        text = "Saving…";
        break;
      case "refreshing":
        text = "Updating page…";
        break;
      case "conflict":
        text = "Changed on disk";
        tone = "warn";
        actions.push(
          h("button", { class: "btn btn-sm", type: "button", onClick: () => void this.reloadFromDisk() }, "Reload"),
          h("button", { class: "btn btn-sm btn-primary", type: "button", onClick: () => void this.save(true) }, "Overwrite"),
        );
        break;
      case "error":
        text = this.statusMessage || "Something went wrong";
        tone = "err";
        if (dirty) actions.push(h("button", { class: "btn btn-sm", type: "button", onClick: () => void this.save() }, "Retry"));
        break;
      case "saved":
        text = "Saved";
        break;
      default:
        if (dirty) {
          text = this.prefs.autosave ? "Unsaved · autosave on" : "Unsaved changes";
          if (!this.prefs.autosave) {
            actions.push(h("button", { class: "btn btn-sm btn-primary", type: "button", onClick: () => void this.save() }, "Save"));
          }
        } else {
          text = this.savedAt ? `Saved ${formatTime(this.savedAt)}` : "Up to date";
        }
    }

    this.footStatus.textContent = text;
    if (tone) this.footStatus.dataset.tone = tone;
    else delete this.footStatus.dataset.tone;
    if (this.prefs.panel === "source") {
      actions.unshift(
        h(
          "button",
          {
            class: "btn btn-sm btn-ghost",
            type: "button",
            onClick: () => void navigator.clipboard?.writeText(this.currentBody()),
          },
          icon("copy", 12),
          "Copy",
        ),
      );
    }
    replaceChildren(this.footActions, actions);
  }

  // ---- source (escape hatch) --------------------------------------------------------

  private renderSource(): HTMLElement {
    if (!this.doc) return this.renderNoEntry();
    const editable = !this.page.bound;
    const view = h("textarea", {
      class: "source-view",
      spellcheck: false,
      readOnly: !editable,
      value: this.currentBody(),
      "aria-label": "Markdown source",
      onInput: () => {
        if (!editable) return;
        this.draftBody = view.value;
        this.touched();
      },
    }) as HTMLTextAreaElement;
    this.sourceView = view;

    const note = editable
      ? [
          "No ",
          h("code", null, "data-float-body"),
          " element on this page, so the body can only be edited here. Add the attribute to the element that wraps ",
          h("code", null, "<Content />"),
          " to edit on the page.",
        ]
      : [
          "Read-only. This is the Markdown that Save writes to disk",
          this.page.mapped ? " — untouched blocks are kept byte-for-byte." : ". Blocks didn't line up with the source, so the whole body is re-serialized.",
        ];

    return h("div", { class: "panel-body source" }, h("p", { class: "source-note" }, ...note), view);
  }

  // ---- fields ---------------------------------------------------------------------

  private renderFields(): HTMLElement {
    if (!this.doc) return this.renderNoEntry();
    const container = h("div", { class: "panel-body pad" });
    const rerender = () => this.renderPanel();

    for (const [key, value] of Object.entries(this.draftFrontmatter)) {
      container.appendChild(this.renderField(key, value, rerender));
    }

    const newKey = h("input", { class: "input", placeholder: "New field name", "aria-label": "New field name" }) as HTMLInputElement;
    const add = () => {
      const key = newKey.value.trim();
      if (!key || key in this.draftFrontmatter) return;
      this.draftFrontmatter[key] = "";
      this.touched();
      rerender();
    };
    newKey.addEventListener("keydown", (e) => {
      if (e.key === "Enter") add();
    });
    container.appendChild(
      h("div", { class: "field-add" }, newKey, h("button", { class: "btn", type: "button", onClick: add }, icon("plus", 13), "Add")),
    );
    return container;
  }

  private renderField(key: string, value: unknown, rerender: () => void): HTMLElement {
    const kind = fieldKind(value);
    const set = (next: unknown) => {
      this.draftFrontmatter[key] = next;
      this.touched();
    };

    let control: HTMLElement;
    switch (kind) {
      case "boolean": {
        const hint = h("span", { class: "field-hint" }, value ? "true" : "false");
        const row = h(
          "button",
          {
            class: "toggle-row",
            type: "button",
            role: "switch",
            "aria-checked": String(Boolean(value)),
            "aria-label": key,
            onClick: () => {
              const next = row.getAttribute("aria-checked") !== "true";
              row.setAttribute("aria-checked", String(next));
              hint.textContent = next ? "true" : "false";
              set(next);
            },
          },
          hint,
          h("span", { class: "switch" }),
        );
        control = row;
        break;
      }
      case "number": {
        const input = h("input", { class: "input", type: "number", step: "any", value: String(value) }) as HTMLInputElement;
        input.addEventListener("input", () => {
          if (input.value === "") return;
          const n = Number(input.value);
          if (!Number.isNaN(n)) set(n);
        });
        control = input;
        break;
      }
      case "date": {
        const input = h("input", { class: "input", type: "date", value: String(value).slice(0, 10) }) as HTMLInputElement;
        input.addEventListener("input", () => {
          if (input.value) set(input.value);
        });
        control = input;
        break;
      }
      case "tags": {
        const input = h("input", { class: "input", value: (value as unknown[]).join(", "), placeholder: "comma, separated" }) as HTMLInputElement;
        const allNumbers = (value as unknown[]).length > 0 && (value as unknown[]).every((v) => typeof v === "number");
        input.addEventListener("input", () => {
          const parts = input.value.split(",").map((s) => s.trim()).filter(Boolean);
          set(allNumbers ? parts.map(Number).filter((n) => !Number.isNaN(n)) : parts);
        });
        control = input;
        break;
      }
      case "text": {
        const ta = h("textarea", { class: "textarea", rows: 3, value: String(value) }) as HTMLTextAreaElement;
        ta.addEventListener("input", () => set(ta.value));
        control = ta;
        break;
      }
      case "json": {
        const ta = h("textarea", { class: "textarea mono", rows: 4, value: JSON.stringify(value, null, 2) }) as HTMLTextAreaElement;
        ta.addEventListener("input", () => {
          try {
            set(JSON.parse(ta.value));
            delete ta.dataset.invalid;
          } catch {
            ta.dataset.invalid = "";
          }
        });
        control = ta;
        break;
      }
      default: {
        const input = h("input", { class: "input", type: "text", value: value == null ? "" : String(value) }) as HTMLInputElement;
        input.addEventListener("input", () => set(input.value));
        control = input;
      }
    }

    return h(
      "div",
      { class: "field" },
      h(
        "div",
        { class: "field-head" },
        h("span", { class: "field-key" }, key),
        h("span", { class: "field-type" }, kind === "string" ? "text" : kind),
        h(
          "button",
          {
            class: "field-remove",
            type: "button",
            "aria-label": `Remove ${key}`,
            title: "Remove field",
            onClick: () => {
              delete this.draftFrontmatter[key];
              this.touched();
              rerender();
            },
          },
          icon("close", 12),
        ),
      ),
      control,
    );
  }

  // ---- media ----------------------------------------------------------------------

  private renderMedia(): HTMLElement {
    if (!this.doc) return this.renderNoEntry();
    const container = h("div", { class: "panel-body pad" });

    const fileInput = h("input", { type: "file", accept: "image/*", multiple: true, style: { display: "none" } }) as HTMLInputElement;
    fileInput.addEventListener("change", () => {
      if (fileInput.files?.length) void this.uploadAll(Array.from(fileInput.files), null);
      fileInput.value = "";
    });

    const zone = h(
      "div",
      { class: "dropzone", role: "button", tabindex: "0", onClick: () => fileInput.click() },
      icon("upload", 16),
      h("div", null, h("strong", null, "Drop images"), " here or on the page"),
      h("div", { style: { fontSize: "11px", color: "var(--fg-faint)" } }, `Saved next to ${this.doc.file.split("/").slice(-2).join("/")}`),
    );
    zone.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        fileInput.click();
      }
    });
    bindDropzone(zone, (files) => void this.uploadAll(files, null));

    const grid = h("div", { class: "media-grid" });
    const renderGrid = () => {
      replaceChildren(
        grid,
        (this.media ?? []).map((m) =>
          h(
            "button",
            { class: "media-item", type: "button", title: `Insert ${m.name}`, onClick: () => this.placeImage(m, null) },
            h("img", { src: m.url, alt: m.name, loading: "lazy" }),
            h("span", null, m.name),
          ),
        ),
      );
    };

    if (this.media) renderGrid();
    else {
      void api
        .media(this.doc.collection, this.doc.id)
        .then((items) => {
          this.media = items;
          renderGrid();
        })
        .catch((err) => this.setStatus("error", describe(err)));
    }

    container.append(fileInput, zone, grid);
    container.appendChild(
      h("p", { class: "field-hint", style: { marginTop: "12px" } }, "Click an image to insert it after the paragraph you're in."),
    );
    return container;
  }

  private placeImage(item: MediaItem, range: Range | null) {
    if (this.page.bound) {
      this.page.insertImage(item.url, altFrom(item.name), range);
    } else {
      const sep = this.draftBody === "" || this.draftBody.endsWith("\n\n") ? "" : this.draftBody.endsWith("\n") ? "\n" : "\n\n";
      this.draftBody = `${this.draftBody}${sep}![${altFrom(item.name)}](${item.src})\n`;
      this.touched();
    }
  }

  private async uploadAll(files: File[], range: Range | null) {
    if (!this.doc) return;
    const images = files.filter((f) => f.type.startsWith("image/") || /\.(png|jpe?g|gif|webp|avif|svg)$/i.test(f.name));
    if (!images.length) {
      this.setStatus("error", "Only images can be dropped here");
      return;
    }
    this.setStatus("saving");
    try {
      for (const file of images) {
        const saved = await api.upload(this.doc.collection, this.doc.id, file);
        this.media = [...(this.media ?? []).filter((m) => m.name !== saved.name), saved].sort((a, b) => a.name.localeCompare(b.name));
        this.placeImage(saved, range);
        range = null;
      }
      this.setStatus("idle");
      if (this.prefs.panel === "media") this.renderPanel();
    } catch (err) {
      this.setStatus("error", describe(err));
    }
  }

  // ---- collection -----------------------------------------------------------------

  private renderCollection(): HTMLElement {
    const container = h("div", { class: "panel-body" });
    if (!this.collections.length) {
      container.appendChild(
        h("p", { class: "empty" }, "No collections found. Float looks for directories with Markdown under ", h("code", null, "src/content/"), "."),
      );
      return container;
    }

    const selected = this.collections.find((c) => c.name === this.listCollection) ?? this.collections[0];
    this.listCollection = selected.name;

    let creating = false;
    const formHost = h("div");

    const picker =
      this.collections.length > 1
        ? (h(
            "select",
            {
              class: "select",
              "aria-label": "Collection",
              onChange: (e: Event) => {
                this.listCollection = (e.target as HTMLSelectElement).value;
                this.renderPanel();
              },
            },
            this.collections.map((c) => h("option", { value: c.name, selected: c.name === selected.name }, c.name)),
          ) as HTMLSelectElement)
        : h("span", { style: { fontWeight: "500" } }, selected.name);

    const toolbar = h(
      "div",
      { class: "toolbar-row" },
      h("div", { class: "grow" }, picker),
      h(
        "button",
        {
          class: "btn",
          type: "button",
          onClick: () => {
            creating = !creating;
            replaceChildren(
              formHost,
              creating
                ? this.renderNewEntryForm(selected, () => {
                    creating = false;
                    formHost.textContent = "";
                  })
                : null,
            );
          },
        },
        icon("plus", 13),
        "New",
      ),
    );

    const list = h("div", { class: "list" });
    if (!selected.entries.length) list.appendChild(h("p", { class: "empty" }, "This collection is empty."));
    for (const entry of selected.entries) {
      const isCurrent = this.doc?.collection === selected.name && this.doc.id === entry.id;
      const route = routeFor(selected, entry.id);
      list.appendChild(
        h(
          "a",
          {
            class: "list-item",
            href: route.href,
            "aria-current": isCurrent ? "page" : null,
            title: route.guessed ? `${route.href} (guessed route)` : route.href,
            onClick: () => sessionStorage.setItem(OPEN_KEY, "1"),
          },
          h("span", { class: "title" }, entry.title),
          h("span", { class: "id" }, entry.id),
          isCurrent ? icon("check", 13) : icon("chevron", 13),
        ),
      );
    }

    container.append(toolbar, formHost, list);
    if (!this.doc) {
      container.appendChild(
        h(
          "p",
          { class: "empty" },
          "Open an entry page to edit it in place. If Float can't detect one from the URL, bind it with ",
          h("code", null, 'data-float-entry="blog:my-post"'),
          " and mark the rendered body with ",
          h("code", null, "data-float-body"),
          ".",
        ),
      );
    }
    return container;
  }

  private renderNewEntryForm(collection: Collection, close: () => void): HTMLElement {
    const title = h("input", { class: "input", placeholder: "Title" }) as HTMLInputElement;
    const slug = h("input", { class: "input", placeholder: "slug", spellcheck: false }) as HTMLInputElement;
    const error = h("div", { class: "field-hint", style: { color: "var(--err)" } });
    let slugTouched = false;

    title.addEventListener("input", () => {
      if (!slugTouched) slug.value = slugify(title.value);
    });
    slug.addEventListener("input", () => {
      slugTouched = slug.value !== "";
      slug.value = slug.value.toLowerCase().replace(/[^a-z0-9-]+/g, "-");
    });

    const submit = async () => {
      const s = slugify(slug.value || title.value);
      if (!s) {
        error.textContent = "Give it a title or slug";
        return;
      }
      create.disabled = true;
      error.textContent = "";
      try {
        const created = await api.create({ collection: collection.name, slug: s, title: title.value.trim() || s });
        this.prefs.panel = null;
        this.savePrefs();
        sessionStorage.setItem(OPEN_KEY, "1");
        const route = routeFor(collection, created.id);
        // Give Astro a beat to pick the new file up before we navigate to it.
        await new Promise((r) => setTimeout(r, 600));
        location.assign(route.href);
      } catch (err) {
        error.textContent = describe(err);
        create.disabled = false;
      }
    };

    const create = h("button", { class: "btn btn-primary", type: "button", onClick: () => void submit() }, "Create") as HTMLButtonElement;
    const form = h(
      "div",
      { class: "form" },
      h("label", null, "Title", title),
      h("label", null, `Slug · ${collection.dir}/`, slug),
      error,
      h("div", { class: "form-actions" }, h("button", { class: "btn btn-ghost", type: "button", onClick: close }, "Cancel"), create),
    );
    form.addEventListener("keydown", (e) => {
      if (e.key === "Enter" && !(e.target instanceof HTMLTextAreaElement)) void submit();
    });
    queueMicrotask(() => title.focus());
    return form;
  }

  // ---- settings -------------------------------------------------------------------

  private renderSettings(): HTMLElement {
    const sideButton = (side: Side, label: string) =>
      h(
        "button",
        {
          type: "button",
          "aria-pressed": String(this.prefs.side === side),
          onClick: () => {
            this.prefs.side = side;
            this.root.dataset.side = side;
            this.savePrefs();
            this.renderPanel();
          },
        },
        icon(side === "left" ? "panelLeft" : "panelRight", 13),
        label,
      );

    const autosave = h(
      "button",
      {
        class: "setting toggle-row",
        type: "button",
        role: "switch",
        "aria-checked": String(this.prefs.autosave),
        onClick: () => {
          this.prefs.autosave = !this.prefs.autosave;
          autosave.setAttribute("aria-checked", String(this.prefs.autosave));
          this.savePrefs();
          if (this.prefs.autosave && this.isDirty()) this.scheduleAutosave();
          this.renderStatus();
        },
      },
      h("div", null, h("div", { class: "label" }, "Autosave"), h("div", { class: "desc" }, "Write to disk shortly after you stop typing")),
      h("span", { class: "switch" }),
    );

    const bodyState = !this.doc
      ? "No entry bound to this page."
      : this.page.bound
        ? `Editing ${this.doc.file} in place${this.page.mapped ? "" : " (blocks unmapped — whole body re-serialized on save)"}.`
        : `${this.doc.file} — no data-float-body on this page; body editable in Source only.`;

    return h(
      "div",
      { class: "panel-body pad" },
      h(
        "div",
        { class: "setting" },
        h("div", null, h("div", { class: "label" }, "Dock"), h("div", { class: "desc" }, "Which edge the float lives on")),
        h("div", { class: "segmented" }, sideButton("left", "Left"), sideButton("right", "Right")),
      ),
      autosave,
      h(
        "div",
        { class: "setting" },
        h(
          "div",
          null,
          h("div", { class: "label" }, "On the page"),
          h("div", { class: "desc" }, "⌘/Ctrl+S save · ⌘B / ⌘I / ⌘K format · Tab / ⇧Tab nest lists · type “# ”, “- ”, “1. ”, “> ”, “```” at a line start · Esc leaves the text"),
        ),
      ),
      h("div", { class: "meta" }, bodyState, h("br"), "astro-float · dev only · writes stay on localhost"),
    );
  }

  private renderNoEntry(): HTMLElement {
    return h("div", { class: "panel-body" }, h("p", { class: "empty" }, "No collection entry detected on this page."));
  }
}

// ---- helpers ------------------------------------------------------------------------

type FieldKind = "string" | "text" | "boolean" | "number" | "date" | "tags" | "json";

function fieldKind(value: unknown): FieldKind {
  if (typeof value === "boolean") return "boolean";
  if (typeof value === "number") return "number";
  if (typeof value === "string") {
    if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return "date";
    if (value.length > 80 || value.includes("\n")) return "text";
    return "string";
  }
  if (Array.isArray(value) && value.every((v) => typeof v === "string" || typeof v === "number")) return "tags";
  if (value == null) return "string";
  return "json";
}

function loadPrefs(): Prefs {
  const defaults: Prefs = { side: "right", autosave: false, panel: null };
  try {
    const stored = JSON.parse(localStorage.getItem(PREFS_KEY) ?? "{}");
    // "body" was a panel in an earlier revision; there's no textarea any more.
    if (stored.panel === "body") stored.panel = null;
    return { ...defaults, ...stored };
  } catch {
    return defaults;
  }
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value));
}

function describe(err: unknown): string {
  if (err instanceof Error) return err.message;
  return String(err);
}

function formatTime(ts: number) {
  return new Date(ts).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function slugify(value: string) {
  return value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function altFrom(name: string) {
  return name.replace(/\.[^.]+$/, "").replace(/[-_]+/g, " ");
}

function bindDropzone(el: HTMLElement, onFiles: (files: File[]) => void) {
  let depth = 0;
  el.addEventListener("dragenter", (e) => {
    e.preventDefault();
    depth++;
    el.dataset.dragging = "";
  });
  el.addEventListener("dragover", (e) => {
    e.preventDefault();
    if (e.dataTransfer) e.dataTransfer.dropEffect = "copy";
  });
  el.addEventListener("dragleave", () => {
    depth = Math.max(0, depth - 1);
    if (depth === 0) delete el.dataset.dragging;
  });
  el.addEventListener("drop", (e) => {
    e.preventDefault();
    depth = 0;
    delete el.dataset.dragging;
    const files = Array.from(e.dataTransfer?.files ?? []);
    if (files.length) onFiles(files);
  });
}
