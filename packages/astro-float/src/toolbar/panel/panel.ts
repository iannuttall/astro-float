import type { Collection, EntryDoc, Frontmatter } from "../api";
import { DatePicker } from "../datepicker";
import { h, replaceChildren } from "../dom";
import { icon } from "../icons";
import type { CollectionSchema } from "../schema";
import { renderCollectionFooter, type FootState } from "./collection";
import { renderForm } from "./form";
import { resetViewportZoom } from "./util";
import { createYamlView, type YamlView } from "./yaml";

/**
 * The panel: a flush column on the right edge (a bottom sheet on phones).
 *
 *   header   entry · hide · status · Discard / Save · Autosave
 *   tabs     Fields · YAML
 *   view     one of the three, scrolling on its own
 *   footer   collection · entries · New entry
 *
 * It owns no content state: everything it shows comes from `PanelHost`, every
 * change goes back through it. Float keeps the draft, the doc and the saving.
 */
export type PanelTab = "fields" | "yaml";

export interface PanelPrefs {
  autosave: boolean;
  /** Panel width in px, dragged from its left edge; clamped to the viewport on use. */
  sidebarWidth?: number;
}

export interface StatusView {
  text: string;
  tone: "" | "warn" | "err";
  dot: "idle" | "dirty" | "saving" | "saved" | "warning" | "error" | "conflict";
  showSave: boolean;
  showDiscard: boolean;
  actions: Array<{ label: string; primary?: boolean; onClick(): void }>;
}

export interface PanelHost {
  canvas: ShadowRoot;
  prefs: PanelPrefs;
  savePrefs(): void;
  setAutosave(on: boolean): void;

  doc(): EntryDoc | null;
  draft(): Frontmatter;
  original(): Frontmatter;
  schema(): CollectionSchema | null;
  collections(): Collection[];
  listCollection(): string | null;
  setListCollection(name: string): void;
  onPage(key: string): boolean;
  body(): { bound: boolean; mapped: boolean; readOnly: boolean; text: string };

  setField(key: string, value: unknown): void;
  removeField(key: string): void;
  revertField(key: string): void;
  replaceDraft(next: Frontmatter): void;
  changed(key: string): boolean;
  /** Something is dirty now (YAML text typed): status and autosave should know. */
  markDirty(): void;

  save(force?: boolean): Promise<void>;
  discard(): void;
  navigate(href: string, opts?: { focusBody?: boolean }): Promise<void>;
  notify(message: string): void;
}

const WIDTH_MIN = 240;
const WIDTH_DEFAULT = 320;
function widthMax() {
  return Math.max(WIDTH_MIN, Math.min(560, Math.floor(window.innerWidth / 2)));
}

const TABS: Array<{ id: PanelTab; label: string }> = [
  { id: "fields", label: "Fields" },
  { id: "yaml", label: "YAML" },
];

export class Panel {
  hidden = false;

  private tab: PanelTab = "fields";
  private aside: HTMLElement | null = null;
  private edgeTab: HTMLElement | null = null;
  private tabButtons = new Map<PanelTab, HTMLButtonElement>();
  private views = new Map<PanelTab, HTMLElement>();
  private formHost: HTMLElement | null = null;
  private footHost: HTMLElement | null = null;
  private yaml: YamlView | null = null;
  private foot: FootState = { open: false };
  private syncs = new Map<string, () => void>();
  private switching = false;

  // status
  private statusText: HTMLElement | null = null;
  private statusActions: HTMLElement | null = null;
  private statusSlot: HTMLElement;
  private statusDot: HTMLElement;
  private saveButton: HTMLButtonElement;
  private discardButton: HTMLButtonElement;
  private lastStatus: StatusView | null = null;
  private lastSlot = "";
  private lastFoot = "";

  constructor(
    private root: HTMLElement,
    private host: PanelHost,
  ) {
    this.statusDot = h("span", { class: "status-dot", "data-state": "idle" });
    this.saveButton = h(
      "button",
      { class: "btn btn-sm btn-primary", type: "button", hidden: true, title: "Save (⌘S)", onClick: () => void this.host.save() },
      icon("check", 13),
      h("span", {}, "Save"),
    ) as HTMLButtonElement;
    this.discardButton = h(
      "button",
      { class: "btn btn-sm btn-ghost btn-discard", type: "button", hidden: true, title: "Throw away unsaved changes and show what's on disk", onClick: () => this.host.discard() },
      "Discard",
    ) as HTMLButtonElement;
    this.statusSlot = h("div", { class: "status-slot" }, this.statusDot, this.discardButton, this.saveButton);

    window.addEventListener("resize", () => {
      if (this.aside) this.applyWidth();
    });
  }

