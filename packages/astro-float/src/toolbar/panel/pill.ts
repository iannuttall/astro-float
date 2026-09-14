import type { Collection, EntryDoc, Frontmatter, ValidationIssue } from "../api";
import { DatePicker } from "../datepicker";
import { h, replaceChildren } from "../dom";
import { icon } from "../icons";
import { humanize, type CollectionSchema } from "../schema";
import { refreshTooltip } from "../tooltip";
import { renderAddressRow } from "./address";
import { renderCollectionFooter, type FootState } from "./collection";
import { renderForm } from "./form";
import { resetViewportZoom } from "./util";
import { createYamlView, type YamlView } from "./yaml";

/**
 * Edit on opens nothing: the page is editable and that's all. The one piece
 * of chrome is a small round pill at the bottom right holding a dot — grey
 * when up to date, orange with unsaved changes, green for a beat after a
 * save, red on an error — with a tooltip that says the same. Clicking it
 * opens a popover above it for what can't be edited on the page: the fields
 * that aren't bound there (or the raw YAML), Discard / Save while dirty,
 * Autosave, new entries and collections.
 *
 * It owns no content state: everything it shows comes from `PillHost`, every
 * change goes back through it. Float keeps the draft, the doc and the saving.
 */
export interface PillPrefs {
  autosave: boolean;
}

export interface StatusView {
  text: string;
  /** What the pill's tooltip says when it isn't the plain text (a stale draft, a validation error). */
  tip?: string;
  tone: "" | "warn" | "err";
  dot: "idle" | "dirty" | "saving" | "saved" | "warning" | "error" | "conflict";
  showSave: boolean;
  showDiscard: boolean;
  actions: Array<{ label: string; primary?: boolean; onClick(): void }>;
}

export interface PillHost {
  canvas: ShadowRoot;
  prefs: PillPrefs;
  setAutosave(on: boolean): void;

  doc(): EntryDoc | null;
  draft(): Frontmatter;
  original(): Frontmatter;
  schema(): CollectionSchema | null;
  collections(): Collection[];
  listCollection(): string | null;
  setListCollection(name: string): void;
  /** The field is edited on the page itself (bound by attribute or found by text): the popover leaves it out. */
  onPage(key: string): boolean;
  body(): { bound: boolean; mapped: boolean; readOnly: boolean; text: string };
  /** What the last save's validation rejected, until the values change. */
  issues(): ValidationIssue[];

  setField(key: string, value: unknown): void;
  removeField(key: string): void;
  revertField(key: string): void;
  replaceDraft(next: Frontmatter): void;
  changed(key: string): boolean;
  /** Something is dirty now (YAML text typed): status and autosave should know. */
  markDirty(): void;

  save(force?: boolean): Promise<void>;
  discard(): void;
  /** Move the entry to a new address (its last id segment) and follow it; rejects with the reason when it can't. */
  rename(slug: string): Promise<void>;
  navigate(href: string, opts?: { focusBody?: boolean }): Promise<void>;
  notify(message: string): void;
}

export class Pill {
  private pillEl: HTMLButtonElement | null = null;
  private pop: HTMLElement | null = null;
  private fieldsHost: HTMLElement | null = null;
  private yamlHost: HTMLElement | null = null;
  private footHost: HTMLElement | null = null;
  private yaml: YamlView | null = null;
  private yamlMode = false;
  private yamlToggle: HTMLButtonElement | null = null;
  private foot: FootState = { open: false };
  private syncs = new Map<string, () => void>();
  private fieldsStale = true;
  private footStale = false;
  /** The page selection when the popover opened: put back on close so the caret is where it was. */
  private savedRange: Range | null = null;

  // status
  private dot: HTMLElement;
  private word: HTMLElement;
  private headActions: HTMLElement;
  private saveButton: HTMLButtonElement;
  private discardButton: HTMLButtonElement;
  private lastStatus: StatusView | null = null;
  private lastKey = "";

