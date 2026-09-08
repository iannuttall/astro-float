import { api, ApiError, type Collection, type EntryDoc, type Frontmatter, type MediaItem } from "./api";
import { h, replaceChildren } from "./dom";
import { PageEditor } from "./editor";
import { FieldBindings } from "./fields";
import { icon } from "./icons";
import { detectEntry, routeFor, swapPage, type DetectedEntry } from "./page";
import { STYLES } from "./styles";

type PanelId = "fields" | "collection" | "source" | "settings";
type Side = "left" | "right";
type Status = "idle" | "saving" | "refreshing" | "saved" | "error" | "conflict";
/** The three chrome experiments. Same panels, different shells. */
export type ChromeMode = "toolbar" | "float" | "sheet";
type Placement = "bottom-left" | "bottom-center" | "bottom-right";

interface Prefs {
  side: Side;
  autosave: boolean;
  mode: ChromeMode;
}

export interface FloatHandle {
  setEditing(on: boolean): Promise<void>;
  beforeEditOff(): Promise<boolean>;
  setToolbarPlacement(placement: Placement): void;
}

export interface FloatHost {
  /** Ask the toolbar to switch the Edit app off. */
  requestOff(): void;
}

const PREFS_KEY = "astro-float:prefs";
const AUTOSAVE_DELAY = 800;
const HOVER_LEAVE_MS = 450;

const ENTRY_PANELS: PanelId[] = ["fields", "source"];
const PANEL_TITLES: Record<PanelId, string> = {
  fields: "Fields",
  collection: "Collection",
  source: "Source",
  settings: "Settings",
};
const MODE_LABEL: Record<ChromeMode, string> = { toolbar: "Toolbar", float: "Float", sheet: "Sheet" };
const MODE_BLURB: Record<ChromeMode, string> = {
  toolbar: "Everything hangs off the Astro bar: a small popover while Edit is on, panels open above it.",
  float: "A rail sits tucked at the edge while Edit is on. Hover (or tap) to bring it out.",
  sheet: "A docked panel with tabs lives beside the page while Edit is on, and leaves when it's off.",
};

export function mountFloat(canvas: ShadowRoot, host: FloatHost): FloatHandle {
  const float = new Float(canvas, host);
  return {
    setEditing: (on) => float.setEditing(on),
    beforeEditOff: () => float.beforeEditOff(),
    setToolbarPlacement: (p) => float.setToolbarPlacement(p),
  };
}

class Float {
  private root: HTMLElement;
  private chromeHost: HTMLElement;
  private panelHost: HTMLElement;
  private statusSlot: HTMLElement;
  private statusDot: HTMLElement;
  private saveButton: HTMLButtonElement;
  private rail: HTMLElement | null = null;
  private sheetBody: HTMLElement | null = null;
  private sheetTabs: HTMLElement | null = null;
  private popoverButtons: HTMLElement | null = null;

  private prefs: Prefs = loadPrefs();
  private editing = false;
  private loadedFor: string | null = null;
  /** Open panel. In-memory only: nothing re-opens on load or navigation. */
  private panel: PanelId | null = null;
  private placement: Placement = readToolbarPlacement();

  private collections: Collection[] = [];
  private detected: DetectedEntry | null = null;
  private doc: EntryDoc | null = null;
  private draftFrontmatter: Frontmatter = {};
  /** Body draft used only when the page has no `[data-float-body]` to edit in place. */
  private draftBody = "";
  /** MDX whose blocks couldn't be mapped to source: never rewrite the body from HTML. */
  private bodyReadOnly = false;
  private listCollection: string | null = null;

  private page: PageEditor;
  private fields: FieldBindings;
  private fieldInputs = new Map<string, HTMLInputElement | HTMLTextAreaElement>();

  private status: Status = "idle";
  private statusMessage = "";
  private savedAt: number | null = null;
  private saving = false;
  private navigating = false;
  private autosaveTimer: number | undefined;
  private savedTimer: number | undefined;

  // rail (mode 2) tuck state
  private coarse = isTouchDevice();
  private hovering = false;
  private touchExpanded = false;
  private hoverTimer: number | undefined;
  private sheetCollapsed = false;

  private footStatus: HTMLElement | null = null;
  private footActions: HTMLElement | null = null;
  private sourceView: HTMLTextAreaElement | null = null;
  private lastSlot = "";
  private lastFoot = "";

