import { api, ApiError, type Collection, type EntryDoc, type Frontmatter, type MediaItem } from "./api";
import { h, replaceChildren } from "./dom";
import { ensurePageStyle, PageEditor, removePageStyle } from "./editor";
import { DatePicker } from "./datepicker";
import { DATE_LIKE, FieldBindings } from "./fields";
import { icon } from "./icons";
import { RegionControl } from "./overlays";
import { detectEntry, routeFor, swapPage, type DetectedEntry } from "./page";
import { STYLES } from "./styles";

type Status = "idle" | "saving" | "refreshing" | "saved" | "error" | "conflict";

interface Prefs {
  autosave: boolean;
}

export interface FloatHandle {
  setEditing(on: boolean): Promise<void>;
  beforeEditOff(): Promise<boolean>;
}

export interface FloatHost {
  /** Ask the toolbar to switch the Edit app off. */
  requestOff(): void;
}

const PREFS_KEY = "astro-float:prefs";
const AUTOSAVE_DELAY = 800;
/** Frontmatter keys that never get an input: Astro derives the id from the slug, so it's shown, not edited. */
const READ_ONLY_KEYS = new Set(["slug"]);

export function mountFloat(canvas: ShadowRoot, host: FloatHost): FloatHandle {
  const float = new Float(canvas, host);
  return {
    setEditing: (on) => float.setEditing(on),
    beforeEditOff: () => float.beforeEditOff(),
  };
}

class Float {
  private root: HTMLElement;
  private sidebar: HTMLElement | null = null;
  private fieldsSection: HTMLElement | null = null;
  private collectionSection: HTMLElement | null = null;
  private statusSlot: HTMLElement;
  private statusDot: HTMLElement;
  private saveButton: HTMLButtonElement;
  private discardButton: HTMLButtonElement;
  private statusText: HTMLElement | null = null;
  private statusActions: HTMLElement | null = null;

  private prefs: Prefs = loadPrefs();
  private editing = false;
  private loadedFor: string | null = null;

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
  /** Per-field "re-read the draft into your control" hooks, so page edits show up in the sidebar live. */
  private fieldSyncs = new Map<string, () => void>();
  private region = new RegionControl();

  /** In-page source view of the body: a textarea standing in for the prose. */
  private sourceArea: HTMLTextAreaElement | null = null;
  private sourceDraft = "";
  private sourceBusy = false;
  private sourceError: string | null = null;
  /** The sidebar can be tucked away while editing continues on the page. */
  private panelHidden = false;
  private savePromise: Promise<void> | null = null;