  get activeTab() {
    return this.tab;
  }


  /** Build (or rebuild) the whole panel. Called when Edit turns on and after every page load. */
  render() {
    const host = this.host;
    const doc = host.doc();
    this.syncs.clear();
    this.lastSlot = "";
    this.lastFoot = "";

    // header
    this.statusText = h("span", { class: "status-text" });
    this.statusActions = h("div", { class: "status-actions" }, this.statusSlot);
    // Autosave: one quiet switch in the status row. Persisted like the width.
    const autosave = h(
      "button",
      {
        class: "toggle autosave",
        type: "button",
        role: "switch",
        "aria-checked": String(host.prefs.autosave),
        title: "Write to disk shortly after you stop typing",
        onClick: () => {
          const next = !host.prefs.autosave;
          host.setAutosave(next);
          autosave.setAttribute("aria-checked", String(next));
        },
      },
      h("span", { class: "autosave-label" }, "Autosave"),
      h("span", { class: "switch switch-sm" }),
    );
    const hide = h(
      "button",
      { class: "icon-btn", type: "button", "aria-label": "Hide the panel (keep editing)", title: "Hide the panel — editing stays on", onClick: () => this.setHidden(true) },
      icon("panelClose", 15),
    );
    const head = h(
      "header",
      { class: "head" },
      h(
        "div",
        { class: "head-row" },
        h("span", { class: "head-entry" }, doc ? h("span", { class: "head-collection" }, `${doc.collection}/`) : null, doc ? doc.id : "No entry on this page"),
        hide,
      ),
      h("div", { class: "head-status" }, this.statusText, this.statusActions),
      h("div", { class: "head-tools" }, autosave),
    );

    // tabs
    this.tabButtons.clear();
    const tabs = h(
      "div",
      { class: "tabs", role: "tablist" },
      TABS.map((t) => {
        const b = h(
          "button",
          { class: "tab", type: "button", role: "tab", "aria-selected": String(t.id === this.tab), disabled: !doc, onClick: () => void this.showTab(t.id) },
          t.label,
          h("span", { class: "tab-dot", hidden: true }),
        ) as HTMLButtonElement;
        this.tabButtons.set(t.id, b);
        return b;
      }),
    );

    // views
    this.views.clear();
    this.formHost = h("div", { class: "view view-fields", role: "tabpanel" });
    this.yaml = createYamlView({
      draft: () => host.draft(),
      replaceDraft: (next) => host.replaceDraft(next),
      onErrorChange: (has) => this.setTabDot("yaml", has),
      onInput: () => host.markDirty(),
    });
    const yamlView = h("div", { class: "view view-yaml", role: "tabpanel", hidden: true }, this.yaml.el);
    this.views.set("fields", this.formHost);
    this.views.set("yaml", yamlView);

    // footer
    this.footHost = h("div", { class: "foot-host" });

    this.aside = h("aside", { class: "panel", "aria-label": "Content editor" }, head, tabs, h("div", { class: "views" }, this.formHost, yamlView), this.footHost);

    // A quiet tab at the edge brings the panel back; it carries the status dot / Save so nothing is lost while hidden.
    this.edgeTab = h(
      "div",
      { class: "edge-tab" },
      h("button", { class: "edge-open", type: "button", "aria-label": "Show the panel", title: "Show the panel", onClick: () => this.setHidden(false) }, icon("panelOpen", 15)),
      h("div", { class: "edge-status" }),
    );

    replaceChildren(this.root, this.aside, this.renderResizeHandle(), this.edgeTab);
    this.applyWidth();
    this.root.toggleAttribute("data-panel-hidden", this.hidden);

    this.renderFields();
    this.renderCollection();
    if (!doc && this.tab !== "fields") this.tab = "fields";
    void this.showTab(this.tab, true);
    if (this.lastStatus) this.renderStatus(this.lastStatus);
  }