  constructor(
    private canvas: ShadowRoot,
    private host: FloatHost,
  ) {
    const style = document.createElement("style");
    style.textContent = STYLES;
    canvas.appendChild(style);

    this.statusDot = h("span", { class: "status-dot", "data-state": "idle" });
    this.saveButton = h(
      "button",
      { class: "rail-save tip", type: "button", "data-tip": "Save · ⌘S", "aria-label": "Save", hidden: true, onClick: () => void this.save() },
      icon("check", 14),
    ) as HTMLButtonElement;
    this.statusSlot = h("div", { class: "status-slot" }, this.statusDot, this.saveButton);

    this.chromeHost = h("div", { class: "chrome-host" });
    this.panelHost = h("div", { class: "panel-host" });
    this.root = h("div", { class: "float", "data-mode": this.prefs.mode, "data-side": this.prefs.side, "data-placement": this.placement, "data-coarse": this.coarse ? "" : null }, this.chromeHost);
    canvas.appendChild(this.root);

    this.page = new PageEditor({
      onChange: () => this.touched(),
      onFiles: (files, range) => void this.uploadAll(files, range),
    });
    this.fields = new FieldBindings({
      onChange: (key, value) => {
        this.draftFrontmatter[key] = value;
        const input = this.fieldInputs.get(key);
        if (input && input.value !== value) input.value = value;
        this.touched();
      },
    });

    this.bindViewport();

    // Escape inside our chrome: leave the field first, then close the panel.
    this.root.addEventListener("keydown", (e) => {
      if (e.key !== "Escape") return;
      e.stopPropagation();
      const active = this.canvas.activeElement as HTMLElement | null;
      if (active && active.matches("input, textarea, select")) active.blur();
      else if (this.prefs.mode !== "sheet") this.closePanel();
    });
    this.root.addEventListener("keyup", (e) => {
      if (e.key === "Escape") e.stopPropagation();
    });
    document.addEventListener("keydown", (e) => {
      if (!this.editing) return;
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "s") {
        e.preventDefault();
        void this.save();
      }
    });
    // Only real unloads (tab close, hard refresh) should ever warn — Float's own
    // navigations are soft swaps and never reach here.
    window.addEventListener("beforeunload", (e) => {
      if (this.editing && this.isDirty() && !this.navigating) e.preventDefault();
    });
    document.addEventListener("click", this.onDocumentClick);
    window.addEventListener("popstate", (e) => {
      if (this.editing || (e.state && (e.state as { astroFloat?: boolean }).astroFloat)) void this.navigate(location.href, { push: false });
    });