  private status: Status = "idle";
  private statusMessage = "";
  private savedAt: number | null = null;
  private saving = false;
  private navigating = false;
  private autosaveTimer: number | undefined;
  private savedTimer: number | undefined;
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
      { class: "btn btn-sm btn-primary", type: "button", hidden: true, title: "Save (⌘S)", onClick: () => void this.save() },
      icon("check", 13),
      h("span", {}, "Save"),
    ) as HTMLButtonElement;
    this.discardButton = h(
      "button",
      { class: "btn btn-sm btn-ghost btn-discard", type: "button", hidden: true, title: "Throw away unsaved changes and show what's on disk", onClick: () => this.discardChanges() },
      "Discard",
    ) as HTMLButtonElement;
    this.statusSlot = h("div", { class: "status-slot" }, this.statusDot, this.discardButton, this.saveButton);

    this.root = h("div", { class: "float" });
    canvas.appendChild(this.root);

    this.page = new PageEditor({
      onChange: () => this.touched(),
      onFiles: (files, range) => void this.uploadAll(files, range),
    });
    this.fields = new FieldBindings({
      onChange: (key, value) => {
        this.draftFrontmatter[key] = value;
        this.fieldSyncs.get(key)?.();
        this.touched();
      },
    });

    this.bindViewport();

    // Escape inside the sidebar: leave the field.
    this.root.addEventListener("keydown", (e) => {
      if (e.key !== "Escape") return;
      e.stopPropagation();
      (this.canvas.activeElement as HTMLElement | null)?.blur();
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
    // Astro's toolbar switches the active app off on Escape keyup. While editing,
    // Escape means "leave this field", never "leave edit mode" — the pencil does that.
    document.addEventListener(
      "keyup",
      (e) => {
        if (this.editing && e.key === "Escape") e.stopPropagation();
      },
      true,
    );
    // Only real unloads (tab close, hard refresh) should ever warn — Float's own
    // navigations are soft swaps and never reach here.
    window.addEventListener("beforeunload", (e) => {
      if (this.editing && this.isDirty() && !this.navigating) e.preventDefault();
    });
    document.addEventListener("click", this.onDocumentClick);
    document.addEventListener("focusin", this.onFocusIn);
    document.addEventListener("focusout", this.onFocusOut);
    window.addEventListener("popstate", (e) => {
      if (this.editing || (e.state && (e.state as { astroFloat?: boolean }).astroFloat)) void this.navigate(location.href, { push: false });
    });

    // Read-only introspection for tests and bug reports: host.__astroFloat.state()
    (this.canvas.host as HTMLElement & { __astroFloat?: unknown }).__astroFloat = {
      state: () => ({
        editing: this.editing,
        status: this.status,
        sourceMode: !!this.sourceArea,
        frontmatterDirty: this.frontmatterDirty(),
        bodyDirty: this.bodyDirty(),
        bodyBound: this.page.bound,
        bodyMapped: this.page.mapped,
        bodyReadOnly: this.bodyReadOnly,
        bodyDiff: this.page.debugDiff(),
        onPageFields: this.fields.keys(),
        entry: this.doc ? `${this.doc.collection}/${this.doc.id}` : null,
      }),
    };
  }

  // ---- edit mode ---------------------------------------------------------------

  async setEditing(on: boolean) {
    if (on === this.editing) return;
    this.editing = on;
    if (on) {
      ensurePageStyle();
      if (this.loadedFor !== location.href) {
        await this.loadPage(); // renders the sidebar once it knows the entry
      } else {
        this.attachEditors();
        this.renderSidebar();
      }
    } else {
      window.clearTimeout(this.autosaveTimer);
      this.panelHidden = false;
      DatePicker.close();
      this.exitSourceMode(false);
      this.page.detach();
      this.fields.detach();
      this.region.hide();
      this.releaseFocus();
      removePageStyle();
      this.root.textContent = "";
      this.sidebar = null;
      this.fieldsSection = null;
      this.collectionSection = null;
      this.statusText = null;
      this.statusActions = null;
    }
  }

  /** Called by the toolbar right before it switches the app off. */
  async beforeEditOff(): Promise<boolean> {
    if (!this.editing || !this.isDirty()) return true;
    await this.save();
    return !this.isDirty();
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

  /** Blur whatever has the caret in the sidebar and undo an iOS focus-zoom if one slipped through. */
  private releaseFocus() {
    const active = this.canvas.activeElement as HTMLElement | null;
    active?.blur();
    resetViewportZoom();
  }

  // ---- region control (copy / source) ------------------------------------------------

  private onFocusIn = (e: FocusEvent) => {
    if (!this.editing) return;
    const target = e.target as HTMLElement | null;
    if (!target) return;
    if (this.sourceArea && target === this.sourceArea) {
      this.region.show(this.sourceArea, this.bodyRegionActions());
      return;
    }
    if (this.page.container && (target === this.page.container || this.page.container.contains(target))) {
      this.region.show(this.page.container, this.bodyRegionActions());
      return;
    }
    const key = target.dataset?.floatField;
    if (key && this.fields.element(key) === target) {
      this.region.show(target, { copy: () => String(this.draftFrontmatter[key] ?? "") });
    }
  };

  private onFocusOut = () => {
    // In source view the control is the way back to the rendered page: keep it up.
    if (this.editing && !this.sourceArea) this.region.scheduleHide();
  };

  private bodyRegionActions() {
    return {
      copy: () => this.currentBody(),
      toggleSource: () => void this.toggleSourceMode(),
      isSource: () => !!this.sourceArea,
      busy: () => this.sourceBusy,
      error: () => this.sourceError,
      discard: () => this.discardSource(),
    };
  }

  /** Escape hatch when leaving source view can't save: drop the source edits, show the page as it was. */
  private discardSource() {
    if (!this.sourceArea) return;
    this.sourceError = null;
    this.sourceDraft = this.doc?.body ?? "";
    this.exitSourceMode(true);
    if (this.status === "error" || this.status === "conflict") this.setStatus("idle");
    else this.renderStatus();
  }

  /** Swap the rendered prose for a Markdown textarea in the same spot (and back). */
  private async toggleSourceMode() {
    if (this.sourceBusy) return;
    if (this.sourceArea) {
      // Leaving source view: a save re-renders the page from what was typed.
      // Remember where he is in the text so the rendered page opens on the same block, at the same height.
      const place = this.sourcePlace(this.sourceArea);
      this.sourceBusy = true;
      this.sourceError = null;
      this.region.refresh();
      try {
        if (this.savePromise) await this.savePromise; // an autosave already in flight
        if (this.isDirty()) {
          await this.save();
          if (this.isDirty()) {
            // The save didn't take (conflict, server error): stay put and say why, with a way out.
            this.sourceError = this.status === "conflict" ? "Changed on disk — Reload or Overwrite in the sidebar" : this.statusMessage || "Couldn't save";
            return;
          }
        }
        if (this.sourceArea) this.exitSourceMode(true); // nothing changed, or the save didn't re-render
        if (place && this.doc && this.page.bound && !this.bodyReadOnly) {
          this.page.focusBlock(blockIndexAt(place.offset, this.doc.lead, this.doc.blocks), place.viewportY);
        }
      } finally {
        this.sourceBusy = false;
        this.region.refresh();
      }
      return;
    }
    const container = this.page.container;
    if (!container || this.bodyReadOnly) return;

    // Where he is: the caret's block, else the first block visible in the viewport.
    const sel = document.getSelection();
    const caretNode = sel && sel.rangeCount > 0 && sel.anchorNode && container.contains(sel.anchorNode) ? sel.anchorNode : null;
    const anchorNode = caretNode ?? firstVisibleBlock(container);
    const where = this.page.markdownOffsetOf(anchorNode);
    const anchorBlock = anchorNode ? (anchorNode instanceof Element ? anchorNode : anchorNode.parentElement) : null;
    const anchorTop = anchorBlock ? closestTopLevel(anchorBlock, container)?.getBoundingClientRect().top ?? null : null;
    const scrollY = window.scrollY;
    const rect = container.getBoundingClientRect();

    this.sourceDraft = this.currentBody();
    const area = document.createElement("textarea");
    area.className = "astro-float-source";
    area.value = this.sourceDraft;
    area.spellcheck = false;
    area.setAttribute("aria-label", "Markdown source");
    // Same height as the prose it replaces, so nothing below moves and the page keeps its scroll position.
    area.style.height = `${Math.max(240, rect.height)}px`;
    area.addEventListener("input", () => {
      this.sourceDraft = area.value;
      this.touched();
    });
    area.addEventListener("keyup", (e) => {
      if (e.key === "Escape") e.stopPropagation();
    });
    area.addEventListener("keydown", (e) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        area.blur();
      }
      if (e.key === "Tab") {
        e.preventDefault();
        const s = area.selectionStart;
        area.setRangeText("  ", s, area.selectionEnd, "end");
        this.sourceDraft = area.value;
        this.touched();
      }
    });
    this.page.detach();
    container.style.display = "none";
    container.after(area);
    this.sourceArea = area;
    window.scrollTo(0, scrollY);
    area.focus({ preventScroll: true });
    // Open on the block he was looking at, at the height it had on the page.
    if (where) {
      area.setSelectionRange(where.offset, where.offset);
      const cs = getComputedStyle(area);
      const lineHeight = parseFloat(cs.lineHeight) || 21.6;
      const padTop = parseFloat(cs.paddingTop) || 0;
      const line = area.value.slice(0, where.offset).split("\n").length - 1;
      const areaTop = area.getBoundingClientRect().top;
      const wantedY = anchorTop ?? areaTop + padTop;
      area.scrollTop = Math.max(0, padTop + line * lineHeight - (wantedY - areaTop));
      // The textarea couldn't scroll far enough to line up? Only then nudge the page, and only enough to keep the line in view.
      const lineY = areaTop + padTop + line * lineHeight - area.scrollTop;
      if (lineY < 72 || lineY > window.innerHeight - 72) window.scrollBy(0, lineY - Math.min(wantedY, window.innerHeight - 120));
    } else {
      window.scrollTo(0, scrollY);
    }
    this.region.show(area, this.bodyRegionActions());
  }

  /** Caret offset in the source textarea plus the viewport height of its line. */
  private sourcePlace(area: HTMLTextAreaElement): { offset: number; viewportY: number } | null {
    if (!area.isConnected) return null;
    const offset = area.selectionStart;
    const cs = getComputedStyle(area);
    const lineHeight = parseFloat(cs.lineHeight) || 21.6;
    const padTop = parseFloat(cs.paddingTop) || 0;
    const line = area.value.slice(0, offset).split("\n").length - 1;
    const y = area.getBoundingClientRect().top + padTop + line * lineHeight - area.scrollTop;
    return { offset, viewportY: Math.max(72, Math.min(y, window.innerHeight - 72)) };
  }

  private exitSourceMode(restoreView: boolean) {
    if (!this.sourceArea) return;
    const area = this.sourceArea;
    this.sourceArea = null;
    area.remove();
    if (this.page.container) {
      this.page.container.style.display = "";
      if (restoreView && this.editing && !this.bodyReadOnly) this.page.attach();
    }
    this.region.hide();
  }

  // ---- page lifecycle ---------------------------------------------------------

  /** (Re)read the current URL: which entry is this, bind the editors, draw the sidebar. */
  private async loadPage() {
    DatePicker.close();
    this.exitSourceMode(false);
    this.page.unbind();
    this.fields.unbind();
    this.region.hide();
    this.doc = null;
    this.detected = null;
    this.draftFrontmatter = {};
    this.draftBody = "";
    this.bodyReadOnly = false;
    this.loadedFor = location.href;

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
    this.renderSidebar();
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
    if (this.page.bound && !this.bodyReadOnly && !this.sourceArea) this.page.attach();
  }

  /**
   * Soft navigation: save anything pending, fetch the next page's HTML and swap
   * it in under the sidebar. No unload, no "Leave site?".
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
    if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    const path = e.composedPath();
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
    await this.loadPage();
  }

  // ---- state helpers ----------------------------------------------------------

  private frontmatterDirty() {
    return !!this.doc && JSON.stringify(this.draftFrontmatter) !== JSON.stringify(this.doc.frontmatter);
  }

  private bodyDirty() {
    if (!this.doc || this.bodyReadOnly) return false;
    if (this.sourceArea) return this.sourceDraft !== this.doc.body;
    return this.page.bound ? this.page.isDirty() : this.draftBody !== this.doc.body;
  }

  private isDirty() {
    return this.frontmatterDirty() || this.bodyDirty();
  }

  private currentBody(): string {
    if (!this.doc) return "";
    if (this.bodyReadOnly) return this.doc.body;
    if (this.sourceArea) return this.sourceDraft;
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
    if (this.prefs.autosave) this.scheduleAutosave();
  }

  private scheduleAutosave() {
    window.clearTimeout(this.autosaveTimer);
    this.autosaveTimer = window.setTimeout(() => void this.save(), AUTOSAVE_DELAY);
  }

  private savePrefs() {
    localStorage.setItem(PREFS_KEY, JSON.stringify(this.prefs));
  }

  /**
   * Discard: everything goes back to what's on disk — body DOM, frontmatter,
   * the fields on the page, the source view — without writing anything.
   */
  private discardChanges() {
    if (!this.doc) return;
    window.clearTimeout(this.autosaveTimer);
    this.releaseFocus();
    (document.activeElement as HTMLElement | null)?.blur();
    if (this.sourceArea) {
      this.sourceDraft = this.doc.body;
      this.sourceError = null;
      this.exitSourceMode(true);
    }
    this.page.restoreBaseline();
    this.draftBody = this.doc.body;
    this.draftFrontmatter = clone(this.doc.frontmatter);
    for (const key of this.fields.keys()) this.fields.setValue(key, this.draftFrontmatter[key]);
    this.renderFieldsSection();
    this.setStatus("idle");
  }

  // ---- saving -----------------------------------------------------------------

  private save(force = false): Promise<void> {
    if (this.savePromise) return this.savePromise;
    this.savePromise = this.saveNow(force).finally(() => (this.savePromise = null));
    return this.savePromise;
  }

  private async saveNow(force: boolean) {
    if (!this.doc || this.saving) return;
    if (!this.isDirty() && !force) return;
    window.clearTimeout(this.autosaveTimer);

    this.saving = true;
    this.setStatus("saving");
    const frontmatter = clone(this.draftFrontmatter);
    const fromSource = !!this.sourceArea;
    const snapshot = this.page.bound && !this.bodyReadOnly && !fromSource ? this.page.snapshotForSave() : null;
    const body = snapshot ? snapshot.markdown : this.currentBody();
    // Re-rendering from the server would move the caret; skip it while the
    // user is typing on the page and let their DOM stand as the preview.
    // Source view is the exception: saving is how it gets back to a render.
    const refresh = fromSource || (!this.page.hasFocus() && !this.fields.hasFocus());

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
      if (fromSource) this.sourceDraft = result.body;
      // Source-only mode: adopt the server's normalized text unless more was typed meanwhile.
      else if (!snapshot && !this.bodyReadOnly && this.draftBody === body) this.draftBody = result.body;

      if (result.changed && refresh) {
        this.setStatus("refreshing");
        try {
          const scrollY = window.scrollY;
          await swapPage();
          this.exitSourceMode(false);
          window.scrollTo(0, scrollY);
          this.bindBody();
        } catch (err) {
          // Saved fine, page didn't re-render: fall back to the DOM we have and say so.
          console.warn("[astro-float] page refresh failed", err);
          if (fromSource) this.exitSourceMode(true);
          this.setStatus("error", "Saved, but the page didn't refresh — reload to see it");
          this.saving = false;
          return;
        }
        void this.refreshCollections();
      } else if (fromSource && !result.changed) {
        this.exitSourceMode(true);
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
      this.renderCollectionSection();
    } catch {
      /* non-fatal */
    }
  }

  // ---- sidebar ----------------------------------------------------------------------

  private renderSidebar() {
    if (!this.editing) return;
    this.fieldSyncs.clear();
    this.lastFoot = "";

    this.statusText = h("span", { class: "foot-status" });
    this.statusActions = h("div", { class: "foot-actions" }, this.statusSlot);
    const head = h(
      "header",
      { class: "sb-head" },
      h(
        "div",
        { class: "sb-title" },
        h("span", { class: "sb-entry", title: this.doc?.file ?? "" }, this.doc ? `${this.doc.collection}/${this.doc.id}` : "No entry on this page"),
        h(
          "button",
          { class: "icon-btn", type: "button", "aria-label": "Hide the sidebar (keep editing)", title: "Hide the sidebar — editing stays on", onClick: () => this.setPanelHidden(true) },
          icon("panelClose", 15),
        ),
      ),
      h("div", { class: "sb-status" }, this.statusText, this.statusActions),
    );

    this.fieldsSection = h("section", { class: "sb-section" });
    this.collectionSection = h("section", { class: "sb-section" });
    this.renderFieldsSection();
    this.renderCollectionSection();

    this.sidebar = h("aside", { class: "sidebar", "aria-label": "Content editor" }, head, this.fieldsSection, this.collectionSection, this.renderSettingsSection());
    // A quiet tab at the edge brings the sidebar back; it also carries the status dot / Save so nothing is lost while hidden.
    const tab = h(
      "div",
      { class: "sb-tab" },
      h("button", { class: "sb-tab-open", type: "button", "aria-label": "Show the sidebar", title: "Show the sidebar", onClick: () => this.setPanelHidden(false) }, icon("panelOpen", 15)),
      h("div", { class: "sb-tab-status" }),
    );
    replaceChildren(this.root, this.sidebar, tab);
    this.root.toggleAttribute("data-panel-hidden", this.panelHidden);
    this.renderStatus();
  }

  private setPanelHidden(hidden: boolean) {
    this.panelHidden = hidden;
    DatePicker.close();
    this.root.toggleAttribute("data-panel-hidden", hidden);
    if (hidden) this.releaseFocus();
    this.lastSlot = ""; // the status slot moves between the header and the tab
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
    const showDiscard = dirty && !busy;
    const slot = `${showSave}|${showDiscard}|${dotState}|${this.statusMessage}|${this.panelHidden}`;
    if (slot !== this.lastSlot) {
      this.lastSlot = slot;
      this.saveButton.hidden = !showSave;
      this.discardButton.hidden = !showDiscard;
      this.statusDot.hidden = showSave || showDiscard;
      this.statusDot.dataset.state = dotState;
      this.statusDot.title = dotState === "dirty" ? "Unsaved changes" : dotState === "saved" ? "Saved" : this.statusMessage || "";
      const tabStatus = this.root.querySelector(".sb-tab-status");
      if (this.panelHidden && tabStatus) tabStatus.appendChild(this.statusSlot);
      else if (this.statusActions && !this.statusActions.contains(this.statusSlot)) this.statusActions.appendChild(this.statusSlot);
    }

    if (!this.statusText || !this.statusActions) return;
    const foot = `${this.status}|${dirty}|${this.prefs.autosave}|${this.statusMessage}|${this.savedAt}`;
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
        if (dirty) text = this.prefs.autosave ? "Unsaved · autosave on" : "Unsaved changes";
        else text = this.doc ? (this.savedAt ? `Saved ${formatTime(this.savedAt)}` : "Up to date") : "";
    }
    this.statusText.textContent = text;
    if (tone) this.statusText.dataset.tone = tone;
    else delete this.statusText.dataset.tone;
    replaceChildren(this.statusActions, ...actions, ...(this.panelHidden ? [] : [this.statusSlot]));
  }

  // ---- fields ---------------------------------------------------------------------------

  private renderFieldsSection() {
    const section = this.fieldsSection;
    if (!section) return;
    this.fieldSyncs.clear();
    if (!this.doc) {
      section.hidden = true;
      return;
    }
    section.hidden = false;

    const rows: HTMLElement[] = [];
    for (const [key, value] of Object.entries(this.draftFrontmatter)) {
      if (READ_ONLY_KEYS.has(key)) {
        rows.push(h("div", { class: "field" }, h("div", { class: "field-head" }, h("span", { class: "field-key" }, key), h("span", { class: "field-meta" }, "read-only")), h("div", { class: "field-static mono" }, String(value))));
        continue;
      }
      rows.push(this.renderField(key, value));
    }
    // Fields removed since the last save stay listed so the removal can be undone before it's written.
    for (const key of Object.keys(this.doc.frontmatter)) {
      if (key in this.draftFrontmatter) continue;
      rows.push(
        h(
          "div",
          { class: "field field-removed" },
          h(
            "div",
            { class: "field-head" },
            h("span", { class: "field-key" }, key),
            h("span", { class: "field-meta" }, "removed on save"),
            h("button", { class: "btn btn-sm btn-ghost", type: "button", onClick: () => this.revertField(key) }, icon("undo", 13), "Restore"),
          ),
        ),
      );
    }

    const newKey = h("input", { class: "input", placeholder: "New field", "aria-label": "New field name" }) as HTMLInputElement;
    const add = () => {
      const key = newKey.value.trim();
      if (!key || key in this.draftFrontmatter || READ_ONLY_KEYS.has(key)) return;
      this.draftFrontmatter[key] = "";
      this.touched();
      this.renderFieldsSection();
    };
    newKey.addEventListener("keydown", (e) => {
      if (e.key === "Enter") add();
    });

    replaceChildren(
      section,
      h("h3", { class: "sb-heading" }, "Fields"),
      rows.length ? h("div", { class: "fields" }, rows) : h("p", { class: "empty" }, "No frontmatter yet."),
      h("div", { class: "field-add" }, newKey, h("button", { class: "btn btn-icon", type: "button", "aria-label": "Add field", title: "Add field", onClick: add }, icon("plus", 14))),
    );
  }

  /** Put a field back to what's on disk (also restores a removed field, in its original position). */
  private revertField(key: string) {
    if (!this.doc) return;
    if (key in this.doc.frontmatter) {
      const next: Frontmatter = {};
      for (const k of Object.keys(this.doc.frontmatter)) {
        if (k === key) next[k] = clone(this.doc.frontmatter[k]);
        else if (k in this.draftFrontmatter) next[k] = this.draftFrontmatter[k];
      }
      for (const k of Object.keys(this.draftFrontmatter)) if (!(k in next)) next[k] = this.draftFrontmatter[k];
      this.draftFrontmatter = next;
    } else {
      delete this.draftFrontmatter[key];
    }
    this.fields.setValue(key, this.draftFrontmatter[key]);
    this.touched();
    this.renderFieldsSection();
  }

  private fieldChanged(key: string) {
    if (!this.doc) return false;
    return JSON.stringify(this.draftFrontmatter[key]) !== JSON.stringify(this.doc.frontmatter[key]);
  }

  private renderField(key: string, value: unknown): HTMLElement {
    const kind = fieldKind(value);
    const original = this.doc?.frontmatter[key];
    const onPage = this.fields.has(key);
    const revert = h(
      "button",
      { class: "field-revert", type: "button", "aria-label": `Revert ${key}`, title: "Back to the saved value", hidden: !this.fieldChanged(key), onClick: () => this.revertField(key) },
      icon("undo", 12),
    ) as HTMLButtonElement;
    const hint = h("div", { class: "field-note" });
    const set = (next: unknown) => {
      this.draftFrontmatter[key] = next;
      this.fields.setValue(key, next);
      revert.hidden = !this.fieldChanged(key);
      this.touched();
    };
    // The page can change this field too (title typed on the page): mirror it here unless this control has the caret.
    const mirror = (apply: (v: unknown) => void) =>
      this.fieldSyncs.set(key, () => {
        revert.hidden = !this.fieldChanged(key);
        apply(this.draftFrontmatter[key]);
      });

    let control: HTMLElement;
    switch (kind) {
      case "boolean": {
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
              set(next);
            },
          },
          h("span", { class: "switch" }),
        );
        control = row;
        break;
      }
      case "number": {
        const input = h("input", { class: "input", type: "number", step: "any", value: String(value) }) as HTMLInputElement;
        input.addEventListener("input", () => {
          if (input.value === "") {
            input.dataset.invalid = "";
            hint.textContent = `Empty — keeping ${String(original ?? value)} until you enter a number.`;
            return;
          }
          const n = Number(input.value);
          if (Number.isNaN(n)) return;
          delete input.dataset.invalid;
          hint.textContent = "";
          set(n);
        });
        control = input;
        break;
      }
      case "date": {
        // A real picker, shared with the date on the page. The stored shape is kept: date part swapped, any time suffix preserved.
        const suffix = String(value).slice(10);
        const label = h("span", { class: "date-field-label" }) as HTMLElement;
        const button = h(
          "button",
          { class: "input date-field", type: "button", "aria-haspopup": "dialog", title: "Change the date" },
          label,
          icon("calendar", 14),
        ) as HTMLButtonElement;
        const paint = (v: unknown) => {
          const iso = typeof v === "string" && DATE_LIKE.test(v) ? v.slice(0, 10) : "";
          label.textContent = iso ? formatDateLabel(iso) : "Pick a date";
          button.dataset.iso = iso;
        };
        paint(value);
        button.addEventListener("click", (e) => {
          e.preventDefault();
          DatePicker.toggle({
            anchor: button,
            value: button.dataset.iso || null,
            onPick: (iso) => {
              const next = iso + suffix;
              paint(next);
              set(next);
            },
          });
        });
        mirror((v) => paint(v));
        control = button;
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
        mirror((v) => {
          if (this.canvas.activeElement === ta) return;
          const text = typeof v === "string" ? v : "";
          if (ta.value !== text) ta.value = text;
        });
        control = ta;
        break;
      }
      case "json": {
        const ta = h("textarea", { class: "textarea mono", rows: 4, value: JSON.stringify(value, null, 2) }) as HTMLTextAreaElement;
        ta.addEventListener("input", () => {
          try {
            set(JSON.parse(ta.value));
            delete ta.dataset.invalid;
            hint.textContent = "";
          } catch {
            ta.dataset.invalid = "";
            hint.textContent = "Not valid JSON yet — keeping the last valid value.";
          }
        });
        control = ta;
        break;
      }
      default: {
        const input = h("input", { class: "input", type: "text", value: value == null ? "" : String(value) }) as HTMLInputElement;
        input.addEventListener("input", () => set(input.value));
        mirror((v) => {
          if (this.canvas.activeElement === input) return;
          const text = typeof v === "string" ? v : "";
          if (input.value !== text) input.value = text;
        });
        control = input;
      }
    }

    return h(
      "div",
      { class: "field", "data-kind": kind, "data-on-page": onPage ? "" : null },
      h(
        "div",
        { class: "field-head" },
        h("span", { class: "field-key", title: onPage ? `${key} · ${kind} · also editable on the page` : `${key} · ${kind}` }, key),
        revert,
        onPage ? h("span", { class: "field-meta", title: "Also editable on the page" }, "on page") : null,
        kind === "boolean" ? control : null,
        h(
          "button",
          {
            class: "field-remove",
            type: "button",
            "aria-label": `Remove ${key}`,
            title: "Remove field (undo before saving with Restore)",
            onClick: () => {
              delete this.draftFrontmatter[key];
              this.touched();
              this.renderFieldsSection();
            },
          },
          icon("close", 12),
        ),
      ),
      kind === "boolean" ? null : control,
      hint,
    );
  }

  // ---- images (drop / paste on the prose only) ----------------------------------------

  private placeImage(item: MediaItem, range: Range | null) {
    if (this.sourceArea) {
      const area = this.sourceArea;
      const snippet = `\n![${altFrom(item.name)}](${item.src})\n`;
      area.setRangeText(snippet, area.selectionStart, area.selectionEnd, "end");
      this.sourceDraft = area.value;
      this.touched();
    } else if (this.page.bound && !this.bodyReadOnly) {
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

  private renderCollectionSection() {
    const section = this.collectionSection;
    if (!section) return;
    const formHost = h("div");
    let openForm: "entry" | "collection" | null = null;

    const selected = this.collections.find((c) => c.name === this.listCollection) ?? this.collections[0];
    if (selected) this.listCollection = selected.name;

    // Cancel/close puts the list back exactly as it was: same sidebar, keyboard down, no zoom left behind.
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
    };

    const picker = !selected
      ? h("span", { class: "muted" }, "No collections yet")
      : this.collections.length > 1
        ? (h(
            "select",
            {
              class: "select select-inline",
              "aria-label": "Collection",
              onChange: (e: Event) => {
                this.listCollection = (e.target as HTMLSelectElement).value;
                this.renderCollectionSection();
              },
            },
            this.collections.map((c) => h("option", { value: c.name, selected: c.name === selected.name }, c.name)),
          ) as HTMLSelectElement)
        : h("span", { class: "collection-name" }, selected.name);

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
              title: `${entry.id}${route.guessed ? " (guessed route)" : ""}`,
            },
            h("span", { class: "title" }, entry.title),
            isCurrent ? icon("check", 13) : null,
          ),
        );
      }
      // Two distinct, quiet rows: a new entry here, or a whole new collection.
      list.appendChild(
        h(
          "button",
          { class: "list-item list-action", type: "button", title: `New entry in ${selected.name}`, onClick: () => setForm(openForm === "entry" ? null : "entry") },
          icon("plus", 14),
          h("span", { class: "title" }, "New entry"),
        ),
      );
    }
    list.appendChild(
      h(
        "button",
        { class: "list-item list-action", type: "button", title: "New collection under src/content/", onClick: () => setForm(openForm === "collection" ? null : "collection") },
        icon("folderPlus", 14),
        h("span", { class: "title" }, "New collection"),
      ),
    );

    replaceChildren(
      section,
      h("div", { class: "sb-heading sb-heading-row" }, h("span", null, "Collection"), h("div", { class: "sb-heading-aside" }, picker)),
      formHost,
      list,
      !this.doc
        ? h(
            "p",
            { class: "empty" },
            "Open an entry to edit it in place. If Float can't detect one from the URL, bind it with ",
            h("code", null, 'data-float-entry="blog:my-post"'),
            " and mark the rendered body with ",
            h("code", null, "data-float-body"),
            ".",
          )
        : null,
    );
  }

  /** Title only — the slug is derived and shown, never edited. */
  private renderNewEntryForm(collection: Collection, close: () => void): HTMLElement {
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
      h("label", null, "Title", title, where),
      error,
      h("div", { class: "form-actions" }, h("button", { class: "btn btn-ghost", type: "button", onClick: close }, "Cancel"), create),
    );
    form.addEventListener("keydown", (e) => {
      if (e.key === "Enter") void submit();
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
      if (e.key === "Enter") void submit();
    });
    keepInView(form);
    queueMicrotask(() => name.focus({ preventScroll: true }));
    return form;
  }

  // ---- settings -------------------------------------------------------------------

  private renderSettingsSection(): HTMLElement {
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
      : this.bodyReadOnly
        ? `${this.doc.file} — MDX blocks unmapped; body read-only, fields editable.`
        : this.page.bound
          ? `Editing ${this.doc.file} in place${this.page.mapped ? "" : " (blocks unmapped — whole body re-serialized on save)"}.`
          : `${this.doc.file} — no data-float-body on this page; body not editable here.`;

    return h(
      "details",
      { class: "sb-section sb-details" },
      h("summary", { class: "sb-heading" }, "Settings"),
      h("div", { class: "sb-details-body" }, autosave,
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
      ),
    );
  }
}

