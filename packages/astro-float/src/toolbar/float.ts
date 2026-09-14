import { api, ApiError, onFileChanged, type Collection, type EntryDoc, type FileChange, type Frontmatter, type MediaItem, type ValidationIssue } from "./api";
import { isMediaFile, mediaMarkdown } from "./embeds";
import { h } from "./dom";
import { ensurePageStyle, PageEditor, removePageStyle } from "./editor";
import { DatePicker } from "./datepicker";
import { findBody, markBody, unmarkAuto } from "./autobind";
import { FieldBindings } from "./fields";
import { RegionControl } from "./overlays";
import { detectEntry, indexFor, routeFor, swapPage, type DetectedEntry } from "./page";
import { Pill, type PillPrefs, type StatusView } from "./panel/pill";
import { clone, describe, resetViewportZoom } from "./panel/util";
import { SourceEditor } from "./source";
import { humanize, schemaFor, type CollectionSchema } from "./schema";
import { STYLES } from "./styles";
import { attachTooltips, detachTooltips } from "./tooltip";

type Status = "idle" | "saving" | "refreshing" | "saved" | "deleted" | "warning" | "error" | "conflict";

export interface FloatHandle {
  setEditing(on: boolean): Promise<void>;
  beforeEditOff(): Promise<boolean>;
}

export interface FloatHost {
  /** Ask the toolbar to switch the Edit app off. */
  requestOff(): void;
}

