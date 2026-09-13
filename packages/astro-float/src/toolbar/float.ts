import { api, ApiError, type Collection, type EntryDoc, type Frontmatter, type MediaItem } from "./api";
import { h } from "./dom";
import { ensurePageStyle, PageEditor, removePageStyle } from "./editor";
import { DatePicker } from "./datepicker";
import { FieldBindings } from "./fields";
import { detectEntry, swapPage, type DetectedEntry } from "./page";
import { Panel, type PanelPrefs, type StatusView } from "./panel/panel";
import { clone, describe, resetViewportZoom } from "./panel/util";
import { schemaFor, type CollectionSchema } from "./schema";
import { STYLES } from "./styles";

type Status = "idle" | "saving" | "refreshing" | "saved" | "error" | "conflict";

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

export function mountFloat(canvas: ShadowRoot, host: FloatHost): FloatHandle {
  const float = new Float(canvas, host);
  return {
    setEditing: (on) => float.setEditing(on),
    beforeEditOff: () => float.beforeEditOff(),
  };
}

/**
 * Edit-mode lifecycle. Owns the entry, the draft, saving and soft navigation;
 * the on-page editors live in `editor.ts` / `fields.ts`, the panel in `panel/`.
 */
class Float {
  private root: HTMLElement;
  private panel: Panel;

  private prefs: PanelPrefs = loadPrefs();
  private editing = false;
  private loadedFor: string | null = null;

  private collections: Collection[] = [];
  private detected: DetectedEntry | null = null;
  private doc: EntryDoc | null = null;
  private schema: CollectionSchema | null = null;
  private draftFrontmatter: Frontmatter = {};
  /** Body draft used only when the page has no `[data-float-body]` to edit in place. */
  private draftBody = "";
  /** MDX whose blocks couldn't be mapped to source: never rewrite the body from HTML. */
  private bodyReadOnly = false;
  private listCollection: string | null = null;

  private page: PageEditor;
  private fields: FieldBindings;

  /**
   * Source mode: the Markdown tab's textarea is the body's editor. The prose
   * on the page stays visible but read-only and re-renders on save.
   */
  private sourceArea: HTMLTextAreaElement | null = null;
  private sourceDraft = "";
  private sourceBusy = false;
  private sourceError: string | null = null;
  private wiredAreas = new WeakSet<HTMLTextAreaElement>();
  private savePromise: Promise<void> | null = null;

  private status: Status = "idle";
  private statusMessage = "";
  private savedAt: number | null = null;
  private saving = false;
  private navigating = false;
  private autosaveTimer: number | undefined;
  private savedTimer: number | undefined;