    // Read-only introspection for tests and bug reports: host.__astroFloat.state()
    (this.canvas.host as HTMLElement & { __astroFloat?: unknown }).__astroFloat = {
      state: () => ({
        editing: this.editing,
        mode: this.prefs.mode,
        panel: this.panel,
        tucked: this.root.hasAttribute("data-tucked"),
        touchExpanded: this.touchExpanded,
        coarse: this.coarse,
        status: this.status,
        frontmatterDirty: this.frontmatterDirty(),
        bodyDirty: this.bodyDirty(),
        bodyBound: this.page.bound,
        bodyMapped: this.page.mapped,
        bodyReadOnly: this.bodyReadOnly,
        bodyDiff: this.page.debugDiff(),
        entry: this.doc ? `${this.doc.collection}/${this.doc.id}` : null,
      }),
    };
  }

  // ---- edit mode ---------------------------------------------------------------

  async setEditing(on: boolean) {
    if (on === this.editing) return;
    this.editing = on;
    if (on) {
      this.touchExpanded = false;
      if (this.loadedFor !== location.href) {
        await this.loadPage(); // renders the chrome once it knows the entry
      } else {
        this.attachEditors();
        this.renderChrome();
      }
    } else {
      window.clearTimeout(this.autosaveTimer);
      this.page.detach();
      this.fields.detach();
      this.panel = null;
      this.releaseFocus();
      this.chromeHost.textContent = "";
      this.rail = null;
      this.sheetBody = null;
      this.sheetTabs = null;
      this.popoverButtons = null;
    }
  }

  /** Called by the toolbar right before it switches the app off. */
  async beforeEditOff(): Promise<boolean> {
    if (!this.editing || !this.isDirty()) return true;
    await this.save();
    return !this.isDirty();
  }

  setToolbarPlacement(placement: Placement) {
    this.placement = placement;
    this.root.dataset.placement = placement;
  }

  private setMode(mode: ChromeMode) {
    if (mode === this.prefs.mode) return;
    this.prefs.mode = mode;
    this.savePrefs();
    this.root.dataset.mode = mode;
    this.touchExpanded = false;
    this.sheetCollapsed = false;
    // Keep the Settings panel open across the switch so the change reads instantly.
    const keep = this.panel;
    this.panel = null;
    this.renderChrome();
    if (keep) this.showPanel(keep);
  }

  // ---- rail tuck / reveal (mode 2) ------------------------------------------------

  /**
   * The rail rests tucked (a sliver at the edge) from the moment it appears.
   * Hover (mouse), a tap (touch), an open panel or unsaved work bring it out.
   */
  private updateTuck() {
    if (this.prefs.mode !== "float") return;
    const dirtyWork = this.isDirty() && !this.prefs.autosave;
    const out = this.hovering || this.touchExpanded || this.panel !== null || dirtyWork;
    this.root.toggleAttribute("data-tucked", !out);
    this.root.toggleAttribute("data-expanded", this.touchExpanded);
  }

  private bindRailInteractions(rail: HTMLElement) {
    const reveal = () => {
      window.clearTimeout(this.hoverTimer);
      if (!this.hovering) {
        this.hovering = true;
        this.updateTuck();
      }
    };
    const leave = () => {
      window.clearTimeout(this.hoverTimer);
      this.hoverTimer = window.setTimeout(() => {
        this.hovering = false;
        this.updateTuck();
      }, HOVER_LEAVE_MS);
    };
    rail.addEventListener("mouseenter", () => {
      if (!this.coarse) reveal();
    });
    rail.addEventListener("mouseleave", () => {
      if (!this.coarse) leave();
    });
    // Keyboard users: focusing a rail button reveals it. On touch, focus arrives
    // with the tap itself and must not pre-empt the tap-to-expand step below.
    rail.addEventListener("focusin", () => {
      if (!this.coarse) reveal();
    });
    rail.addEventListener("focusout", () => {
      if (!this.coarse) leave();
    });
    // Coarse pointers: the first tap on a tucked rail only expands it.
    rail.addEventListener(
      "click",
      (e) => {
        if (!this.coarse) return;
        if (this.root.hasAttribute("data-tucked")) {
          e.preventDefault();
          e.stopPropagation();
          this.touchExpanded = true;
          this.updateTuck();
          return;
        }
        const t = e.target as HTMLElement;
        if (t === rail || t.classList?.contains("rail-sep") || t === this.statusSlot || t === this.statusDot) this.collapse();
      },
      true,
    );
  }

  /** Close the panel and, on touch devices, tuck the rail. */
  private collapse() {
    this.touchExpanded = false;
    this.closePanel();
    this.updateTuck();
  }

  /**
   * Position everything inside the *visual* viewport. On iOS the on-screen
   * keyboard shrinks the visual viewport without touching the layout viewport,
   * which is how fixed panels end up half-hidden behind it.
   */
  private bindViewport() {
    const vv = window.visualViewport;
    if (!vv) return;
    const apply = () => {
      this.root.style.setProperty("--vv-top", `${Math.max(0, vv.offsetTop)}px`);
      this.root.style.setProperty("--vv-left", `${Math.max(0, vv.offsetLeft)}px`);
      this.root.style.setProperty("--vv-width", `${vv.width}px`);
      this.root.style.setProperty("--vv-height", `${vv.height}px`);
    };
    vv.addEventListener("resize", apply);
    vv.addEventListener("scroll", apply);
    apply();
  }

  /** Blur whatever has the caret in our chrome and undo an iOS focus-zoom if one slipped through. */
  private releaseFocus() {
    const active = this.canvas.activeElement as HTMLElement | null;
    active?.blur();
    resetViewportZoom();
  }

  // ---- page lifecycle ---------------------------------------------------------

  /** (Re)read the current URL: which entry is this, bind the editors, keep the chrome calm. */
  private async loadPage() {
    this.page.unbind();
    this.fields.unbind();
    this.doc = null;
    this.detected = null;
    this.draftFrontmatter = {};
    this.draftBody = "";
    this.bodyReadOnly = false;
    this.touchExpanded = false;
    this.loadedFor = location.href;
    this.closePanel();

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
        // No entry here (index/listing page): prefer the collection named in the URL.
        const first = location.pathname.split("/").filter(Boolean)[0];
        const byUrl = this.collections.find((c) => c.name === first);
        this.listCollection = byUrl?.name ?? this.collections[0]?.name ?? null;
      }
      if (this.status !== "saved") this.setStatus("idle");
    } catch (err) {
      this.setStatus("error", describe(err));
    }
    this.renderChrome();
  }

  /** Bind the in-place editors to `[data-float-body]` and `[data-float-field]`; attach them if Edit is on. */
  private bindBody() {
    if (!this.doc) return;
    this.fields.bind(this.doc.frontmatter);
    const container = PageEditor.find();
    if (container) {
      this.page.bind(container, { lead: this.doc.lead, blocks: this.doc.blocks }, this.doc.absDir);
      // MDX we can't line up with the source would be written back as HTML — never do that.
      this.bodyReadOnly = this.doc.mdx && !this.page.mapped;
      if (this.bodyReadOnly) this.setStatus("error", "MDX blocks didn't line up with the source — body is read-only here; fields still save");
    } else {
      this.page.unbind();
    }
    this.attachEditors();
  }

  private attachEditors() {
    if (!this.editing || !this.doc) return;
    this.fields.attach();
    if (this.page.bound && !this.bodyReadOnly) this.page.attach();
  }

  /**
   * Soft navigation: save anything pending, fetch the next page's HTML and swap
   * it in under the chrome. No unload, no "Leave site?", nothing re-animating.
   */
  private async navigate(href: string, { push = true, focusBody = false } = {}) {
    const url = new URL(href, location.href);
    if (this.isDirty()) {
      await this.save();
      if (this.isDirty()) return;
    }
    this.navigating = true;
    this.releaseFocus();
    this.setStatus("refreshing");
    try {
      await swapPage(url.href);
      if (push) history.pushState({ astroFloat: true }, "", url.href);
      window.scrollTo(0, 0);
      await this.loadPage();
      if (focusBody) this.page.focusStart();
    } catch (err) {
      console.warn("[astro-float] soft navigation failed, falling back to a full load", err);
      location.assign(url.href);
    } finally {
      this.navigating = false;
    }
  }

  private onDocumentClick = (e: MouseEvent) => {
    if (!this.editing) return;
    const path = e.composedPath();
    const insideFloat = path.includes(this.canvas.host);

    // Touch: tapping the page while the rail is out (or a popover panel is open) puts it away.
    if (this.coarse && !insideFloat && this.prefs.mode !== "sheet" && (this.touchExpanded || this.panel)) this.collapse();

    if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    const anchor = path.find((n) => n instanceof HTMLAnchorElement) as HTMLAnchorElement | undefined;
    if (!anchor || !anchor.href) return;
    if ((anchor.target && anchor.target !== "_self") || anchor.hasAttribute("download")) return;
    const url = new URL(anchor.href, location.href);
    if (url.origin !== location.origin) return;
    if (url.pathname === location.pathname && url.search === location.search && url.hash) return;
    e.preventDefault();
    void this.navigate(url.href);
  };

  private async reloadFromDisk() {
    if (!this.detected) return;
    this.setStatus("refreshing");
    try {
      await swapPage();
    } catch {
      /* keep current DOM */
    }
    const panel = this.panel;
    await this.loadPage();
    if (panel) this.showPanel(panel);
  }

  // ---- state helpers ----------------------------------------------------------

  private frontmatterDirty() {
    return !!this.doc && JSON.stringify(this.draftFrontmatter) !== JSON.stringify(this.doc.frontmatter);
  }

  private bodyDirty() {
    if (!this.doc || this.bodyReadOnly) return false;
    return this.page.bound ? this.page.isDirty() : this.draftBody !== this.doc.body;
  }

  private isDirty() {
    return this.frontmatterDirty() || this.bodyDirty();
  }

  private currentBody(): string {
    if (!this.doc) return "";
    if (this.bodyReadOnly) return this.doc.body;
    return this.page.bound ? this.page.toMarkdown() : this.draftBody;
  }

  private setStatus(status: Status, message = "") {
    this.status = status;
    this.statusMessage = message;
    this.renderStatus();
  }

  private touched() {
    if (this.status === "saved" || (this.status === "error" && !this.bodyReadOnly)) this.status = "idle";
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
    const snapshot = this.page.bound && !this.bodyReadOnly ? this.page.snapshotForSave() : null;
    const body = snapshot ? snapshot.markdown : this.currentBody();
    // Re-rendering from the server would move the caret; skip it while the
    // user is typing on the page and let their DOM stand as the preview.
    const refresh = !this.page.hasFocus() && !this.fields.hasFocus();

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
      else if (!this.bodyReadOnly && this.draftBody === body) this.draftBody = result.body;

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
      if (this.panel === "collection") this.renderPanel();
    } catch {
      /* non-fatal */
    }
  }

  // ---- chrome: three shells over the same panels -----------------------------------

  private renderChrome() {
    if (!this.editing) return;
    this.root.dataset.mode = this.prefs.mode;
    this.rail = null;
    this.sheetBody = null;
    this.sheetTabs = null;
    this.popoverButtons = null;
    this.panelHost.textContent = "";
    this.root.removeAttribute("data-tucked");
    this.root.removeAttribute("data-expanded");
    this.root.removeAttribute("data-sheet-collapsed");

    switch (this.prefs.mode) {
      case "toolbar":
        this.renderToolbarChrome();
        break;
      case "float":
        this.renderFloatChrome();
        break;
      case "sheet":
        this.renderSheetChrome();
        break;
    }
    this.renderStatus();
    if (this.panel) this.renderPanel();
  }

  private panelButton(id: PanelId, cls: string) {
    const hasEntry = !!this.doc;
    const tip = PANEL_TITLES[id];
    return h(
      "button",
      {
        class: cls,
        type: "button",
        "data-tip": ENTRY_PANELS.includes(id) && !hasEntry ? `${tip} · no entry here` : tip,
        "aria-label": tip,
        "aria-pressed": String(this.panel === id),
        disabled: ENTRY_PANELS.includes(id) && !hasEntry,
        onClick: () => this.togglePanel(id),
      },
      icon(id, 16),
    );
  }

  /** Mode 1 — a horizontal pill just above the Astro bar; panels open above it. */
  private renderToolbarChrome() {
    this.popoverButtons = h(
      "div",
      { class: "pop-actions" },
      this.panelButton("fields", "rail-btn tip"),
      this.panelButton("collection", "rail-btn tip"),
      this.panelButton("source", "rail-btn tip"),
      this.panelButton("settings", "rail-btn tip"),
    );
    const popover = h(
      "div",
      { class: "popover" },
      h("span", { class: "chrome-mode", title: MODE_BLURB.toolbar }, "Toolbar"),
      h("span", { class: "chrome-entry" }, this.doc ? `${this.doc.collection}/${this.doc.id}` : "no entry here"),
      h("span", { class: "pop-sep" }),
      this.popoverButtons,
      h("span", { class: "pop-sep" }),
      this.statusSlot,
    );
    replaceChildren(this.chromeHost, popover, this.panelHost);
  }

  /** Mode 2 — the tucked rail. It is *born* tucked: no slide-out-then-hide. */
  private renderFloatChrome() {
    const rail = h(
      "nav",
      { class: "rail", "aria-label": "Float" },
      this.panelButton("fields", "rail-btn tip"),
      this.panelButton("collection", "rail-btn tip"),
      h("span", { class: "rail-sep" }),
      this.panelButton("source", "rail-btn tip"),
      this.panelButton("settings", "rail-btn tip"),
      this.statusSlot,
    );
    this.rail = rail;
    this.bindRailInteractions(rail);
    // Tucked before first paint, so the only motion is a short fade.
    this.updateTuck();
    replaceChildren(this.chromeHost, rail, this.panelHost);
  }

  /** Mode 3 — a docked sheet with tabs; present for as long as Edit is on. */
  private renderSheetChrome() {
    this.sheetTabs = h("nav", { class: "sheet-tabs" });
    this.sheetBody = h("div", { class: "sheet-body" });
    this.footStatus = h("span", { class: "foot-status" });
    this.footActions = h("div", { class: "foot-actions" });
    const sheet = h(
      "aside",
      { class: "sheet" },
      h(
        "header",
        { class: "sheet-head" },
        h("span", { class: "chrome-mode", title: MODE_BLURB.sheet }, "Sheet"),
        h("span", { class: "chrome-entry" }, this.doc ? `${this.doc.collection}/${this.doc.id}` : "no entry here"),
        h(
          "button",
          {
            class: "icon-btn tip",
            type: "button",
            "aria-label": "Collapse",
            "data-tip": "Collapse",
            onClick: () => {
              this.sheetCollapsed = true;
              this.root.setAttribute("data-sheet-collapsed", "");
            },
          },
          icon("chevron", 14),
        ),
      ),
      this.sheetTabs,
      this.sheetBody,
      h("footer", { class: "panel-foot" }, this.footStatus, this.footActions),
    );
    const handle = h(
      "button",
      {
        class: "sheet-handle",
        type: "button",
        "aria-label": "Expand editor panel",
        onClick: () => {
          this.sheetCollapsed = false;
          this.root.removeAttribute("data-sheet-collapsed");
        },
      },
      icon("panelRight", 15),
      h("span", null, "Edit"),
      this.statusSlot,
    );
    if (this.sheetCollapsed) this.root.setAttribute("data-sheet-collapsed", "");
    replaceChildren(this.chromeHost, sheet, handle);
    this.renderSheetTabs();
    if (!this.panel) this.panel = this.doc ? "fields" : "collection";
  }

  private renderSheetTabs() {
    if (!this.sheetTabs) return;
    const tab = (id: PanelId) =>
      h(
        "button",
        {
          type: "button",
          "aria-pressed": String(this.panel === id),
          disabled: ENTRY_PANELS.includes(id) && !this.doc,
          onClick: () => this.showPanel(id),
        },
        icon(id, 14),
        PANEL_TITLES[id],
      );
    replaceChildren(this.sheetTabs, tab("fields"), tab("collection"), tab("source"), tab("settings"));
  }

  private togglePanel(id: PanelId) {
    if (this.panel === id && this.prefs.mode !== "sheet") this.closePanel();
    else this.showPanel(id);
  }

  private closePanel() {
    if (this.prefs.mode === "sheet" && this.editing && this.chromeHost.childElementCount) return; // the sheet always shows something
    if (this.panel === null && !this.panelHost.childElementCount) return;
    this.releaseFocus();
    this.panel = null;
    this.panelHost.textContent = "";
    this.sourceView = null;
    if (this.prefs.mode !== "sheet") {
      this.footStatus = null;
      this.footActions = null;
    }
    this.fieldInputs.clear();
    this.lastFoot = "";
    this.syncPressed();
    this.updateTuck();
  }

  private showPanel(id: PanelId) {
    this.panel = id;
    this.renderPanel();
    this.syncPressed();
    this.updateTuck();
  }

  private syncPressed() {
    for (const b of Array.from(this.chromeHost.querySelectorAll<HTMLElement>("[aria-pressed][aria-label]"))) {
      const label = b.getAttribute("aria-label");
      const id = (Object.keys(PANEL_TITLES) as PanelId[]).find((k) => PANEL_TITLES[k] === label);
      if (id) b.setAttribute("aria-pressed", String(this.panel === id));
    }
    this.renderSheetTabs();
  }

  // ---- panel shell --------------------------------------------------------------

  private renderPanel() {
    const id = this.panel;
    if (!id || !this.editing) return;
    this.sourceView = null;
    this.fieldInputs.clear();
    this.lastFoot = "";

    let body: HTMLElement;
    let showFoot = false;
    switch (id) {
      case "fields":
        body = this.renderFields();
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

    if (this.prefs.mode === "sheet") {
      // The sheet supplies tabs and a footer of its own; the panel body drops straight in.
      if (this.sheetBody) replaceChildren(this.sheetBody, body);
      this.renderStatus();
      return;
    }

    this.footStatus = null;
    this.footActions = null;
    const sub = this.doc ? `${this.doc.collection}/${this.doc.id}` : "no entry on this page";
    const head = h(
      "header",
      { class: "panel-head" },
      h("span", { class: "panel-title" }, PANEL_TITLES[id]),
      h("span", { class: "panel-sub", title: this.doc?.file ?? "" }, sub),
      h("button", { class: "icon-btn", type: "button", "aria-label": "Close panel", onClick: () => (this.prefs.mode === "float" ? this.collapse() : this.closePanel()) }, icon("close", 14)),
    );
    const panel = h("section", { class: "panel", "data-panel": id }, head, body);
    if (showFoot && this.doc) {
      this.footStatus = h("span", { class: "foot-status" });
      this.footActions = h("div", { class: "foot-actions" });
      panel.appendChild(h("footer", { class: "panel-foot" }, this.footStatus, this.footActions));
    }
    replaceChildren(this.panelHost, panel);
    this.renderStatus();
  }

  /** Cheap and idempotent: only touches the DOM when the visible state actually changes. */
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
    const showSave = dirty && !busy && !this.prefs.autosave && this.status !== "conflict" && this.status !== "error";
    const slot = `${showSave}|${dotState}|${this.statusMessage}`;
    if (slot !== this.lastSlot) {
      this.lastSlot = slot;
      this.saveButton.hidden = !showSave;
      this.statusDot.hidden = showSave;
      this.statusDot.dataset.state = dotState;
      this.statusDot.title = dotState === "dirty" ? "Unsaved changes" : dotState === "saved" ? "Saved" : this.statusMessage || "";
      this.updateTuck();
    }

    if (!this.footStatus || !this.footActions) return;
    const showFootActions = this.prefs.mode === "sheet" ? this.panel !== "collection" && this.panel !== "settings" && !!this.doc : true;
    const foot = `${this.status}|${dirty}|${this.prefs.autosave}|${this.statusMessage}|${this.savedAt}|${this.panel}|${showFootActions}`;
    if (foot === this.lastFoot) return;
    this.lastFoot = foot;

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
        if (dirty) actions.push(h("button", { class: "btn btn-sm", type: "button", onClick: () => void this.save() }, this.bodyReadOnly ? "Save fields" : "Retry"));
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
          text = this.doc ? (this.savedAt ? `Saved ${formatTime(this.savedAt)}` : "Up to date") : "";
        }
    }
    if (this.panel === "source" && this.doc) {
      actions.unshift(
        h(
          "button",
          { class: "btn btn-sm btn-ghost", type: "button", onClick: () => void navigator.clipboard?.writeText(this.currentBody()) },
          icon("copy", 12),
          "Copy",
        ),
      );
    }
    this.footStatus.textContent = text;
    if (tone) this.footStatus.dataset.tone = tone;
    else delete this.footStatus.dataset.tone;
    replaceChildren(this.footActions, actions);
  }

  // ---- source (escape hatch) --------------------------------------------------------

  private renderSource(): HTMLElement {
    if (!this.doc) return this.renderNoEntry();
    const editable = !this.page.bound && !this.bodyReadOnly;
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

    const note = this.bodyReadOnly
      ? ["Read-only. This MDX file has blocks Float couldn't line up with the rendered page, so the body is left untouched on save."]
      : editable
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
      this.fields.setValue(key, next);
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
        this.fieldInputs.set(key, ta);
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
        this.fieldInputs.set(key, input);
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
        this.fields.has(key) ? h("span", { class: "field-type", title: "Also editable on the page" }, "on page") : null,
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

  // ---- images (drop / paste on the prose only) ----------------------------------------

  private placeImage(item: MediaItem, range: Range | null) {
    if (this.page.bound && !this.bodyReadOnly) {
      this.page.insertImage(item.url, altFrom(item.name), range);
    } else if (!this.bodyReadOnly) {
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
        this.placeImage(saved, range);
        range = null;
      }
      this.setStatus("idle");
    } catch (err) {
      this.setStatus("error", describe(err));
    }
  }

  // ---- collection -----------------------------------------------------------------

  private renderCollection(): HTMLElement {
    const container = h("div", { class: "panel-body" });
    const formHost = h("div");
    let openForm: "entry" | "collection" | null = null;

    const selected = this.collections.find((c) => c.name === this.listCollection) ?? this.collections[0];
    if (selected) this.listCollection = selected.name;

    // Cancel/close puts the list back exactly as it was: same panel, keyboard down, no zoom left behind.
    const setForm = (kind: "entry" | "collection" | null) => {
      openForm = kind;
      if (kind === null) this.releaseFocus();
      replaceChildren(
        formHost,
        kind === "entry" && selected
          ? this.renderNewEntryForm(selected, () => setForm(null))
          : kind === "collection"
            ? this.renderNewCollectionForm(() => setForm(null))
            : null,
      );
      if (kind === null) container.scrollTop = 0;
    };

    const picker = !selected
      ? h("span", { class: "muted" }, "No collections yet")
      : this.collections.length > 1
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
        : h("span", { class: "collection-name" }, selected.name);

    container.appendChild(
      h(
        "div",
        { class: "toolbar-row" },
        h("div", { class: "grow" }, picker),
        selected
          ? h(
              "button",
              { class: "btn", type: "button", title: `New entry in ${selected.name}`, onClick: () => setForm(openForm === "entry" ? null : "entry") },
              icon("plus", 13),
              "New entry",
            )
          : null,
      ),
    );
    container.appendChild(formHost);

    const list = h("div", { class: "list" });
    if (selected) {
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
            },
            h("span", { class: "title" }, entry.title),
            h("span", { class: "id" }, entry.id),
            isCurrent ? icon("check", 13) : icon("chevron", 13),
          ),
        );
      }
    }
    container.appendChild(list);

    // A separate, explicit control so "new collection" can never be mistaken for "new post".
    container.appendChild(
      h(
        "button",
        { class: "row-action", type: "button", onClick: () => setForm(openForm === "collection" ? null : "collection") },
        icon("folderPlus", 14),
        h("span", null, "New collection"),
        h("span", { class: "row-action-hint" }, "src/content/…"),
      ),
    );

    if (!this.doc) {
      container.appendChild(
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
    }
    return container;
  }

  private renderNewEntryForm(collection: Collection, close: () => void): HTMLElement {
    const title = h("input", { class: "input", placeholder: "Title", autocomplete: "off" }) as HTMLInputElement;
    const slug = h("input", { class: "input", placeholder: "slug", spellcheck: false, autocomplete: "off", autocapitalize: "off" }) as HTMLInputElement;
    const error = h("div", { class: "form-error" });
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
        await this.navigate(routeFor(collection, created.id).href, { focusBody: true });
      } catch (err) {
        error.textContent = describe(err);
        create.disabled = false;
      }
    };

    const create = h("button", { class: "btn btn-primary", type: "button", onClick: () => void submit() }, "Create entry") as HTMLButtonElement;
    const form = h(
      "div",
      { class: "form" },
      h("div", { class: "form-title" }, `New entry in ${collection.name}`),
      h("label", null, "Title", title),
      h("label", null, h("span", null, "Slug ", h("span", { class: "muted" }, `· ${collection.dir}/`)), slug),
      error,
      h("div", { class: "form-actions" }, h("button", { class: "btn btn-ghost", type: "button", onClick: close }, "Cancel"), create),
    );
    form.addEventListener("keydown", (e) => {
      if (e.key === "Enter" && !(e.target instanceof HTMLTextAreaElement)) void submit();
    });
    keepInView(form);
    queueMicrotask(() => title.focus({ preventScroll: true }));
    return form;
  }

  private renderNewCollectionForm(close: () => void): HTMLElement {
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
        if (!created.config.updated) this.setStatus("error", created.config.note ?? "content.config.ts not updated");
        this.listCollection = created.collection;
        await this.navigate(routeFor({ name: created.collection, dir: created.dir, entries: [] }, created.id).href, { focusBody: true });
      } catch (err) {
        error.textContent = describe(err);
        create.disabled = false;
      }
    };

    const create = h("button", { class: "btn btn-primary", type: "button", onClick: () => void submit() }, "Create collection") as HTMLButtonElement;
    const form = h(
      "div",
      { class: "form" },
      h("div", { class: "form-title" }, "New collection"),
      h("label", null, "Name", name, preview),
      h("label", null, "First entry title", first),
      h("p", { class: "form-note" }, "Creates the folder, adds a defineCollection() with a starter schema to content.config.ts, and seeds one entry."),
      error,
      h("div", { class: "form-actions" }, h("button", { class: "btn btn-ghost", type: "button", onClick: close }, "Cancel"), create),
    );
    form.addEventListener("keydown", (e) => {
      if (e.key === "Enter" && !(e.target instanceof HTMLTextAreaElement)) void submit();
    });
    keepInView(form);
    queueMicrotask(() => name.focus({ preventScroll: true }));
    return form;
  }

  // ---- settings -------------------------------------------------------------------

  private renderSettings(): HTMLElement {
    const modeButton = (mode: ChromeMode) =>
      h("button", { type: "button", "aria-pressed": String(this.prefs.mode === mode), onClick: () => this.setMode(mode) }, MODE_LABEL[mode]);

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
          this.updateTuck();
        },
      },
      h("div", null, h("div", { class: "label" }, "Autosave"), h("div", { class: "desc" }, "Write to disk shortly after you stop typing")),
      h("span", { class: "switch" }),
    );

    const bodyState = !this.doc
      ? "No entry bound to this page."
      : this.bodyReadOnly
        ? `${this.doc.file} — MDX blocks unmapped; body read-only, fields editable.`
        : this.page.bound
          ? `Editing ${this.doc.file} in place${this.page.mapped ? "" : " (blocks unmapped — whole body re-serialized on save)"}.`
          : `${this.doc.file} — no data-float-body on this page; body editable in Source only.`;

    return h(
      "div",
      { class: "panel-body pad" },
      h(
        "div",
        { class: "setting setting-stack" },
        h("div", null, h("div", { class: "label" }, "Chrome"), h("div", { class: "desc" }, "Three ways to hang the editor off the Astro bar. Dev-only preview switch; remembered in this browser.")),
        h("div", { class: "segmented segmented-wide" }, modeButton("toolbar"), modeButton("float"), modeButton("sheet")),
        h("div", { class: "desc mode-blurb" }, `${MODE_LABEL[this.prefs.mode]} — ${MODE_BLURB[this.prefs.mode]}`),
      ),
      this.prefs.mode === "float" || this.prefs.mode === "sheet"
        ? h(
            "div",
            { class: "setting" },
            h("div", null, h("div", { class: "label" }, "Dock"), h("div", { class: "desc" }, "Which edge the chrome lives on")),
            h("div", { class: "segmented" }, sideButton("left", "Left"), sideButton("right", "Right")),
          )
        : null,
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
            "Hover anything grey to edit it · ⌘/Ctrl+S save · ⌘B / ⌘I / ⌘K format · Tab / ⇧Tab nest lists · type “# ”, “- ”, “1. ”, “> ”, “```” at a line start · drop or paste images into the text · click a component block to move or remove it · Esc leaves the text",
          ),
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