  /** Edit turned off: everything goes. */
  destroy() {
    this.hidden = false;
    this.aside = null;
    this.edgeTab = null;
    this.formHost = null;
    this.footHost = null;
    this.yaml = null;
    this.statusText = null;
    this.statusActions = null;
    this.syncs.clear();
    this.tabButtons.clear();
    this.views.clear();
    this.root.textContent = "";
    this.root.removeAttribute("data-panel-hidden");
  }

  // ---- tabs ---------------------------------------------------------------------------

  private async showTab(next: PanelTab, initial = false) {
    if (this.switching) return;
    if (!initial && next === this.tab) return;
    const prev = this.tab;
    this.switching = true;
    try {
      if (!initial) {
        if (prev === "yaml") this.yaml?.commit();
      }
      this.tab = next;
      for (const [id, b] of this.tabButtons) b.setAttribute("aria-selected", String(id === next));
      for (const [id, v] of this.views) v.hidden = id !== next;
      DatePicker.close();
      if (next === "fields" && !initial) this.renderFields();
      if (next === "yaml") this.yaml?.refresh();
    } finally {
      this.switching = false;
    }
  }

  private setTabDot(tab: PanelTab, on: boolean) {
    const dot = this.tabButtons.get(tab)?.querySelector<HTMLElement>(".tab-dot");
    if (dot) dot.hidden = !on;
  }

  // ---- views ------------------------------------------------------------------------------

  /** Rebuild the Fields view from the draft (after discard / revert / add / remove / YAML edits). */
  renderFields() {
    if (!this.formHost) return;
    const doc = this.host.doc();
    if (!doc) {
      replaceChildren(
        this.formHost,
        h(
          "p",
          { class: "empty" },
          "Open an entry to edit it in place. If Float can't detect one from the URL, bind it with ",
          h("code", null, 'data-float-entry="blog:my-post"'),
          " and mark the rendered body with ",
          h("code", null, "data-float-body"),
          ".",
        ),
      );
      return;
    }
    const body = this.host.body();
    const note = !body.bound && !body.readOnly
      ? h("p", { class: "form-note" }, `No editable body found on this page (${doc.file}). The fields still save.`)
      : null;
    const form = renderForm(
      {
        canvas: this.host.canvas,
        doc: () => this.host.doc(),
        schema: () => this.host.schema(),
        draft: () => this.host.draft(),
        original: () => this.host.original(),
        onPage: (key) => this.host.onPage(key),
        collections: () => this.host.collections(),
        setField: (key, value) => this.host.setField(key, value),
        removeField: (key) => this.host.removeField(key),
        revertField: (key) => this.host.revertField(key),
        changed: (key) => this.host.changed(key),
      },
      this.syncs,
    );
    replaceChildren(this.formHost, note, form);
  }

  /** One field changed outside the form (typed on the page, set in place): mirror it, and let the YAML text follow. */
  syncField(key: string) {
    this.syncs.get(key)?.();
    this.yaml?.sync();
  }

  /** The whole draft changed (discard, revert): repaint everything that shows it; broken YAML text is dropped. */
  syncAll() {
    if (this.tab === "fields") this.renderFields();
    else for (const sync of this.syncs.values()) sync();
    this.yaml?.sync();
  }

  /** The draft changed through the form: the YAML text follows (broken text is dropped). */
  syncYaml() {
    this.yaml?.sync();
  }

  /** YAML typed but not yet parsed into the draft: the entry is dirty. */
  yamlPending() {
    return this.yaml?.isPending() ?? false;
  }

  /** Parse pending YAML into the draft now (before a save reads it). */
  commitYaml() {
    this.yaml?.commit();
  }

  renderCollection() {
    if (!this.footHost) return;
    replaceChildren(
      this.footHost,
      renderCollectionFooter(
        {
          doc: () => this.host.doc(),
          collections: () => this.host.collections(),
          listCollection: () => this.host.listCollection(),
          setListCollection: (name) => this.host.setListCollection(name),
          navigate: (href, opts) => this.host.navigate(href, opts),
          notify: (m) => this.host.notify(m),
          releaseFocus: () => this.releaseFocus(),
        },
        this.foot,
        () => this.renderCollection(),
      ),
    );
  }

  // ---- hide / width -------------------------------------------------------------------------