  constructor(
    private root: HTMLElement,
    private host: PillHost,
  ) {
    this.dot = h("span", { class: "pill-dot", "data-state": "idle" });
    this.word = h("span", { class: "pill-word", "aria-hidden": "true" }, "Saved");
    this.saveButton = h(
      "button",
      { class: "btn btn-sm btn-primary", type: "button", hidden: true, "data-tip": "Save · ⌘S", onClick: () => void this.host.save() },
      icon("check", 13),
      h("span", {}, "Save"),
    ) as HTMLButtonElement;
    this.discardButton = h(
      "button",
      { class: "btn btn-sm btn-ghost btn-discard", type: "button", hidden: true, "data-tip": "Back to what's on disk", onClick: () => this.host.discard() },
      "Discard",
    ) as HTMLButtonElement;
    this.headActions = h("div", { class: "pop-actions" }, this.discardButton, this.saveButton);
  }

  get isOpen() {
    return !!this.pop && !this.pop.hidden;
  }

  /** Build (or rebuild) the pill and its popover. Called when Edit turns on and after every page load. */
  render() {
    const host = this.host;
    const doc = host.doc();
    const wasOpen = this.isOpen;
    this.close();
    this.syncs.clear();
    this.lastKey = "";
    this.fieldsStale = true;

    // ---- the pill: a dot in a round button
    this.pillEl = h(
      "button",
      {
        class: "pill",
        type: "button",
        "aria-haspopup": "dialog",
        "aria-expanded": "false",
        "aria-label": "Float",
        "data-tip": "Up to date",
        onMousedown: keepPageSelection,
        onClick: () => (this.isOpen ? this.close() : this.open()),
      },
      this.word,
      this.dot,
    ) as HTMLButtonElement;
    this.pillEl.dataset.state = this.dot.dataset.state ?? "idle";

    // ---- the popover
    this.yamlToggle = h(
      "button",
      { class: "pop-toggle", type: "button", "aria-pressed": String(this.yamlMode), "data-tip": "Edit the frontmatter as YAML", hidden: !doc, onClick: () => this.setYamlMode(!this.yamlMode) },
      "YAML",
    ) as HTMLButtonElement;
    const head = h(
      "div",
      { class: "pop-head" },
      h("span", { class: "pop-entry" }, doc ? h("span", { class: "pop-collection" }, `${doc.collection}/`) : null, doc ? doc.id : "No entry on this page"),
      this.headActions,
      this.yamlToggle,
    );

    // The address comes first: it's where the entry lives, not one of its fields.
    const address = doc ? h("section", { class: "pop-section pop-address" }, renderAddressRow({ doc: () => host.doc(), draft: () => host.draft(), rename: (slug) => host.rename(slug) })) : null;

    this.fieldsHost = h("section", { class: "pop-section pop-fields" });
    this.yaml = createYamlView({
      draft: () => host.draft(),
      replaceDraft: (next) => host.replaceDraft(next),
      onErrorChange: (has) => this.yamlToggle?.toggleAttribute("data-error", has),
      onInput: () => host.markDirty(),
    });
    this.yamlHost = h("section", { class: "pop-section pop-yaml", hidden: true }, this.yaml.el);

    // Autosave is a row like any boolean field: same label, help line, padding and switch.
    const autosave = h(
      "button",
      {
        class: "toggle",
        type: "button",
        role: "switch",
        "aria-checked": String(host.prefs.autosave),
        "aria-label": "Autosave",
        onClick: () => {
          const next = !host.prefs.autosave;
          host.setAutosave(next);
          autosave.setAttribute("aria-checked", String(next));
        },
      },
      h("span", { class: "switch" }),
    );
    const settings = h(
      "section",
      { class: "pop-section pop-settings" },
      h(
        "div",
        { class: "row", "data-type": "boolean", "data-inline": "" },
        h(
          "div",
          { class: "row-head" },
          h("div", { class: "row-text" }, h("span", { class: "row-label" }, h("span", { class: "row-name" }, "Autosave")), h("span", { class: "row-help" }, "Writes shortly after you stop typing")),
          h("div", { class: "row-side" }, autosave),
        ),
      ),
    );

    this.footHost = h("section", { class: "pop-section pop-entries" });
    const body = h("div", { class: "pop-body" }, address, this.fieldsHost, this.yamlHost, settings, this.footHost);
    this.pop = h("div", { class: "popover", role: "dialog", "aria-label": "Entry", hidden: true }, head, body);
    this.pop.addEventListener("keydown", (e) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        this.close();
      }
    });

    replaceChildren(this.root, this.pillEl, this.pop);
    this.renderCollection();
    if (this.lastStatus) this.renderStatus(this.lastStatus);
    if (wasOpen) this.open();
  }

  /** Edit turned off: everything goes. */
  destroy() {
    this.close();
    this.pillEl = null;
    this.pop = null;
    this.fieldsHost = null;
    this.yamlHost = null;
    this.footHost = null;
    this.yaml = null;
    this.yamlToggle = null;
    this.syncs.clear();
    this.root.textContent = "";
  }

  // ---- open / close ---------------------------------------------------------------------

  open() {
    if (!this.pop || !this.pillEl || this.isOpen) return;
    const sel = document.getSelection();
    this.savedRange = sel && sel.rangeCount > 0 ? sel.getRangeAt(0).cloneRange() : null;
    this.pop.hidden = false;
    this.pillEl.setAttribute("aria-expanded", "true");
    if (this.fieldsStale) this.renderFields();
    if (this.footStale) this.renderCollection();
    if (this.yamlMode) this.yaml?.refresh();
    document.addEventListener("pointerdown", this.onDocumentPointerDown, true);
    document.addEventListener("keydown", this.onDocumentKeydown, true);
  }

  close() {
    if (!this.isOpen) return;
    DatePicker.close();
    this.yaml?.commit();
    this.pop!.hidden = true;
    this.pillEl?.setAttribute("aria-expanded", "false");
    document.removeEventListener("pointerdown", this.onDocumentPointerDown, true);
    document.removeEventListener("keydown", this.onDocumentKeydown, true);
    // Focus goes back to the page, to the caret it had.
    const active = this.host.canvas.activeElement as HTMLElement | null;
    active?.blur();
    resetViewportZoom();
    const range = this.savedRange;
    this.savedRange = null;
    if (range && range.startContainer.isConnected) {
      const editable = (range.startContainer instanceof Element ? range.startContainer : range.startContainer.parentElement)?.closest<HTMLElement>("[contenteditable]");
      editable?.focus({ preventScroll: true });
      const sel = document.getSelection();
      sel?.removeAllRanges();
      sel?.addRange(range);
    }
  }

  private onDocumentPointerDown = (e: PointerEvent) => {
    const path = e.composedPath();
    if ((this.pop && path.includes(this.pop)) || (this.pillEl && path.includes(this.pillEl))) return;
    // The calendar lives in the page; a pick there isn't a click-away.
    if (path.some((n) => n instanceof HTMLElement && n.classList.contains("astro-float-datepicker"))) return;
    this.close();
  };

  private onDocumentKeydown = (e: KeyboardEvent) => {
    if (e.key !== "Escape") return;
    // A control that handles Escape itself (the Address input puts the id back) keeps the popover open.
    if (e.composedPath().some((n) => n instanceof HTMLElement && n.dataset.escape === "self")) return;
    if (!DatePicker.isOpenFor(document.body)) {
      e.stopPropagation();
      this.close();
    }
  };

  // ---- views ------------------------------------------------------------------------------

  private setYamlMode(on: boolean) {
    if (on === this.yamlMode) return;
    if (!on) this.yaml?.commit();
    this.yamlMode = on;
    this.yamlToggle?.setAttribute("aria-pressed", String(on));
    this.yamlToggle?.setAttribute("data-tip", on ? "Back to the form" : "Edit the frontmatter as YAML");
    refreshTooltip(this.yamlToggle ?? undefined);
    if (this.yamlHost) this.yamlHost.hidden = !on;
    if (this.fieldsHost) this.fieldsHost.hidden = on;
    if (on) this.yaml?.refresh();
    else this.renderFields();
  }

  /** Rebuild the Fields section from the draft: only the fields that aren't edited on the page. */
  renderFields() {
    if (!this.fieldsHost) return;
    if (this.pop?.hidden) {
      this.fieldsStale = true;
      return;
    }
    this.fieldsStale = false;
    const doc = this.host.doc();
    if (!doc) {
      replaceChildren(
        this.fieldsHost,
        h("p", { class: "empty" }, "Open an entry to edit it. If Float can't detect one from the URL, bind the page with ", h("code", null, 'data-float-entry="blog:my-post"'), "."),
      );
      this.fieldsHost.hidden = this.yamlMode;
      return;
    }
    const body = this.host.body();
    const note = !body.bound && !body.readOnly ? h("p", { class: "form-note" }, `No editable body found on this page (${doc.file}). The fields still save.`) : null;
    const form = renderForm(
      {
        canvas: this.host.canvas,
        doc: () => this.host.doc(),
        schema: () => this.host.schema(),
        draft: () => this.host.draft(),
        original: () => this.host.original(),
        onPage: (key) => this.host.onPage(key),
        omit: (key) => this.host.onPage(key),
        collections: () => this.host.collections(),
        setField: (key, value) => this.host.setField(key, value),
        removeField: (key) => this.host.removeField(key),
        revertField: (key) => this.host.revertField(key),
        changed: (key) => this.host.changed(key),
      },
      this.syncs,
    );
    const hasRows = !!form.querySelector(".row");
    // Validation messages sit under their field; the body's, or a field that isn't in the form, at the top.
    const loose: string[] = [];
    for (const issue of this.host.issues()) {
      const key = issueKey(issue);
      const row = key ? form.querySelector<HTMLElement>(`.row[data-key="${CSS.escape(key)}"]`) : null;
      if (row) row.appendChild(h("div", { class: "row-error" }, issue.message));
      else loose.push(key ? `${this.labelFor(key)}: ${issue.message}` : issue.message);
    }
    const errors = loose.length ? h("div", { class: "form-errors" }, loose.map((m) => h("p", { class: "form-error-line" }, m))) : null;
    replaceChildren(this.fieldsHost, note, errors, hasRows ? form : null);
    this.fieldsHost.hidden = this.yamlMode || (!note && !hasRows && !errors);
  }

  private labelFor(key: string) {
    if (key === "body") return "Body";
    return this.host.schema()?.fields.find((f) => f.key === key)?.label ?? humanize(key);
  }

  /** One field changed outside the form (typed on the page, set in place): mirror it, and let the YAML text follow. */
  syncField(key: string) {
    this.syncs.get(key)?.();
    this.yaml?.sync();
  }

  /** The whole draft changed (discard, revert): repaint everything that shows it; broken YAML text is dropped. */
  syncAll() {
    if (this.isOpen && !this.yamlMode) this.renderFields();
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
    // A save refreshes the entries in the background: never pull a form (New entry, New collection) out from under the user.
    if (this.isOpen && this.footHost.querySelector(".card")) {
      this.footStale = true;
      return;
    }
    this.footStale = false;
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
          releaseFocus: () => (this.host.canvas.activeElement as HTMLElement | null)?.blur(),
        },
        this.foot,
        () => this.renderCollection(),
      ),
    );
  }

  // ---- status -----------------------------------------------------------------------------------

  /** The dot's colour and the pill's tooltip; Discard / Save and any Reload / Overwrite / Retry in the popover header. */
  renderStatus(view: StatusView) {
    this.lastStatus = view;
    const key = `${view.showSave}|${view.showDiscard}|${view.dot}|${view.text}|${view.actions.map((a) => a.label).join(",")}`;
    if (key === this.lastKey) return;
    this.lastKey = key;
    this.dot.dataset.state = view.dot;
    // Green says "Saved" next to the dot, growing leftwards from the pill's fixed right edge; grey and orange stay dot-only.
    if (this.pillEl) this.pillEl.dataset.state = view.dot;
    const tip = view.tip ?? (view.dot === "dirty" ? "Unsaved changes · ⌘S to save" : view.text || (this.host.doc() ? "Up to date" : "Float"));
    if (this.pillEl) {
      this.pillEl.setAttribute("data-tip", tip);
      this.pillEl.setAttribute("aria-label", tip);
      refreshTooltip(this.pillEl);
    }
    this.saveButton.hidden = !view.showSave;
    this.discardButton.hidden = !view.showDiscard;
    replaceChildren(
      this.headActions,
      ...view.actions.map((a) => h("button", { class: `btn btn-sm${a.primary ? " btn-primary" : ""}`, type: "button", onClick: () => a.onClick() }, a.label)),
      this.discardButton,
      this.saveButton,
    );
  }
}

/** The field an issue is about: the first segment of its path ("body" for the body). */
export function issueKey(issue: ValidationIssue): string | null {
  const first = Array.isArray(issue.path) ? issue.path[0] : String(issue.path ?? "").split(".")[0];
  return first === undefined || first === "" ? null : String(first);
}

/** A click on the pill must not move the caret or drop the page's selection. */
function keepPageSelection(e: MouseEvent) {
  e.preventDefault();
}
