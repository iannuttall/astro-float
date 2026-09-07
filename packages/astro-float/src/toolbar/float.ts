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

interface Prefs {
  side: Side;
  autosave: boolean;
}

const PREFS_KEY = "astro-float:prefs";
const AUTOSAVE_DELAY = 800;
/** How long the rail stays fully out after sliding in, before tucking (Astro's bar does the same). */
const ENTRANCE_HOLD_MS = 1400;
const HOVER_LEAVE_MS = 450;

const ENTRY_PANELS: PanelId[] = ["fields", "source"];
const PANEL_TITLES: Record<PanelId, string> = {
  fields: "Fields",
  collection: "Collection",
  source: "Source",
  settings: "Settings",
};

export function mountFloat(canvas: ShadowRoot): void {
  new Float(canvas);
}

class Float {
  private root: HTMLElement;
  private rail: HTMLElement;
  private panelHost: HTMLElement;
  private statusSlot: HTMLElement;
  private statusDot: HTMLElement;
  private saveButton: HTMLButtonElement;

  private prefs: Prefs = loadPrefs();
  /** Open panel. In-memory only: nothing re-opens on load or navigation. */
  private panel: PanelId | null = null;

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

  // rail tuck state
  private coarse = isTouchDevice();
  private entering = true;
  private hovering = false;
  private touchExpanded = false;
  private hoverTimer: number | undefined;

  private footStatus: HTMLElement | null = null;
  private footActions: HTMLElement | null = null;
  private sourceView: HTMLTextAreaElement | null = null;
  private lastSlot = "";
  private lastFoot = "";