// ---- helpers ------------------------------------------------------------------------

type FieldKind = "string" | "text" | "boolean" | "number" | "date" | "tags" | "json";

function fieldKind(value: unknown): FieldKind {
  if (typeof value === "boolean") return "boolean";
  if (typeof value === "number") return "number";
  if (typeof value === "string") {
    if (DATE_LIKE.test(value)) return "date";
    if (value.length > 80 || value.includes("\n")) return "text";
    return "string";
  }
  if (Array.isArray(value) && value.every((v) => typeof v === "string" || typeof v === "number")) return "tags";
  if (value == null) return "string";
  return "json";
}

/** The block a Markdown offset falls in, from the server's block list (lead + blocks joined by blank lines). */
function blockIndexAt(offset: number, lead: string, blocks: Array<{ src: string; trailer: string }>): number {
  let pos = lead ? lead.length + 2 : 0;
  for (let i = 0; i < blocks.length; i++) {
    pos += blocks[i].src.length + 2 + (blocks[i].trailer ? blocks[i].trailer.length + 2 : 0);
    if (offset < pos) return i;
  }
  return Math.max(0, blocks.length - 1);
}

/** First top-level block of the body whose box reaches into the viewport. */
function firstVisibleBlock(container: HTMLElement): Element | null {
  for (const child of Array.from(container.children)) {
    if (child.getBoundingClientRect().bottom > 0) return child;
  }
  return container.firstElementChild;
}

function closestTopLevel(el: Element, container: HTMLElement): Element | null {
  let node: Element | null = el;
  while (node && node.parentElement !== container) node = node.parentElement;
  return node;
}

/** "Oct 3, 2026" — the sidebar's compact date label. */
function formatDateLabel(iso: string) {
  return new Intl.DateTimeFormat(document.documentElement.lang || navigator.language || "en", { dateStyle: "medium", timeZone: "UTC" }).format(new Date(`${iso}T00:00:00Z`));
}

function loadPrefs(): Prefs {
  try {
    const stored = JSON.parse(localStorage.getItem(PREFS_KEY) ?? "{}");
    return { autosave: Boolean(stored.autosave) };
  } catch {
    return { autosave: false };
  }
}

/** Keep a focused control visible inside the (scrollable) sidebar when the keyboard comes up. */
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