/**
 * Touch-first device: no hover *and* a touchscreen. Headless / virtual displays
 * report `hover: none` with zero touch points and should behave like a mouse.
 * `localStorage["astro-float:pointer"] = "coarse" | "fine"` forces either mode.
 */
function isTouchDevice(): boolean {
  const forced = localStorage.getItem("astro-float:pointer");
  if (forced === "coarse") return true;
  if (forced === "fine") return false;
  return matchMedia("(hover: none)").matches && navigator.maxTouchPoints > 0;
}

function readToolbarPlacement(): Placement {
  const root = document.querySelector("astro-dev-toolbar")?.shadowRoot?.querySelector<HTMLElement>("#dev-toolbar-root");
  const p = root?.dataset.placement;
  return p === "bottom-left" || p === "bottom-right" ? p : "bottom-center";
}

function loadPrefs(): Prefs {
  const defaults: Prefs = { side: "right", autosave: false, mode: "toolbar" };
  try {
    const stored = JSON.parse(localStorage.getItem(PREFS_KEY) ?? "{}");
    return {
      side: stored.side === "left" ? "left" : "right",
      autosave: Boolean(stored.autosave ?? defaults.autosave),
      mode: stored.mode === "float" || stored.mode === "sheet" ? stored.mode : "toolbar",
    };
  } catch {
    return defaults;
  }
}