  constructor(
    private canvas: ShadowRoot,
    private host: FloatHost,
  ) {
    const style = document.createElement("style");
    style.textContent = STYLES;
    canvas.appendChild(style);

    this.root = h("div", { class: "float" });
    canvas.appendChild(this.root);

    this.page = new PageEditor({
      onChange: () => this.touched(),
      onFiles: (files, range) => void this.uploadAll(files, range),
    });
    this.fields = new FieldBindings({
      onChange: (key, value) => {
        this.draftFrontmatter[key] = value;
        this.panel.syncField(key);
        this.touched();
      },
    });

    this.panel = new Panel(this.root, {
      canvas,
      prefs: this.prefs,
      savePrefs: () => this.savePrefs(),
      setAutosave: (on) => {
        this.prefs.autosave = on;
        this.savePrefs();
        if (on && this.isDirty()) this.scheduleAutosave();
        this.renderStatus();
      },
      doc: () => this.doc,
      draft: () => this.draftFrontmatter,
      original: () => this.doc?.frontmatter ?? {},
      schema: () => this.schema,
      collections: () => this.collections,
      listCollection: () => this.listCollection,
      setListCollection: (name) => (this.listCollection = name),
      onPage: (key) => this.fields.has(key),
      body: () => ({ bound: this.page.bound, mapped: this.page.mapped, readOnly: this.bodyReadOnly, text: this.currentBody() }),
      setField: (key, value) => this.setField(key, value),
      removeField: (key) => this.removeField(key),
      revertField: (key) => this.revertField(key),
      replaceDraft: (next) => this.replaceDraft(next),
      changed: (key) => this.fieldChanged(key),
      save: (force) => this.save(force),
      discard: () => this.discardChanges(),
      navigate: (href, opts) => this.navigate(href, opts),
      notify: (message) => this.setStatus("error", message),
      openSource: (area) => this.enterSource(area),
      closeSource: () => this.leaveSource(),
      sourceState: () => ({ active: !!this.sourceArea, busy: this.sourceBusy, error: this.sourceError }),
      discardSource: () => this.discardSource(),
    });

    this.bindViewport();

    // Escape inside the panel: leave the field.
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
    window.addEventListener("popstate", (e) => {
      if (this.editing || (e.state && (e.state as { astroFloat?: boolean }).astroFloat)) void this.navigate(location.href, { push: false });
    });

    // Read-only introspection for tests and bug reports: host.__astroFloat.state()
    (this.canvas.host as HTMLElement & { __astroFloat?: unknown }).__astroFloat = {
      state: () => ({
        editing: this.editing,
        status: this.status,
        sourceMode: !!this.sourceArea,
        tab: this.panel.activeTab,
        frontmatterDirty: this.frontmatterDirty(),
        bodyDirty: this.bodyDirty(),
        bodyBound: this.page.bound,
        bodyMapped: this.page.mapped,
        bodyReadOnly: this.bodyReadOnly,
        bodyDiff: this.page.debugDiff(),
        onPageFields: this.fields.keys(),
        schema: this.schema,
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
        await this.loadPage(); // renders the panel once it knows the entry
      } else {
        this.attachEditors();
        this.panel.render();
      }
    } else {
      window.clearTimeout(this.autosaveTimer);
      DatePicker.close();
      this.exitSourceMode(false);
      this.page.detach();
      this.fields.detach();
      this.releaseFocus();
      removePageStyle();
      this.panel.destroy();
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

  /** Blur whatever has the caret in the panel and undo an iOS focus-zoom if one slipped through. */
  private releaseFocus() {
    (this.canvas.activeElement as HTMLElement | null)?.blur();
    resetViewportZoom();
  }

  // ---- source mode (the panel's Markdown tab) ------------------------------------------

  /** Escape hatch when leaving source view can't save: drop the source edits, show the body as it was. */
  private discardSource() {
    if (!this.sourceArea) return;
    this.sourceError = null;
    this.sourceDraft = this.doc?.body ?? "";
    this.panel.syncSource(this.sourceDraft);
    if (this.status === "error" || this.status === "conflict") this.setStatus("idle");
    else this.renderStatus();
    this.panel.refreshSource();
  }

  /**
   * Make `area` (the Markdown tab's textarea) the body's editor. The on-page
   * editor lets go of the prose, which stays visible and re-renders on save.
   * The textarea opens on the block the page caret is in (else the first block
   * in view), so the source picks up where the page left off.
   */
  private enterSource(area: HTMLTextAreaElement) {
    if (!this.doc || this.bodyReadOnly) return;
    if (this.sourceArea === area) return;
    if (this.sourceArea) {
      const draft = this.sourceDraft;
      this.exitSourceMode(false);
      this.sourceDraft = draft;
    } else {
      this.sourceDraft = this.currentBody();
    }
    this.sourceError = null;
    this.wireSourceArea(area);
    if (area.value !== this.sourceDraft) area.value = this.sourceDraft;
    const where = this.caretPlace();
    this.page.detach();
    this.sourceArea = area;
    if (where) {
      area.setSelectionRange(where.offset, where.offset);
      const lineHeight = parseFloat(getComputedStyle(area).lineHeight) || 20;
      const line = area.value.slice(0, where.offset).split("\n").length - 1;
      area.scrollTop = Math.max(0, line * lineHeight - 48);
    }
    this.renderStatus();
  }

  /** Where the page caret is (else the first block in view), as an offset into the body's Markdown. */
  private caretPlace(): { index: number; offset: number } | null {
    const container = this.page.container;
    if (!container || !this.page.bound) return null;
    const sel = document.getSelection();
    const caretNode = sel && sel.rangeCount > 0 && sel.anchorNode && container.contains(sel.anchorNode) ? sel.anchorNode : null;
    return this.page.markdownOffsetOf(caretNode ?? firstVisibleBlock(container));
  }

  private wireSourceArea(area: HTMLTextAreaElement) {
    if (this.wiredAreas.has(area)) return;
    this.wiredAreas.add(area);
    area.addEventListener("input", () => {
      if (this.sourceArea !== area) return;
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
        if (this.sourceArea === area) {
          this.sourceDraft = area.value;
          this.touched();
        }
      }
    });
  }

  /**
   * Leave source mode: a save re-renders the page from what was typed, then
   * the caret goes back to the block it was in. False when the save didn't take.
   */
  private async leaveSource(): Promise<boolean> {
    if (!this.sourceArea) return true;
    if (this.sourceBusy) return false;
    this.sourceBusy = true;
    this.sourceError = null;
    this.panel.refreshSource();
    try {
      if (this.savePromise) await this.savePromise; // an autosave already in flight
      if (this.isDirty()) {
        await this.save();
        if (this.isDirty()) {
          // The save didn't take (conflict, server error): stay put and say why, with a way out.
          this.sourceError = this.status === "conflict" ? "Changed on disk — Reload or Overwrite in the header" : this.statusMessage || "Couldn't save";
          return false;
        }
      }
      if (this.sourceArea) {
        const offset = this.sourceArea.selectionStart;
        this.exitSourceMode(true);
        if (this.doc && this.page.bound && !this.bodyReadOnly) this.page.focusBlock(blockIndexAt(offset, this.doc.lead, this.doc.blocks));
      }
      return true;
    } finally {
      this.sourceBusy = false;
      this.panel.refreshSource();
    }
  }

  private exitSourceMode(restoreView: boolean) {
    if (!this.sourceArea) return;
    this.sourceArea = null;
    if (this.page.container && restoreView && this.editing && !this.bodyReadOnly) this.page.attach();
  }

  // ---- page lifecycle ---------------------------------------------------------

  /** (Re)read the current URL: which entry is this, bind the editors, draw the panel. */
  private async loadPage() {
    DatePicker.close();
    this.exitSourceMode(false);
    this.page.unbind();
    this.fields.unbind();
    this.doc = null;
    this.schema = null;
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
        this.schema = await this.loadSchema(this.doc);
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
    this.panel.render();
  }

  /** The collection's field definitions from the server; inferred from the entry's values when it has none to give. */
  private async loadSchema(doc: EntryDoc): Promise<CollectionSchema> {
    try {
      const schema = await api.schema(doc.collection);
      if (schema && Array.isArray(schema.fields)) return schema;
    } catch {
      /* no schema endpoint (yet), or no schema for this collection */
    }
    return schemaFor(doc.collection, doc.frontmatter);
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
   * it in under the panel. No unload, no "Leave site?".
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

  // ---- frontmatter draft (the panel's write path) ----------------------------------------

  private setField(key: string, value: unknown) {
    const isNew = !(key in this.draftFrontmatter);
    this.draftFrontmatter[key] = value;
    this.fields.setValue(key, value);
    this.touched();
    if (isNew) this.panel.renderFields();
  }

  private removeField(key: string) {
    if (!(key in this.draftFrontmatter)) return;
    delete this.draftFrontmatter[key];
    this.touched();
    this.panel.renderFields();
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
    this.panel.syncAll();
  }

  /** The YAML view parsed cleanly: it becomes the draft, and the page's fields follow. */
  private replaceDraft(next: Frontmatter) {
    this.draftFrontmatter = clone(next);
    for (const key of this.fields.keys()) this.fields.setValue(key, this.draftFrontmatter[key]);
    this.touched();
  }

  private fieldChanged(key: string) {
    if (!this.doc) return false;
    return JSON.stringify(this.draftFrontmatter[key]) !== JSON.stringify(this.doc.frontmatter[key]);
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
      this.panel.syncSource(this.sourceDraft);
    }
    this.page.restoreBaseline();
    this.draftBody = this.doc.body;
    this.draftFrontmatter = clone(this.doc.frontmatter);
    for (const key of this.fields.keys()) this.fields.setValue(key, this.draftFrontmatter[key]);
    this.panel.syncAll();
    this.setStatus("idle");
    this.panel.refreshSource();
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
      if (fromSource && this.sourceDraft === body) {
        this.sourceDraft = result.body;
        this.panel.syncSource(result.body);
      }
      // Source-only mode: adopt the server's normalized text unless more was typed meanwhile.
      else if (!snapshot && !this.bodyReadOnly && this.draftBody === body) this.draftBody = result.body;

      if (result.changed && refresh) {
        this.setStatus("refreshing");
        try {
          const scrollY = window.scrollY;
          await swapPage();
          window.scrollTo(0, scrollY);
          this.bindBody();
        } catch (err) {
          // Saved fine, page didn't re-render: fall back to the DOM we have and say so.
          console.warn("[astro-float] page refresh failed", err);
          this.setStatus("error", "Saved, but the page didn't refresh — reload to see it");
          this.saving = false;
          return;
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
      this.panel.renderCollection();
    } catch {
      /* non-fatal */
    }
  }

  // ---- status -----------------------------------------------------------------------

  private renderStatus() {
    const dirty = this.isDirty();
    const busy = this.status === "saving" || this.status === "refreshing";
    const dot: StatusView["dot"] = busy
      ? "saving"
      : this.status === "error" || this.status === "conflict"
        ? this.status
        : this.status === "saved"
          ? "saved"
          : dirty
            ? "dirty"
            : "idle";
    const view: StatusView = {
      text: "",
      tone: "",
      dot,
      showSave: dirty && !busy && this.status !== "conflict" && this.status !== "error",
      showDiscard: dirty && !busy,
      actions: [],
    };
    switch (this.status) {
      case "saving":
        view.text = "Saving…";
        break;
      case "refreshing":
        view.text = "Updating page…";
        break;
      case "conflict":
        view.text = "Changed on disk";
        view.tone = "warn";
        view.actions.push({ label: "Reload", onClick: () => void this.reloadFromDisk() }, { label: "Overwrite", primary: true, onClick: () => void this.save(true) });
        break;
      case "error":
        view.text = this.statusMessage || "Something went wrong";
        view.tone = "err";
        if (dirty) view.actions.push({ label: this.bodyReadOnly ? "Save fields" : "Retry", onClick: () => void this.save() });
        break;
      case "saved":
        view.text = "Saved";
        break;
      default:
        if (dirty) view.text = "Unsaved changes";
        else view.text = this.doc ? (this.savedAt ? `${this.prefs.autosave ? "Autosaved" : "Saved"} ${formatTime(this.savedAt)}` : "Up to date") : "";
    }
    this.panel.renderStatus(view);
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
}

// ---- helpers ------------------------------------------------------------------------

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

function loadPrefs(): PanelPrefs {
  try {
    const stored = JSON.parse(localStorage.getItem(PREFS_KEY) ?? "{}");
    const width = Number(stored.sidebarWidth);
    return { autosave: Boolean(stored.autosave), sidebarWidth: Number.isFinite(width) && width > 0 ? width : undefined };
  } catch {
    return { autosave: false };
  }
}

function formatTime(ts: number) {
  return new Date(ts).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function altFrom(name: string) {
  return name.replace(/\.[^.]+$/, "").replace(/[-_]+/g, " ");
}