  setHidden(hidden: boolean) {
    this.hidden = hidden;
    DatePicker.close();
    this.root.toggleAttribute("data-panel-hidden", hidden);
    if (hidden) this.releaseFocus();
    this.lastSlot = ""; // the status slot moves between the header and the edge tab
    if (this.lastStatus) this.renderStatus(this.lastStatus);
  }

  /** Blur whatever has the caret in the panel and undo an iOS focus-zoom if one slipped through. */
  releaseFocus() {
    (this.host.canvas.activeElement as HTMLElement | null)?.blur();
    resetViewportZoom();
  }

  private applyWidth() {
    const width = Math.max(WIDTH_MIN, Math.min(this.host.prefs.sidebarWidth ?? WIDTH_DEFAULT, widthMax()));
    this.root.style.setProperty("--sb-width", `${width}px`);
  }

  /** The panel's left edge is the only drag target: left widens, right narrows; the width sticks for next time. */
  private renderResizeHandle(): HTMLElement {
    const handle = h("div", { class: "resize", role: "separator", "aria-orientation": "vertical", "aria-label": "Resize panel", title: "Drag to resize" });
    let startX = 0;
    let startWidth = 0;
    const onMove = (e: PointerEvent) => {
      const width = Math.max(WIDTH_MIN, Math.min(startWidth + (startX - e.clientX), widthMax()));
      this.root.style.setProperty("--sb-width", `${width}px`);
      this.host.prefs.sidebarWidth = width;
    };
    const onUp = (e: PointerEvent) => {
      handle.removeEventListener("pointermove", onMove);
      handle.removeEventListener("pointerup", onUp);
      handle.removeEventListener("pointercancel", onUp);
      if (handle.hasPointerCapture(e.pointerId)) handle.releasePointerCapture(e.pointerId);
      this.root.removeAttribute("data-resizing");
      document.documentElement.style.cursor = "";
      document.documentElement.style.userSelect = "";
      this.host.savePrefs();
    };
    handle.addEventListener("pointerdown", (e: PointerEvent) => {
      if (e.button !== 0) return;
      e.preventDefault();
      startX = e.clientX;
      startWidth = parseFloat(this.root.style.getPropertyValue("--sb-width")) || WIDTH_DEFAULT;
      handle.setPointerCapture(e.pointerId);
      this.root.setAttribute("data-resizing", "");
      // The page under the pointer shouldn't select text or flicker its cursor while dragging.
      document.documentElement.style.cursor = "col-resize";
      document.documentElement.style.userSelect = "none";
      handle.addEventListener("pointermove", onMove);
      handle.addEventListener("pointerup", onUp);
      handle.addEventListener("pointercancel", onUp);
    });
    return handle;
  }

  // ---- status -----------------------------------------------------------------------------------

  /** Cheap and idempotent: only touches the DOM when the visible state actually changes. */
  renderStatus(view: StatusView) {
    this.lastStatus = view;
    const slot = `${view.showSave}|${view.showDiscard}|${view.dot}|${view.text}|${this.hidden}`;
    if (slot !== this.lastSlot) {
      this.lastSlot = slot;
      this.saveButton.hidden = !view.showSave;
      this.discardButton.hidden = !view.showDiscard;
      this.statusDot.hidden = view.showSave || view.showDiscard;
      this.statusDot.dataset.state = view.dot;
      this.statusDot.title = view.dot === "dirty" ? "Unsaved changes" : view.dot === "saved" ? "Saved" : view.text || "";
      const edgeStatus = this.edgeTab?.querySelector(".edge-status");
      if (this.hidden && edgeStatus) edgeStatus.appendChild(this.statusSlot);
      else if (this.statusActions && !this.statusActions.contains(this.statusSlot)) this.statusActions.appendChild(this.statusSlot);
    }

    if (!this.statusText || !this.statusActions) return;
    const foot = `${view.text}|${view.tone}|${view.actions.map((a) => a.label).join(",")}|${this.hidden}`;
    if (foot === this.lastFoot) return;
    this.lastFoot = foot;
    this.statusText.textContent = view.text;
    if (view.tone) this.statusText.dataset.tone = view.tone;
    else delete this.statusText.dataset.tone;
    replaceChildren(
      this.statusActions,
      ...view.actions.map((a) => h("button", { class: `btn btn-sm${a.primary ? " btn-primary" : ""}`, type: "button", onClick: () => a.onClick() }, a.label)),
      ...(this.hidden ? [] : [this.statusSlot]),
    );
  }
}