/** Keep a focused control visible inside the (scrollable) panel when the keyboard comes up. */
function keepInView(form: HTMLElement) {
  form.addEventListener("focusin", (e) => {
    const target = e.target as HTMLElement;
    window.setTimeout(() => target.scrollIntoView?.({ block: "nearest", behavior: "smooth" }), 60);
  });
}

/**
 * iOS zooms the page when a focused control has text smaller than 16px and
 * doesn't zoom back out on blur. Float's controls are 16px on touch devices so
 * this shouldn't trigger — but if the page is left zoomed anyway, briefly pin
 * `maximum-scale=1` on the viewport meta to snap it back, then restore the
 * original so user zoom keeps working. No-op on desktop (`scale` is 1).
 */
function resetViewportZoom() {
  const vv = window.visualViewport;
  if (!vv || vv.scale <= 1.01) return;
  const meta = document.querySelector<HTMLMetaElement>('meta[name="viewport"]');
  if (!meta) return;
  const original = meta.getAttribute("content") ?? "width=device-width, initial-scale=1";
  const pinned = original.replace(/,?\s*maximum-scale=[^,]*/i, "") + ", maximum-scale=1";
  meta.setAttribute("content", pinned);
  window.setTimeout(() => meta.setAttribute("content", original), 350);
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