const PREFS_KEY = "astro-float:prefs";
/** Autosave writes 2s after the last keystroke; every keystroke restarts the clock, so it never fires mid-typing. */
const AUTOSAVE_DELAY = 2000;
/** How long the pill stays green (and says "Saved") after a successful write. */
const SAVED_FOR = 4000;
/** How long it says "Deleted" after an entry or a collection goes. */
const DELETED_FOR = 2500;

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
  private panel: Pill;

  private prefs: PillPrefs = loadPrefs();
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
  /** The quiet copy / source control in the corner of the body. */
  private region = new RegionControl();

  /**
   * Source mode: the corner control's Source view — a Markdown textarea
   * standing in for the prose, right there in the page. Leaving it saves and
   * swaps in Astro's fresh render.
   */
  private sourceArea: HTMLTextAreaElement | null = null;
  private sourceEditor: SourceEditor | null = null;
  private sourceDraft = "";
  private sourceBusy = false;
  private sourceError: string | null = null;
  private savePromise: Promise<void> | null = null;
  /** The panel follows the site's colour scheme: watch the page for changes while editing. */
  private themeObserver: MutationObserver | null = null;
  private themeMedia = window.matchMedia("(prefers-color-scheme: dark)");

  private status: Status = "idle";
  private statusMessage = "";
  /** What the last save's validation rejected (a 422), cleared field by field as values change. */
  private issues: ValidationIssue[] = [];
  /** The file changed on disk while the draft was dirty: the user picks Reload or Keep mine. */
  private staleOnDisk = false;
  /** Keep mine: the next save overwrites whatever is on disk. */
  private keepMine = false;
  private unsubscribeFiles: (() => void) | null = null;
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
      onChange: () => {
        this.clearIssues("body");
        this.touched();
      },
      onFiles: (files, range) => void this.uploadAll(files, range),
    });
    this.fields = new FieldBindings({
      onChange: (key, value) => {
        this.draftFrontmatter[key] = value;
        this.clearIssues(key);
        this.panel.syncField(key);
        this.touched();
      },
    });

    this.panel = new Pill(this.root, {
      canvas,
      prefs: this.prefs,
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
      issues: () => this.issues,
      setField: (key, value) => this.setField(key, value),
      removeField: (key) => this.removeField(key),
      revertField: (key) => this.revertField(key),
      replaceDraft: (next) => this.replaceDraft(next),
      changed: (key) => this.fieldChanged(key),
      markDirty: () => this.touched(),
      save: (force) => this.save(force),
      discard: () => this.discardChanges(),
      rename: (slug) => this.rename(slug),
      deleteEntry: () => this.deleteEntry(),
      deleteCollection: (name) => this.deleteCollection(name),
      navigate: (href, opts) => this.navigate(href, opts),
      notify: (message) => this.setStatus("error", message),
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
    document.addEventListener("focusin", this.onFocusIn);
    document.addEventListener("focusout", this.onFocusOut);
    document.addEventListener("pointerover", this.onPointerOver);
    document.addEventListener("pointerout", this.onPointerOut);
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
        onPageFields: this.fields.boundKeys(),
        issues: this.issues,
        staleOnDisk: this.staleOnDisk,
        keepMine: this.keepMine,
        schema: this.schema,
        entry: this.doc ? `${this.doc.collection}/${this.doc.id}` : null,
      }),
      /** Tests: what the dev server would send when a file changes on disk. */
      simulateFileChange: (change: FileChange) => this.onFileChanged(change),
    };
  }

  // ---- edit mode ---------------------------------------------------------------

  async setEditing(on: boolean) {
    if (on === this.editing) return;
    this.editing = on;
    if (on) {
      ensurePageStyle();
      attachTooltips(document);
      attachTooltips(this.canvas);
      this.unsubscribeFiles ??= onFileChanged((change) => this.onFileChanged(change));
      this.watchTheme();
      if (this.loadedFor !== location.href) {
        await this.loadPage(); // renders the pill once it knows the entry
      } else {
        this.attachEditors();
        this.panel.render();
      }
    } else {
      window.clearTimeout(this.autosaveTimer);
      DatePicker.close();
      this.exitSourceMode(false);
      // Leave the page exactly as it was: no editors, nothing auto-binding put on it.
      this.page.unbind();
      this.fields.unbind();
      unmarkAuto();
      this.loadedFor = null;
      this.region.dispose();
      this.releaseFocus();
      this.unsubscribeFiles?.();
      this.unsubscribeFiles = null;
      detachTooltips(this.canvas);
      detachTooltips(document);
      removePageStyle();
      this.unwatchTheme();
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

  // ---- body control (copy / source) ------------------------------------------------

  /** The body region: the prose container, or the in-page source textarea standing in for it. */
  private bodyRegion(): HTMLElement | null {
    if (this.sourceEditor) return this.sourceEditor.el;
    return this.page.bound && !this.bodyReadOnly ? this.page.container : null;
  }

  private inBody(target: EventTarget | null): boolean {
    const region = this.bodyRegion();
    return !!region && target instanceof Node && (target === region || region.contains(target));
  }

  private onFocusIn = (e: FocusEvent) => {
    if (this.editing && this.inBody(e.target)) this.region.show(this.bodyRegion()!, this.bodyRegionActions());
  };

  private onFocusOut = () => {
    // In source view the control is the way back to the rendered page: keep it up.
    if (this.editing && !this.sourceArea) this.region.scheduleHide();
  };

  private onPointerOver = (e: PointerEvent) => {
    if (this.editing && this.inBody(e.target) && !this.region.shown) this.region.show(this.bodyRegion()!, this.bodyRegionActions());
  };

  private onPointerOut = (e: PointerEvent) => {
    if (this.editing && this.inBody(e.target) && !this.inBody(e.relatedTarget) && !this.sourceArea) this.region.scheduleHide();
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
    this.region.refresh();
  }

  // ---- source mode (raw Markdown, in the page) -------------------------------------------

  /** The corner control's Source / Rendered: swap the prose for its Markdown in the same spot (and back). */
  private async toggleSourceMode() {
    if (this.sourceBusy) return;
    if (this.sourceArea) {
      await this.leaveSource();
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

    const editor = this.enterSource(container);
    if (!editor) return;
    window.scrollTo(0, scrollY);
    editor.focus();
    // Open on the block he was looking at, at the height it had on the page: the source line that starts
    // that block goes where the block's top was, so the swap reads as the prose turning into its Markdown.
    // The page stays put (the wash and the corner control don't move); only a caret line that would be
    // off-screen brings the page along, and then only to where the block was.
    if (where) {
      editor.setSelection(where.offset);
      const lineY = editor.lineTop(where.offset);
      if (lineY < 72 || lineY > window.innerHeight - 72) window.scrollBy(0, lineY - Math.min(anchorTop ?? 120, window.innerHeight - 120));
    }
    this.region.show(editor.el, this.bodyRegionActions());
  }

  /** Put the source editor in the prose's place. */
  private enterSource(container: HTMLElement): SourceEditor | null {
    if (!this.doc || this.bodyReadOnly || this.sourceArea) return null;
    this.sourceDraft = this.currentBody();
    this.sourceError = null;
    const editor = new SourceEditor(container, this.sourceDraft, {
      onInput: (text) => {
        if (this.sourceEditor !== editor) return;
        this.sourceDraft = text;
        this.clearIssues("body");
        this.touched();
      },
    });
    this.page.detach();
    container.style.display = "none";
    container.after(editor.el);
    this.sourceEditor = editor;
    this.sourceArea = editor.area;
    this.region.hide();
    this.renderStatus();
    return editor;
  }

  /**
   * Leave source view: a save re-renders the page from what was typed, then
   * the caret goes back to the block it was in, at the height it had on
   * screen. False when the save didn't take.
   */
  private async leaveSource(): Promise<boolean> {
    if (!this.sourceArea) return true;
    if (this.sourceBusy) return false;
    this.sourceBusy = true;
    this.sourceError = null;
    this.region.refresh();
    try {
      // Remember where he is in the text so the rendered page opens on the same block.
      const place = this.sourcePlace();
      if (this.savePromise) await this.savePromise; // an autosave already in flight
      if (this.isDirty()) {
        await this.save();
        if (this.isDirty()) {
          // The save didn't take (conflict, server error): stay put and say why, with a way out.
          this.sourceError = this.status === "conflict" ? "Changed on disk — Reload or Overwrite in the header" : this.statusMessage || "Couldn't save";
          return false;
        }
      }
      if (this.sourceArea) this.exitSourceMode(true); // nothing changed, or the save didn't re-render
      if (place && this.doc && this.page.bound && !this.bodyReadOnly) {
        this.page.focusBlock(blockIndexAt(place.offset, this.doc.lead, this.doc.blocks), place.viewportY);
      }
      return true;
    } finally {
      this.sourceBusy = false;
      this.region.refresh();
    }
  }

  /** Caret offset in the source plus the viewport height of its line. */
  private sourcePlace(): { offset: number; viewportY: number } | null {
    const editor = this.sourceEditor;
    if (!editor || !editor.el.isConnected) return null;
    const offset = editor.area.selectionStart;
    const y = editor.lineTop(offset);
    return { offset, viewportY: Math.max(72, Math.min(y, window.innerHeight - 72)) };
  }

  private exitSourceMode(restoreView: boolean) {
    if (!this.sourceArea) return;
    const editor = this.sourceEditor;
    this.sourceArea = null;
    this.sourceEditor = null;
    editor?.dispose();
    if (this.page.container) {
      this.page.container.style.display = "";
      if (restoreView && this.editing && !this.bodyReadOnly) this.page.attach();
    }
    this.region.hide();
  }

  // ---- theme: follow the site, not (only) the viewer -------------------------------------

  private applyTheme() {
    const theme = detectTheme(this.themeMedia.matches);
    if (this.root.dataset.theme !== theme) this.root.dataset.theme = theme;
    if (document.documentElement.getAttribute("data-float-theme") !== theme) {
      document.documentElement.setAttribute("data-float-theme", theme);
      this.region.refresh(); // its surface is computed from the page colours
    }
  }

  private onThemeChange = () => this.applyTheme();

  private watchTheme() {
    this.applyTheme();
    this.themeMedia.addEventListener("change", this.onThemeChange);
    if (!this.themeObserver) {
      this.themeObserver = new MutationObserver(() => this.applyTheme());
    }
    this.themeObserver.observe(document.documentElement, { attributes: true, attributeFilter: ["class", "style", "data-theme", "data-color-scheme"] });
    this.themeObserver.observe(document.body, { attributes: true, attributeFilter: ["class", "style", "data-theme", "data-color-scheme"] });
  }

  private unwatchTheme() {
    this.themeMedia.removeEventListener("change", this.onThemeChange);
    this.themeObserver?.disconnect();
    delete this.root.dataset.theme;
    document.documentElement.removeAttribute("data-float-theme");
  }

  // ---- page lifecycle ---------------------------------------------------------

  /** (Re)read the current URL: which entry is this, bind the editors, draw the panel. */
  private async loadPage() {
    DatePicker.close();
    this.exitSourceMode(false);
    this.page.unbind();
    this.fields.unbind();
    unmarkAuto();
    this.region.hide();
    this.doc = null;
    this.schema = null;
    this.issues = [];
    this.staleOnDisk = false;
    this.keepMine = false;
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
    this.applyTheme();
    this.panel.render();
  }

  /** The collection's field definitions, carried on the entry response; inferred from the entry's values when the server had none to give. */
  private async loadSchema(doc: EntryDoc): Promise<CollectionSchema> {
    if (doc.schema && Array.isArray(doc.schema.fields)) return doc.schema;
    return schemaFor(doc.collection, doc.frontmatter);
  }

  /** Bind the in-place editors to the body and the fields (attributes first, then auto-detected); attach them if Edit is on. */
  private bindBody() {
    if (!this.doc) return;
    let container = PageEditor.find();
    if (!container) {
      container = findBody(this.doc.blocks);
      if (container) markBody(container);
    }
    this.fields.bind(this.doc.frontmatter, { body: container, schema: this.schema, collection: this.doc.collection });
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
   * it in under the panel. No unload, no "Leave site?". `discard` drops what's
   * pending instead: the entry it belonged to was just deleted.
   */
  private async navigate(href: string, { push = true, focusBody = false, discard = false } = {}) {
    const url = new URL(href, location.href);
    if (!discard && this.isDirty()) {
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

  /**
   * Change the entry's address (the last segment of its id). Pending edits
   * are saved first — they'd be lost with the old file otherwise — then the
   * server moves the file or folder, and the page follows to the new route
   * (the learned pattern with the id swapped). Rejects with the reason
   * ("taken", a bad slug) for the Address row to show; nothing else moves.
   */
  private async rename(slug: string) {
    if (!this.doc) return;
    if (this.isDirty()) {
      await this.save();
      if (this.isDirty()) throw new Error(this.statusMessage || "Couldn't save the pending edits first");
    }
    const doc = this.doc;
    window.clearTimeout(this.autosaveTimer);
    this.setStatus("saving");
    let renamed;
    try {
      renamed = await api.rename({ collection: doc.collection, id: doc.id, slug, baseHash: doc.hash });
    } catch (err) {
      this.setStatus("idle");
      throw err;
    }
    const collection = this.collections.find((c) => c.name === doc.collection) ?? { name: doc.collection, dir: "", entries: [] };
    const { href } = routeFor(collection, renamed.id);
    // The sync signal says the store has the entry; the route can still take a beat to answer.
    await waitForPage(href, renamed.synced ? 3000 : 8000);
    await this.navigate(href);
  }

  /**
   * Delete the entry on this page (asked once in the popover). What's pending
   * goes with it, unsaved. The page moves on — to the collection's listing
   * when one answers, else the entry before it (or after), else the home page
   * — and the pill says "Deleted". Rejects with the reason for the question
   * line to show; nothing is deleted then.
   */
  private async deleteEntry() {
    const doc = this.doc;
    if (!doc) return;
    await this.settleSaves();
    this.setStatus("saving");
    try {
      await api.deleteEntry(doc.collection, doc.id);
    } catch (err) {
      this.setStatus("idle");
      throw err;
    }
    const href = await landingAfterDelete(this.collections.find((c) => c.name === doc.collection), doc.id);
    await this.navigate(href, { discard: true });
    this.flashDeleted();
  }

  /** Delete a whole collection (asked once in the footer) and go to the home page. Rejects with the reason. */
  private async deleteCollection(name: string) {
    // An entry of another collection still saves on the way out; this collection's own edits go with it.
    const here = this.doc?.collection === name;
    await this.settleSaves();
    this.setStatus("saving");
    let deleted;
    try {
      deleted = await api.deleteCollection(name);
    } catch (err) {
      this.setStatus("idle");
      throw err;
    }
    if (this.listCollection === name) this.listCollection = null;
    // The content config changed: let the home page answer before it's swapped in.
    await waitForPage("/", deleted.synced ? 3000 : 8000);
    await this.navigate("/", { discard: here });
    if (deleted.config.updated) this.flashDeleted();
    else this.setStatus("warning", deleted.config.note ?? "Deleted, but the content config wasn't updated");
  }

  /** No autosave waiting and no write in flight: a save landing after a delete would put the file back. */
  private async settleSaves() {
    window.clearTimeout(this.autosaveTimer);
    if (this.savePromise) await this.savePromise;
    window.clearTimeout(this.autosaveTimer);
  }

  /** Green for a moment, saying "Deleted". */
  private flashDeleted() {
    this.setStatus("deleted");
    window.clearTimeout(this.savedTimer);
    this.savedTimer = window.setTimeout(() => {
      if (this.status === "deleted") this.setStatus("idle");
    }, DELETED_FOR);
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

  /**
   * The dev server saw this entry's file change outside Float. A clean draft
   * just follows it; a dirty one is kept and the pill asks: Reload, or keep mine.
   */
  private onFileChanged(change: FileChange) {
    if (!this.editing || !this.doc) return;
    const mine = (change.collection === this.doc.collection && change.id === this.doc.id) || (!!change.file && change.file === this.doc.file);
    if (!mine) return;
    // Our own save comes back as an event too; the hash says so. Nothing to do.
    if (change.hash && change.hash === this.doc.hash) return;
    if (!this.isDirty()) {
      void this.reloadFromDisk();
      return;
    }
    this.staleOnDisk = true;
    this.renderStatus();
  }

  private async reloadFromDisk() {
    if (!this.detected) return;
    this.staleOnDisk = false;
    this.keepMine = false;
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
    return this.frontmatterDirty() || this.bodyDirty() || this.panel.yamlPending();
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
    // A warning (Astro rejected the last write) stays until the next save says otherwise, and so does a
    // validation error while any of its issues are still standing.
    if (this.status === "saved" || this.status === "deleted" || (this.status === "error" && !this.bodyReadOnly && !this.issues.length)) this.status = "idle";
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

  /** A key the collection's schema declares: its row is always on the form, set or not. */
  private schemaKnows(key: string) {
    return this.schema?.source === "zod" && this.schema.fields.some((f) => f.key === key);
  }

  /** A value changed: whatever validation said about it no longer applies. */
  private clearIssues(key?: string) {
    if (!this.issues.length) return;
    const before = this.issues.length;
    this.issues = key === undefined ? [] : this.issues.filter((i) => issueKeyOf(i) !== key);
    if (this.issues.length === before) return;
    if (!this.issues.length && this.status === "error") this.status = "idle";
    this.statusMessage = this.issues.length ? this.issueSummary() : "";
    this.panel.renderFields();
  }

  private issueSummary() {
    const first = this.issues[0];
    if (!first) return "";
    const key = issueKeyOf(first);
    const label = key === "body" ? "Body" : key ? (this.schema?.fields.find((f) => f.key === key)?.label ?? humanize(key)) : "";
    return label ? `${label}: ${first.message}` : first.message;
  }

  private setField(key: string, value: unknown) {
    this.clearIssues(key);
    const isNew = !(key in this.draftFrontmatter);
    if (isNew && this.schemaKnows(key)) {
      // A schema field being set for the first time goes in at its schema position, not at the end.
      const next: Frontmatter = {};
      for (const f of this.schema!.fields) {
        if (f.key === key) next[key] = value;
        else if (f.key in this.draftFrontmatter) next[f.key] = this.draftFrontmatter[f.key];
      }
      for (const k of Object.keys(this.draftFrontmatter)) if (!(k in next)) next[k] = this.draftFrontmatter[k];
      this.draftFrontmatter = next;
    } else {
      this.draftFrontmatter[key] = value;
    }
    this.fields.setValue(key, value);
    this.touched();
    // The row already exists for a schema field (it was just unset): update it in place, keep the caret.
    // Only an unknown key needs a new row. The YAML text follows either way.
    if (isNew) {
      if (this.schemaKnows(key)) this.panel.syncField(key);
      else this.panel.renderFields();
    }
    this.panel.syncYaml();
  }

  private removeField(key: string) {
    if (!(key in this.draftFrontmatter)) return;
    this.clearIssues(key);
    delete this.draftFrontmatter[key];
    this.touched();
    if (this.schemaKnows(key)) this.panel.syncField(key);
    else this.panel.renderFields();
    this.panel.syncYaml();
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
    this.clearIssues();
    this.draftFrontmatter = clone(next);
    for (const key of this.fields.boundKeys()) this.fields.setValue(key, this.draftFrontmatter[key]);
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
      this.exitSourceMode(true);
    }
    this.page.restoreBaseline();
    this.draftBody = this.doc.body;
    this.draftFrontmatter = clone(this.doc.frontmatter);
    for (const key of this.fields.boundKeys()) this.fields.setValue(key, this.draftFrontmatter[key]);
    this.panel.syncAll();
    this.setStatus("idle");
    this.region.refresh();
  }

  // ---- saving -----------------------------------------------------------------

  private save(force = false): Promise<void> {
    if (this.savePromise) return this.savePromise;
    this.savePromise = this.saveNow(force).finally(() => (this.savePromise = null));
    return this.savePromise;
  }

  private async saveNow(force: boolean) {
    if (!this.doc || this.saving) return;
    force = force || this.keepMine; // "Keep mine": whatever changed on disk, this draft wins
    this.panel.commitYaml(); // YAML typed but not parsed yet counts: fold it into the draft first
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
      if (fromSource && this.sourceDraft === body) this.sourceDraft = result.body;
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
      this.issues = [];
      this.staleOnDisk = false;
      this.keepMine = false;
      if (result.changed && result.synced === false) {
        // Written, but Astro's content layer didn't pick it up (a schema rejection, most likely).
        this.setStatus("warning", "Saved, but Astro rejected the entry. Check the terminal.");
      } else {
        this.setStatus("saved");
        window.clearTimeout(this.savedTimer);
        this.savedTimer = window.setTimeout(() => {
          if (this.status === "saved") this.setStatus("idle");
        }, SAVED_FOR);
      }
    } catch (err) {
      if (err instanceof ApiError && err.status === 409) this.setStatus("conflict");
      else if (err instanceof ApiError && err.status === 422 && err.issues?.length) {
        // The schema rejected the draft: nothing was written. Say which field, and show it under the row.
        this.issues = err.issues;
        this.setStatus("error", this.issueSummary());
        this.panel.renderFields();
      } else this.setStatus("error", describe(err));
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
      : this.status === "error" || this.status === "conflict" || this.status === "warning"
        ? this.status
        : this.status === "saved" || this.status === "deleted"
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
        // A validation error needs a change, not a retry: the messages under the rows say what.
        if (dirty && !this.issues.length) view.actions.push({ label: this.bodyReadOnly ? "Save fields" : "Retry", onClick: () => void this.save() });
        break;
      case "saved":
        view.text = "Saved";
        break;
      case "deleted":
        view.text = "Deleted";
        break;
      case "warning":
        view.text = this.statusMessage;
        view.tone = "warn";
        break;
      default:
        if (dirty && this.staleOnDisk) {
          view.text = "Changed on disk";
          view.tip = "Changed on disk · click to reload or keep";
          view.tone = "warn";
          view.showDiscard = false; // Reload covers it, and the header has only so much room
          view.actions.push(
            { label: "Reload", onClick: () => void this.reloadFromDisk() },
            {
              label: "Keep mine",
              onClick: () => {
                this.keepMine = true;
                this.staleOnDisk = false;
                this.renderStatus();
              },
            },
          );
        } else if (dirty) view.text = "Unsaved changes";
        else view.text = this.doc ? (this.savedAt ? `${this.prefs.autosave ? "Autosaved" : "Saved"} ${formatTime(this.savedAt)}` : "Up to date") : "";
    }
    this.panel.renderStatus(view);
  }

  // ---- images and video (drop / paste on the prose only) ------------------------------

  private placeImage(item: MediaItem, range: Range | null) {
    if (this.sourceEditor) {
      this.sourceEditor.insertText(`\n${mediaMarkdown(item)}\n`); // goes through the editor's input path
    } else if (this.page.bound && !this.bodyReadOnly) {
      this.page.insertMedia(item, range);
    } else if (!this.bodyReadOnly) {
      const sep = this.draftBody === "" || this.draftBody.endsWith("\n\n") ? "" : this.draftBody.endsWith("\n") ? "\n" : "\n\n";
      this.draftBody = `${this.draftBody}${sep}${mediaMarkdown(item)}\n`;
      this.touched();
    }
  }

  private async uploadAll(files: File[], range: Range | null) {
    if (!this.doc) return;
    const images = files.filter(isMediaFile);
    if (!images.length) {
      this.setStatus("error", "Only images and videos can be dropped here");
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

/** Poll a page until the dev server answers it with HTML (a just-moved entry's route), or the time runs out. */
async function waitForPage(href: string, timeoutMs: number) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(href, { headers: { accept: "text/html" }, cache: "no-store" });
      if (res.ok) return;
    } catch {
      /* server busy */
    }
    await new Promise((r) => setTimeout(r, 150));
  }
}

/** Where a deleted entry's page goes: the collection's listing if it answers, else the entry before it (or after) if that does, else home. */
async function landingAfterDelete(collection: Collection | undefined, id: string): Promise<string> {
  if (!collection) return "/";
  const i = collection.entries.findIndex((e) => e.id === id);
  const neighbour = i === -1 ? undefined : (collection.entries[i - 1] ?? collection.entries[i + 1]);
  for (const href of [indexFor(collection), neighbour ? routeFor(collection, neighbour.id).href : null]) {
    if (href && (await answers(href))) return href;
  }
  return "/";
}

/** One look: does the dev server answer `href` with a page? */
async function answers(href: string): Promise<boolean> {
  try {
    const res = await fetch(href, { headers: { accept: "text/html" }, cache: "no-store" });
    return res.ok && (res.headers.get("content-type") ?? "").includes("text/html");
  } catch {
    return false;
  }
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

/**
 * Light or dark, from what the page actually looks like: the painted background
 * of <body> (then <html>), else a declared `color-scheme`, else the viewer's preference.
 */
function detectTheme(prefersDark: boolean): "light" | "dark" {
  for (const el of [document.body, document.documentElement]) {
    const l = luminance(getComputedStyle(el).backgroundColor);
    if (l !== null) return l < 0.5 ? "dark" : "light";
  }
  const declared = getComputedStyle(document.documentElement).colorScheme ?? "";
  const dark = /\bdark\b/.test(declared);
  const light = /\blight\b/.test(declared);
  if (dark && !light) return "dark";
  if (light && !dark) return "light";
  return prefersDark ? "dark" : "light";
}

/** Relative luminance of an `rgb()` / `rgba()` colour, or null when it's (mostly) transparent. */
function luminance(color: string): number | null {
  const m = color.match(/rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)(?:[,\s/]+([\d.]+%?))?/);
  if (!m) return null;
  const alpha = m[4] === undefined ? 1 : m[4].endsWith("%") ? parseFloat(m[4]) / 100 : parseFloat(m[4]);
  if (alpha < 0.5) return null;
  const [r, g, b] = [m[1], m[2], m[3]].map((v) => parseFloat(v) / 255);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** The field an issue is about: the first segment of its path ("body" for the body). */
function issueKeyOf(issue: ValidationIssue): string | null {
  const first = Array.isArray(issue.path) ? issue.path[0] : String(issue.path ?? "").split(".")[0];
  return first === undefined || first === "" ? null : String(first);
}

function loadPrefs(): PillPrefs {
  try {
    const stored = JSON.parse(localStorage.getItem(PREFS_KEY) ?? "{}");
    return { autosave: Boolean(stored.autosave) };
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
