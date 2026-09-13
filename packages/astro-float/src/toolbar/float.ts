import { api, ApiError, type Collection, type EntryDoc, type Frontmatter, type MediaItem } from "./api";
import { isMediaFile, mediaMarkdown } from "./embeds";
import { h } from "./dom";
import { ensurePageStyle, PageEditor, removePageStyle } from "./editor";
import { DatePicker } from "./datepicker";
import { findBody, markBody, unmarkAuto } from "./autobind";
import { FieldBindings } from "./fields";
import { RegionControl } from "./overlays";
import { detectEntry, swapPage, type DetectedEntry } from "./page";
import { Panel, type PanelPrefs, type StatusView } from "./panel/panel";
import { clone, describe, resetViewportZoom } from "./panel/util";
import { schemaFor, type CollectionSchema } from "./schema";
import { STYLES } from "./styles";

type Status = "idle" | "saving" | "refreshing" | "saved" | "warning" | "error" | "conflict";

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
  /** The quiet copy / source control in the corner of the body. */
  private region = new RegionControl();

  /**
   * Source mode: the corner control's Source view — a Markdown textarea
   * standing in for the prose, right there in the page. Leaving it saves and
   * swaps in Astro's fresh render.
   */
  private sourceArea: HTMLTextAreaElement | null = null;
  private sourceDraft = "";
  private sourceBusy = false;
  private sourceError: string | null = null;
  private wiredAreas = new WeakSet<HTMLTextAreaElement>();
  private savePromise: Promise<void> | null = null;
  /** The panel follows the site's colour scheme: watch the page for changes while editing. */
  private themeObserver: MutationObserver | null = null;
  private themeMedia = window.matchMedia("(prefers-color-scheme: dark)");

  private status: Status = "idle";
  private statusMessage = "";
  private savedAt: number | null = null;
  private saving = false;
  private navigating = false;
  private autosaveTimer: number | undefined;
  private savedTimer: number | undefined;
  /** Watches the panel's root (width, hidden, resizing) to push the document over while it's open. */
  private panelWatch: MutationObserver | null = null;

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
      markDirty: () => this.touched(),
      save: (force) => this.save(force),
      discard: () => this.discardChanges(),
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
      this.watchPanel();
      this.watchTheme();
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
      // Leave the page exactly as it was: no editors, nothing auto-binding put on it.
      this.page.unbind();
      this.fields.unbind();
      unmarkAuto();
      this.loadedFor = null;
      this.region.hide();
      this.releaseFocus();
      removePageStyle();
      this.unwatchTheme();
      this.panel.destroy();
      this.unwatchPanel();
    }
  }

  /**
   * Push the document over by the panel's width while the panel is open, so
   * the article's right edge never sits under it. The panel already puts its
   * width (`--sb-width`) and its hidden / resizing state on our root; this
   * mirrors them onto `<html>` for the page stylesheet. Phones keep the sheet.
   */
  private watchPanel() {
    if (this.panelWatch) return;
    this.panelWatch = new MutationObserver(() => this.syncPagePush());
    this.panelWatch.observe(this.root, { attributes: true, attributeFilter: ["style", "data-panel-hidden", "data-resizing"], childList: true });
    this.syncPagePush();
  }

  private unwatchPanel() {
    this.panelWatch?.disconnect();
    this.panelWatch = null;
    this.syncPagePush();
  }

  private syncPagePush() {
    const html = document.documentElement;
    const width = this.root.style.getPropertyValue("--sb-width").trim();
    const open = this.editing && this.root.childElementCount > 0 && !!width && !this.root.hasAttribute("data-panel-hidden");
    if (open) {
      html.style.setProperty("--float-panel-width", width);
      html.setAttribute("data-float-panel", this.root.hasAttribute("data-resizing") ? "resizing" : "");
    } else {
      html.removeAttribute("data-float-panel");
      html.style.removeProperty("--float-panel-width");
      if (!html.getAttribute("style")) html.removeAttribute("style");
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
    if (this.sourceArea) return this.sourceArea;
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

  /** The corner control's Source / Rendered: swap the prose for a Markdown textarea in the same spot (and back). */
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
    const rect = container.getBoundingClientRect();

    const area = document.createElement("textarea");
    area.className = "astro-float-source";
    area.spellcheck = false;
    area.setAttribute("aria-label", "Markdown source");
    // Same height as the prose it replaces, so nothing below moves and the page keeps its scroll position.
    area.style.height = `${Math.max(240, rect.height)}px`;
    this.enterSource(area);
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

  /** Make `area` the body's editor, standing in for the prose. */
  private enterSource(area: HTMLTextAreaElement) {
    if (!this.doc || this.bodyReadOnly || this.sourceArea) return;
    this.sourceDraft = this.currentBody();
    this.sourceError = null;
    this.wireSourceArea(area);
    area.value = this.sourceDraft;
    this.page.detach();
    const container = this.page.container;
    if (container) {
      container.style.display = "none";
      container.after(area);
    }
    this.sourceArea = area;
    this.region.hide();
    this.renderStatus();
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
      const place = this.sourcePlace(this.sourceArea);
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
    this.fields.bind(this.doc.frontmatter, { body: container, schema: this.schema });
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
    // A warning (Astro rejected the last write) stays until the next save says otherwise.
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

  /** A key the collection's schema declares: its row is always on the form, set or not. */
  private schemaKnows(key: string) {
    return this.schema?.source === "zod" && this.schema.fields.some((f) => f.key === key);
  }

  private setField(key: string, value: unknown) {
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
      if (result.changed && result.synced === false) {
        // Written, but Astro's content layer didn't pick it up (a schema rejection, most likely).
        this.setStatus("warning", "Saved, but Astro rejected the entry. Check the terminal.");
      } else {
        this.setStatus("saved");
        window.clearTimeout(this.savedTimer);
        this.savedTimer = window.setTimeout(() => {
          if (this.status === "saved") this.setStatus("idle");
        }, 2000);
      }
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
      : this.status === "error" || this.status === "conflict" || this.status === "warning"
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
      case "warning":
        view.text = this.statusMessage;
        view.tone = "warn";
        break;
      default:
        if (dirty) view.text = "Unsaved changes";
        else view.text = this.doc ? (this.savedAt ? `${this.prefs.autosave ? "Autosaved" : "Saved"} ${formatTime(this.savedAt)}` : "Up to date") : "";
    }
    this.panel.renderStatus(view);
  }

  // ---- images and video (drop / paste on the prose only) ------------------------------

  private placeImage(item: MediaItem, range: Range | null) {
    if (this.sourceArea) {
      const area = this.sourceArea;
      const snippet = `\n${mediaMarkdown(item)}\n`;
      area.setRangeText(snippet, area.selectionStart, area.selectionEnd, "end");
      this.sourceDraft = area.value;
      this.touched();
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