  constructor(private canvas: ShadowRoot) {
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

    this.rail = h("nav", { class: "rail", "aria-label": "Float" });
    this.panelHost = h("div", { class: "panel-host" });
    this.root = h("div", { class: "float", "data-side": this.prefs.side, "data-coarse": this.coarse ? "" : null }, this.rail, this.panelHost);
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

    this.bindRailInteractions();
    this.bindViewport();

    // Escape inside the rail: leave the field first, then close the panel.
    this.root.addEventListener("keydown", (e) => {
      if (e.key !== "Escape") return;
      e.stopPropagation();
      const active = this.canvas.activeElement as HTMLElement | null;
      if (active && active.matches("input, textarea, select")) active.blur();
      else this.closePanel();
    });
    this.root.addEventListener("keyup", (e) => {
      if (e.key === "Escape") e.stopPropagation();
    });
    document.addEventListener("keydown", (e) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "s") {
        e.preventDefault();
        void this.save();
        return;
      }
      if (e.key === "Escape" && this.panel) this.closePanel();
    });
    // Only real unloads (tab close, hard refresh) should ever warn — Float's own
    // navigations are soft swaps and never reach here.
    window.addEventListener("beforeunload", (e) => {
      if (this.isDirty() && !this.navigating) e.preventDefault();
    });
    document.addEventListener("click", this.onDocumentClick);
    window.addEventListener("popstate", () => void this.navigate(location.href, { push: false }));

    this.renderRail();
    void this.loadPage();

    // Slide in from the edge once the initial styles have applied, hold, then tuck.
    requestAnimationFrame(() =>
      requestAnimationFrame(() => {
        this.root.dataset.entered = "";
        window.setTimeout(() => {
          this.entering = false;
          this.updateTuck();
        }, ENTRANCE_HOLD_MS);
      }),
    );
  }

  // ---- rail tuck / reveal -----------------------------------------------------------

  /**
   * Resting state is tucked (a sliver showing at the edge). Anything that means
   * "I'm using it" keeps it out: hover (fine pointers), a tap (coarse pointers),
   * an open panel, or unsaved work with autosave off.
   */
  private updateTuck() {
    const dirtyWork = this.isDirty() && !this.prefs.autosave;
    const out = this.entering || this.hovering || this.touchExpanded || this.panel !== null || dirtyWork;
    this.root.toggleAttribute("data-tucked", !out);
  }

  private bindRailInteractions() {
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
    this.rail.addEventListener("mouseenter", () => {
      if (!this.coarse) reveal();
    });
    this.rail.addEventListener("mouseleave", () => {
      if (!this.coarse) leave();
    });
    this.rail.addEventListener("focusin", reveal);
    this.rail.addEventListener("focusout", leave);

    // Coarse pointers: the first tap on a tucked rail only expands it.
    this.rail.addEventListener(
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
        // A tap on the rail's own background (not an icon) collapses it again.
        if (e.target === this.rail || (e.target as HTMLElement).classList?.contains("rail-sep")) {
          this.collapse();
        }
      },
      true,
    );

    matchMedia("(hover: none)").addEventListener("change", () => {
      this.coarse = isTouchDevice();
      this.root.toggleAttribute("data-coarse", this.coarse);
    });
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

  /** Blur whatever has the caret in the rail and undo an iOS focus-zoom if one slipped through. */
  private releaseFocus() {
    const active = this.canvas.activeElement as HTMLElement | null;
    active?.blur();
    resetViewportZoom();
  }

  // ---- page lifecycle ---------------------------------------------------------

  /** (Re)read the current URL: which entry is this, bind the body, keep the rail calm. */
  private async loadPage() {
    this.page.unbind();
    this.fields.unbind();
    this.doc = null;
    this.detected = null;
    this.draftFrontmatter = {};
    this.draftBody = "";
    this.bodyReadOnly = false;
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
    this.renderRail();
  }

  /** Attach the in-place editors to `[data-float-body]` and `[data-float-field]` on the current DOM. */
  private bindBody() {
    if (!this.doc) return;
    this.fields.bind(this.doc.frontmatter);
    this.fields.attach();

    const container = PageEditor.find();
    if (!container) {
      this.page.unbind();
      return;
    }
    this.page.bind(container, { lead: this.doc.lead, blocks: this.doc.blocks }, this.doc.absDir);
    // MDX we can't line up with the source would be written back as HTML — never do that.
    this.bodyReadOnly = this.doc.mdx && !this.page.mapped;
    if (this.bodyReadOnly) {
      this.setStatus("error", "MDX blocks didn't line up with the source — body is read-only here; fields still save");
      return;
    }
    this.page.attach();
  }

  /**
   * Soft navigation: save anything pending, fetch the next page's HTML and swap
   * it in under the rail. No unload, no "Leave site?", no rail re-animating.
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
    const path = e.composedPath();
    const insideFloat = path.includes(this.canvas.host);

    // Touch: tapping the page while the rail is out (or a panel is open) puts it away.
    if (this.coarse && !insideFloat && (this.touchExpanded || this.panel)) this.collapse();

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

  // ---- rail -------------------------------------------------------------------

  private renderRail() {
    const hasEntry = !!this.doc;
    const button = (id: PanelId, tip: string) =>
      h(
        "button",
        {
          class: "rail-btn tip",
          type: "button",
          "data-tip": ENTRY_PANELS.includes(id) && !hasEntry ? `${tip} · no entry here` : tip,
          "aria-label": tip,
          "aria-pressed": String(this.panel === id),
          disabled: ENTRY_PANELS.includes(id) && !hasEntry,
          onClick: () => this.togglePanel(id),
        },
        icon(id, 16),
      );

    replaceChildren(
      this.rail,
      button("fields", "Fields"),
      button("collection", "Collection"),
      h("span", { class: "rail-sep" }),
      button("source", "Source"),
      button("settings", "Settings"),
      this.statusSlot,
    );
    this.renderStatus();
  }

  private togglePanel(id: PanelId) {
    if (this.panel === id) this.closePanel();
    else this.showPanel(id);
  }

  private closePanel() {
    if (this.panel === null && !this.panelHost.childElementCount) return;
    this.releaseFocus();
    this.panel = null;
    this.panelHost.textContent = "";
    this.sourceView = null;
    this.footStatus = null;
    this.footActions = null;
    this.fieldInputs.clear();
    this.lastFoot = "";
    this.renderRail();
    this.updateTuck();
  }

  private showPanel(id: PanelId) {
    this.panel = id;
    this.renderPanel();
    this.renderRail();
    this.updateTuck();
  }

  // ---- panel shell --------------------------------------------------------------

  private renderPanel() {
    const id = this.panel;
    if (!id) return;
    this.footStatus = null;
    this.footActions = null;
    this.sourceView = null;
    this.fieldInputs.clear();
    this.lastFoot = "";

    const sub = this.doc ? `${this.doc.collection}/${this.doc.id}` : "no entry on this page";
    const head = h(
      "header",
      { class: "panel-head" },
      h("span", { class: "panel-title" }, PANEL_TITLES[id]),
      h("span", { class: "panel-sub", title: this.doc?.file ?? "" }, sub),
      h("button", { class: "icon-btn", type: "button", "aria-label": "Close panel", onClick: () => this.collapse() }, icon("close", 14)),
    );

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
        if (dirty) {
          text = this.prefs.autosave ? "Unsaved · autosave on" : "Unsaved changes";
          if (!this.prefs.autosave) {
            actions.push(h("button", { class: "btn btn-sm btn-primary", type: "button", onClick: () => void this.save() }, "Save"));
          }
        } else {
          text = this.savedAt ? `Saved ${formatTime(this.savedAt)}` : "Up to date";
        }
    }
    if (this.panel === "source") {
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
        { class: "setting" },
        h("div", null, h("div", { class: "label" }, "Dock"), h("div", { class: "desc" }, "Which edge the rail lives on")),
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
          h(
            "div",
            { class: "desc" },
            "⌘/Ctrl+S save · ⌘B / ⌘I / ⌘K format · Tab / ⇧Tab nest lists · type “# ”, “- ”, “1. ”, “> ”, “```” at a line start · drop or paste images into the text · click a component block to move or remove it · Esc leaves the text",
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

function loadPrefs(): Prefs {
  const defaults: Prefs = { side: "right", autosave: false };
  try {
    const stored = JSON.parse(localStorage.getItem(PREFS_KEY) ?? "{}");
    return { side: stored.side === "left" ? "left" : "right", autosave: Boolean(stored.autosave ?? defaults.autosave) };
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
