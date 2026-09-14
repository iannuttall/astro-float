import { altFromName, embedFor, mediaKind, videoHtml } from "./embeds";
import { blockToMarkdown, type SerializeContext } from "./html-to-md";
import { icon, type IconName } from "./icons";
import { SelectionBubble } from "./overlays";

export interface SourceBlock {
  type: string;
  src: string;
  trailer: string;
  island?: boolean;
}

export interface BodySource {
  lead: string;
  blocks: SourceBlock[];
}

export interface SaveSnapshot {
  markdown: string;
  html: string;
  keys: string[];
}

export interface PageEditorHooks {
  /** Any DOM change inside the editable body (already debounced to a microtask). */
  onChange(): void;
  /** Image / video files dropped or pasted onto the body; `range` is where they landed. */
  onFiles(files: File[], range: Range | null): void;
}

const PAGE_STYLE_ID = "astro-float-page-style";
const ISLAND_DRAG_TYPE = "text/x-astro-float-island";
const ISLAND_SELECTOR = "astro-island, iframe, video, [data-float-island]";

const PAGE_STYLE = /* css */ `
/*
 * One convention for "you can edit this": a quiet grey wash on hover, a
 * lighter one while you're in it. Same treatment for the title, the
 * description, the body and any other bound field. The wash is a pseudo-element
 * painted *behind* the text, a little larger than the box — it takes part in no
 * layout at all, so attaching, hovering or focusing never moves a pixel.
 */
[data-float-editing], [data-float-editing-field] {
  position: relative;
  z-index: 0;
  outline: none;
  caret-color: currentColor;
}
[data-float-editing]::after, [data-float-editing-field]::after {
  content: "";
  position: absolute;
  z-index: -1;
  inset: -6px -10px;
  border-radius: 6px;
  background-color: transparent;
  pointer-events: none;
  transition: background-color 120ms ease;
}
[data-float-editing]::after { inset: -14px -18px; }
[data-float-editing]:hover::after, [data-float-editing][data-float-hover]::after, [data-float-editing-field]:hover::after { background-color: color-mix(in srgb, currentColor 4.5%, transparent); }
[data-float-editing]:focus::after, [data-float-editing-field]:focus::after { background-color: color-mix(in srgb, currentColor 2.5%, transparent); }
[data-float-editing][data-float-dragging]::after { background-color: color-mix(in srgb, currentColor 7%, transparent); }
[data-float-editing] a { cursor: text; }
[data-float-editing] img { cursor: default; }

/* In-page source view for the body (toolbar/source.ts): a wrapper with the prose box's exact geometry —
 * same wash, same corner-control position — holding a highlighted mirror under a transparent textarea. */
.astro-float-source {
  position: relative;
  z-index: 0;
  display: block;
  color: inherit;
}
.astro-float-source::after {
  content: "";
  position: absolute;
  z-index: -1;
  inset: -14px -18px;
  border-radius: 6px;
  background-color: transparent;
  pointer-events: none;
  transition: background-color 120ms ease;
}
.astro-float-source:hover::after, .astro-float-source[data-float-hover]::after { background-color: color-mix(in srgb, currentColor 4.5%, transparent); }
.astro-float-source:focus-within::after { background-color: color-mix(in srgb, currentColor 2.5%, transparent); }
.astro-float-src-mirror, .astro-float-src-area {
  display: block;
  margin: 0;
  border: 0;
  width: 100%;
  min-width: 0;
  box-sizing: border-box;
  font: inherit;
  tab-size: 2;
  white-space: pre-wrap;
  overflow-wrap: break-word;
  word-break: normal;
  hyphens: manual;
  text-align: left;
}
.astro-float-src-mirror { position: relative; color: inherit; pointer-events: none; user-select: none; -webkit-user-select: none; overflow: visible; }
.astro-float-src-area {
  position: absolute;
  inset: 0;
  height: 100%;
  z-index: 1;
  background: transparent;
  color: transparent;
  caret-color: #111; /* overridden inline with the prose colour when the view opens */
  resize: none;
  outline: none;
  overflow: hidden;
  -webkit-text-fill-color: transparent;
}
.astro-float-src-area::selection { background: color-mix(in srgb, currentColor 16%, transparent); }
.astro-float-src-mirror .ln { display: block; }
.astro-float-src-mirror .md-mark, .astro-float-src-mirror .md-hash, .astro-float-src-mirror .md-hr, .astro-float-src-mirror .md-url { color: color-mix(in srgb, currentColor 38%, transparent); }
/* Nothing in the mirror may change a glyph's advance width: the caret in the textarea must land on the
 * glyph it belongs to. So bold is a stroke, not a heavier face; italic is a synthesized slant; the # markers
 * stay in flow; code keeps the text font and gets only a faint ground. */
.astro-float-src-mirror .md-h, .astro-float-src-mirror .md-strong { -webkit-text-stroke: 0.5px currentColor; }
.astro-float-src-mirror .md-hash { -webkit-text-stroke: 0; }
.astro-float-src-mirror .md-em { color: color-mix(in srgb, currentColor 72%, transparent); } /* a slant, even synthesized, moves glyphs: italic is a shade, not a shape */
.astro-float-src-mirror .md-link { text-decoration: underline; text-decoration-color: color-mix(in srgb, currentColor 30%, transparent); text-underline-offset: 3px; }
.astro-float-src-mirror .md-code { background: color-mix(in srgb, currentColor 6%, transparent); border-radius: 3px; }
.astro-float-src-mirror .md-codeline { background: color-mix(in srgb, currentColor 5%, transparent); }
.astro-float-src-mirror .md-quote { position: relative; color: color-mix(in srgb, currentColor 70%, transparent); }
.astro-float-src-mirror .md-quote::before { content: ""; position: absolute; left: -12px; top: 3px; bottom: 3px; width: 2px; border-radius: 1px; background: color-mix(in srgb, currentColor 22%, transparent); }

/* Body control: copy / source inside the top-right corner of the body's wash. Part of the wash —
 * no pill, no shadow, no border. Two icon-only buttons that never change size or place; the
 * tooltip says what they do. Hover: the icon darkens and a faint rounded background appears. */
.astro-float-region {
  position: fixed;
  z-index: 1999999999;
  display: flex;
  align-items: center;
  gap: 2px;
  padding: 2px;
  border-radius: 8px;
  color: color-mix(in srgb, currentColor 70%, transparent);
  box-sizing: border-box;
  opacity: 0;
  visibility: hidden;
  pointer-events: none;
  transition: opacity 120ms ease, visibility 0s linear 120ms;
}
.astro-float-region[data-show] { opacity: 1; visibility: visible; pointer-events: auto; transition: opacity 120ms ease; }
.astro-float-region button {
  all: unset;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  border-radius: 6px;
  color: inherit;
  opacity: 0.65;
  cursor: pointer;
  box-sizing: border-box;
  transition: background 100ms ease, opacity 100ms ease;
}
.astro-float-region button svg { width: 14px; height: 14px; display: block; }
.astro-float-region button:hover, .astro-float-region button:focus-visible { opacity: 1; background: color-mix(in srgb, currentColor 6%, transparent); }
.astro-float-region button[data-on] { opacity: 1; }
.astro-float-region button:disabled { opacity: 0.4; cursor: default; background: none; }
.astro-float-region button[data-danger] { width: auto; padding: 0 8px; opacity: 1; color: #ef6f6c; font: 500 12px/1 -apple-system, BlinkMacSystemFont, "Inter", "Segoe UI", system-ui, sans-serif; }
.astro-float-region-error { display: inline-flex; align-items: center; gap: 5px; padding: 0 4px 0 8px; color: #ef6f6c; white-space: nowrap; font: 12px/1 -apple-system, BlinkMacSystemFont, "Inter", "Segoe UI", system-ui, sans-serif; }

/* The tooltip: one instance for everything Float draws (see toolbar/tooltip.ts). Dark on a light
 * site, light on a dark one; above the trigger, below when there's no room; never in the way. */
.astro-float-tip {
  position: fixed;
  z-index: 2000000003;
  max-width: 280px;
  padding: 6px 10px;
  border-radius: 6px;
  background: #1c1f24;
  color: #fff;
  font: 500 12px/1.35 -apple-system, BlinkMacSystemFont, "Inter", "Segoe UI", system-ui, sans-serif;
  letter-spacing: -0.005em;
  -webkit-font-smoothing: antialiased;
  text-align: center;
  box-sizing: border-box;
  pointer-events: none;
  opacity: 0;
  transform: translateY(2px);
  transition: opacity 120ms ease, transform 120ms ease;
}
.astro-float-tip[data-below] { transform: translateY(-2px); }
.astro-float-tip[data-show] { opacity: 1; transform: none; }
:root[data-float-theme="dark"] .astro-float-tip { background: #f2f3f5; color: #1b1f26; }

/* Islands: rendered components / raw HTML. Atomic — no caret, move or remove only. */
[data-float-editing] [data-float-island] { cursor: default; user-select: none; -webkit-user-select: none; }
[data-float-editing] [data-float-island] * { cursor: default; }
/* An iframe swallows clicks; while editing, a click on an embed must select its island (the wrapper) instead. */
[data-float-editing] [data-float-island] iframe { pointer-events: none; }

/* Frontmatter fields edited in place (title, description, date, …). */
[data-float-editing-field]:empty::before { content: attr(data-float-placeholder); color: color-mix(in srgb, currentColor 35%, transparent); pointer-events: none; }
[data-float-editing-field][data-float-date] { cursor: pointer; }
[data-float-editing-field][data-float-date][data-float-open]::after { background-color: color-mix(in srgb, currentColor 4.5%, transparent); }
[data-float-editing-field][data-float-enum] { cursor: pointer; }
[data-float-editing-field][data-float-invalid] { text-decoration: underline wavy color-mix(in srgb, #d4423e 70%, transparent); text-underline-offset: 3px; }

/* Tags on the page: each chip takes a caret (a smaller wash than a field); a quiet "+" chip after
 * the last one adds a tag. Both keep the page's own chip styling. */
[data-float-chip], [data-float-add] { position: relative; z-index: 0; outline: none; caret-color: currentColor; }
[data-float-chip]::after, [data-float-add]::after {
  content: "";
  position: absolute;
  z-index: -1;
  inset: -3px -5px;
  border-radius: 4px;
  background-color: transparent;
  pointer-events: none;
  transition: background-color 120ms ease;
}
[data-float-chip]:hover::after, [data-float-add]:hover::after { background-color: color-mix(in srgb, currentColor 6%, transparent); }
[data-float-chip]:focus::after, [data-float-add]:focus::after { background-color: color-mix(in srgb, currentColor 3.5%, transparent); }
[data-float-add] { opacity: 0.55; cursor: pointer; user-select: none; -webkit-user-select: none; }
[data-float-add]:hover, [data-float-add][data-float-adding] { opacity: 1; }
[data-float-add][data-float-adding] { cursor: text; user-select: auto; -webkit-user-select: auto; min-width: 2ch; }

/* Inline menu for an enum printed on the page: the options, current one marked. */
.astro-float-menu {
  position: fixed;
  z-index: 2000000002;
  min-width: 120px;
  padding: 4px;
  background: var(--dp-bg);
  border: 1px solid var(--dp-line);
  border-radius: 8px;
  box-shadow: var(--dp-shadow);
  color: var(--dp-fg);
  font: 12px/1 -apple-system, BlinkMacSystemFont, "Inter", "Segoe UI", system-ui, sans-serif;
  letter-spacing: -0.005em;
  -webkit-font-smoothing: antialiased;
  box-sizing: border-box;
  animation: astro-float-dp-in 120ms ease;
}
.astro-float-menu button { all: unset; display: block; width: 100%; padding: 7px 8px; border-radius: 4px; cursor: pointer; box-sizing: border-box; color: var(--dp-fg); font: inherit; }
.astro-float-menu button:hover, .astro-float-menu button:focus-visible { background: var(--dp-hover); }
.astro-float-menu button[data-on] { font-weight: 500; }

/* Page-side chrome (calendar, selection bubble, island bar) shares one palette
 * and follows the panel: light by default, dark when the viewer prefers it. */
.astro-float-datepicker, .astro-float-bubble, .astro-float-bar, .astro-float-menu {
  --dp-bg: #ffffff;
  --dp-input: #ffffff;
  --dp-line: #d8dce3;
  --dp-line-focus: #9aa1ad;
  --dp-fg: #1b1f26;
  --dp-muted: #6b7280;
  --dp-faint: #9aa1ad;
  --dp-hover: #f1f2f5;
  --dp-accent: #1b1f26;
  --dp-accent-fg: #ffffff;
  --dp-err: #d4423e;
  --dp-err-fg: #ffffff;
  --dp-shadow: 0 1px 2px rgba(16, 20, 28, 0.06), 0 12px 32px -12px rgba(16, 20, 28, 0.3);
}
@media (prefers-color-scheme: dark) {
  .astro-float-datepicker, .astro-float-bubble, .astro-float-bar, .astro-float-menu {
    --dp-bg: #15181c;
    --dp-input: #0b0d10;
    --dp-line: #2a3038;
    --dp-line-focus: #4a5260;
    --dp-fg: #e6e8eb;
    --dp-muted: #8b93a1;
    --dp-faint: #5c6470;
    --dp-hover: #22262c;
    --dp-accent: #e6e8eb;
    --dp-accent-fg: #0f1114;
    --dp-err: #ef6f6c;
    --dp-err-fg: #0f1114;
    --dp-shadow: 0 1px 2px rgba(0, 0, 0, 0.2), 0 12px 32px -12px rgba(0, 0, 0, 0.5);
  }
}

/* Calendar popover, shared by the date on the page and the panel's date control. */
.astro-float-datepicker {
  position: fixed;
  z-index: 2000000002;
  width: 244px;
  padding: 8px;
  background: var(--dp-bg);
  border: 1px solid var(--dp-line);
  border-radius: 8px;
  box-shadow: var(--dp-shadow);
  color: var(--dp-fg);
  font: 12px/1 -apple-system, BlinkMacSystemFont, "Inter", "Segoe UI", system-ui, sans-serif;
  letter-spacing: -0.005em;
  -webkit-font-smoothing: antialiased;
  box-sizing: border-box;
  animation: astro-float-dp-in 120ms ease;
  user-select: none;
  -webkit-user-select: none;
}
:root[data-float-theme="dark"] .astro-float-datepicker {
    --dp-bg: #15181c;
    --dp-line: #2a3038;
    --dp-fg: #e6e8eb;
    --dp-muted: #8b93a1;
    --dp-faint: #5c6470;
    --dp-hover: #22262c;
    --dp-accent: #e6e8eb;
    --dp-accent-fg: #0f1114;
    --dp-shadow: 0 1px 2px rgba(0, 0, 0, 0.2), 0 12px 32px -12px rgba(0, 0, 0, 0.5);
}
@keyframes astro-float-dp-in { from { opacity: 0; transform: translateY(-2px); } }
.astro-float-datepicker[data-above] { animation-name: astro-float-dp-in-up; }
@keyframes astro-float-dp-in-up { from { opacity: 0; transform: translateY(2px); } }
.astro-float-datepicker button {
  all: unset;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  box-sizing: border-box;
  border-radius: 4px;
  color: var(--dp-muted);
  cursor: pointer;
  font: inherit;
  transition: background 100ms ease, color 100ms ease;
}
.astro-float-datepicker button:hover { background: var(--dp-hover); color: var(--dp-fg); }
.astro-float-datepicker button:focus-visible { outline: 1px solid var(--dp-faint); outline-offset: -1px; }
.astro-float-dp-head { display: flex; align-items: center; justify-content: space-between; gap: 4px; height: 28px; margin-bottom: 6px; }
.astro-float-dp-head button { width: 26px; height: 26px; }
.astro-float-dp-head button svg { width: 14px; height: 14px; display: block; }
.astro-float-dp-label { flex: 1; text-align: center; font-weight: 500; color: var(--dp-fg); }
.astro-float-dp-weekdays, .astro-float-dp-grid { display: grid; grid-template-columns: repeat(7, 1fr); gap: 2px; }
.astro-float-dp-weekdays span { height: 22px; display: grid; place-items: center; font-size: 10.5px; color: var(--dp-faint); }
.astro-float-dp-grid button { height: 30px; font-size: 12px; font-variant-numeric: tabular-nums; position: relative; color: var(--dp-fg); }
.astro-float-dp-grid button[data-outside] { color: var(--dp-faint); }
.astro-float-dp-grid button[data-today]::after { content: ""; position: absolute; left: 50%; bottom: 4px; width: 3px; height: 3px; border-radius: 999px; background: currentColor; transform: translateX(-50%); }
.astro-float-dp-grid button[data-selected] { background: var(--dp-accent); color: var(--dp-accent-fg); font-weight: 500; }
.astro-float-dp-grid button[data-selected]:hover { background: var(--dp-accent); color: var(--dp-accent-fg); opacity: 0.9; }
.astro-float-dp-foot { display: flex; justify-content: flex-end; margin-top: 6px; padding-top: 6px; border-top: 1px solid var(--dp-line); }
.astro-float-dp-foot button { height: 24px; padding: 0 8px; font-size: 11.5px; color: var(--dp-muted); }

/* Overlays live in the page, never inside the editable body. */
.astro-float-frame, .astro-float-dropline { position: fixed; z-index: 1999999999; pointer-events: none; box-sizing: border-box; }
.astro-float-frame { border: 1px solid color-mix(in srgb, currentColor 30%, transparent); border-radius: 6px; }
.astro-float-frame[data-selected] { border-color: color-mix(in srgb, currentColor 60%, transparent); }
.astro-float-dropline { height: 2px; background: #8b93a1; border-radius: 1px; }

/* Selection bubble and island bar: one quiet pill on the shared palette, one icon set. They stack
 * *below* the panel (2000000000): when a narrow window puts the prose's edge under the panel, the
 * pill is covered by it, never painted over it. The date picker is the one exception — it's a dialog
 * opened from either side, so it stays on top. */
.astro-float-bubble, .astro-float-bar {
  position: fixed;
  z-index: 1999999999;
  display: flex;
  align-items: center;
  gap: 1px;
  padding: 2px;
  background: var(--dp-bg);
  border: 1px solid var(--dp-line);
  border-radius: 6px;
  box-shadow: var(--dp-shadow);
  color: var(--dp-muted);
  font: 12px/1 -apple-system, BlinkMacSystemFont, "Inter", "Segoe UI", system-ui, sans-serif;
  letter-spacing: -0.005em;
  box-sizing: border-box;
  -webkit-font-smoothing: antialiased;
}
.astro-float-bubble[hidden], .astro-float-bar[hidden] { display: none; }
.astro-float-bubble button, .astro-float-bar button {
  all: unset;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  height: 24px;
  min-width: 24px;
  padding: 0 5px;
  border-radius: 4px;
  color: var(--dp-muted);
  cursor: pointer;
  font: inherit;
  font-weight: 500;
  box-sizing: border-box;
  transition: background 100ms ease, color 100ms ease;
}
.astro-float-bubble button svg, .astro-float-bar button svg { width: 14px; height: 14px; display: block; }
.astro-float-bubble button:hover, .astro-float-bar button:hover { background: var(--dp-hover); color: var(--dp-fg); }
.astro-float-bar button:disabled { opacity: 0.4; cursor: default; background: none; }
.astro-float-bubble button[data-on] { color: var(--dp-fg); background: var(--dp-hover); }
.astro-float-bar button[data-danger]:hover { color: var(--dp-err); }
.astro-float-bubble input {
  all: unset;
  width: 220px;
  height: 24px;
  padding: 0 8px;
  border-radius: 4px;
  background: var(--dp-input);
  border: 1px solid var(--dp-line);
  color: var(--dp-fg);
  font: 12px/1 -apple-system, BlinkMacSystemFont, "Inter", "Segoe UI", system-ui, sans-serif;
  box-sizing: border-box;
}
.astro-float-bubble input:focus { border-color: var(--dp-line-focus); }
.astro-float-bubble input::placeholder { color: var(--dp-faint); }
.astro-float-bubble::after {
  content: "";
  position: absolute;
  left: 50%;
  bottom: -5px;
  transform: translateX(-50%);
  border: 4px solid transparent;
  border-bottom: 0;
  border-top-color: var(--dp-line);
}
.astro-float-bubble[data-below]::after { top: -5px; bottom: auto; border-top: 0; border-bottom: 4px solid var(--dp-line); }
.astro-float-bar button[data-grip] { cursor: grab; }
.astro-float-bar .astro-float-sep, .astro-float-bubble .astro-float-sep { width: 1px; height: 16px; background: var(--dp-line); margin: 0 2px; flex: none; }
.astro-float-bar .astro-float-confirm { display: flex; align-items: center; gap: 6px; padding: 0 4px 0 8px; white-space: nowrap; }
.astro-float-bar .astro-float-confirm button { width: auto; height: 24px; padding: 0 9px; }
.astro-float-bar .astro-float-confirm button[data-danger] { background: var(--dp-err); color: var(--dp-err-fg); }
.astro-float-bar .astro-float-confirm button[data-danger]:hover { background: var(--dp-err); color: var(--dp-err-fg); opacity: 0.9; }
@media (pointer: coarse) {
  .astro-float-bubble button, .astro-float-bar button, .astro-float-region button { height: 36px; min-width: 36px; }
  .astro-float-bubble, .astro-float-bar { padding: 3px; }
  .astro-float-datepicker { width: 300px; }
  .astro-float-dp-grid button { height: 38px; font-size: 14px; }
  .astro-float-dp-head button { width: 34px; height: 34px; }
  .astro-float-dp-foot button { height: 34px; font-size: 13px; }
  .astro-float-bubble input { height: 36px; font-size: 16px; }
  .astro-float-bar .astro-float-confirm button { height: 34px; }
}
`;

/** Page-side styles (wash, islands, overlays) live for the whole edit session, not just while the body is attached. */
export function ensurePageStyle() {
  if (document.getElementById(PAGE_STYLE_ID)) return;
  const style = document.createElement("style");
  style.id = PAGE_STYLE_ID;
  style.textContent = PAGE_STYLE;
  document.head.appendChild(style);
}

export function removePageStyle() {
  document.getElementById(PAGE_STYLE_ID)?.remove();
}

/**
 * Makes the rendered Markdown body editable in place and turns it back into
 * Markdown on demand.
 *
 * Fidelity strategy: the body's top-level DOM children are lined up with the
 * top-level source blocks the server parsed. On serialize, blocks whose HTML is
 * unchanged emit their original Markdown verbatim; only changed/new blocks go
 * through the HTML→Markdown serializer. If the two sides don't line up (raw
 * HTML blocks, footnotes, custom remark plugins) we fall back to serializing
 * everything and say so.
 *
 * Islands (MDX components, raw HTML) are matched by identity rather than by
 * HTML, so they can be reordered or removed and still write back their source.
 */
export class PageEditor {
  container: HTMLElement | null = null;
  mapped = false;

  private source: BodySource = { lead: "", blocks: [] };
  private snapshot: Array<{ key: string; block: SourceBlock }> = [];
  private baselineHTML = "";
  /** Block keys at the last clean state; islands count by key, so a widget script redrawing inside one is not an edit. */
  private baselineKeys = "";
  private absDir = "";
  private attached = false;
  private observer: MutationObserver | null = null;
  private changeQueued = false;
  private dragDepth = 0;
  private keyCounter = 0;
  /** Raw-HTML islands inserted this session (video, embeds), by key: written back verbatim until the server has them. */
  private pendingSource = new Map<string, string>();

  // islands
  private selected: HTMLElement | null = null;
  private hovered: HTMLElement | null = null;
  private dragging: HTMLElement | null = null;
  private dropTarget: { block: HTMLElement; before: boolean } | null = null;
  private frame: HTMLElement | null = null;
  private bar: HTMLElement | null = null;
  private dropLine: HTMLElement | null = null;
  private confirming = false;
  private bubble: SelectionBubble | null = null;

  constructor(private hooks: PageEditorHooks) {}

  get bound() {
    return this.container !== null;
  }

  static find(): HTMLElement | null {
    return document.querySelector<HTMLElement>("[data-float-body]");
  }

  // ---- lifecycle --------------------------------------------------------------

  /** Point the editor at a container and take a fresh clean baseline. */
  bind(container: HTMLElement, source: BodySource, absDir: string) {
    if (this.attached) this.detach();
    this.container = container;
    this.absDir = absDir.replace(/\/$/, "");
    // Astro's dev toolbar strips these dev-only annotations a beat after load;
    // do it first so the clean baseline can't be invalidated by it.
    for (const el of Array.from(container.querySelectorAll("[data-astro-source-file], [data-astro-source-loc]"))) {
      el.removeAttribute("data-astro-source-file");
      el.removeAttribute("data-astro-source-loc");
    }
    this.pendingSource.clear();
    this.decorateIslands(source);
    this.setBaseline(source);
  }

  /** Fresh clean baseline from the DOM as it is right now. */
  setBaseline(source: BodySource) {
    this.commit(this.snapshotForSave(), source);
  }

  /**
   * What a save should write, plus the DOM state it was derived from. Kept
   * separate from `commit` so keystrokes that land while the request is in
   * flight still count as unsaved afterwards.
   */
  snapshotForSave(): SaveSnapshot {
    return {
      markdown: this.toMarkdown(),
      html: this.container?.innerHTML ?? "",
      keys: this.blockKeys(),
    };
  }

  /** One key per block that writes something: blank paragraphs (the caret's parking spots) emit no Markdown and get no key. */
  private blockKeys(): string[] {
    return this.domBlocks().filter((n) => !isBlankParagraph(n)).map((n) => keyOf(n));
  }

  /** Make a snapshot the new source of truth (call after the server confirmed it). */
  commit(snapshot: SaveSnapshot, source: BodySource) {
    if (!this.container) return;
    this.source = source;
    this.baselineHTML = snapshot.html;
    this.baselineKeys = snapshot.keys.join("\n");
    this.mapped = snapshot.keys.length === source.blocks.length;
    this.snapshot = this.mapped ? snapshot.keys.map((key, i) => ({ key, block: source.blocks[i] })) : [];
  }

  attach() {
    const el = this.container;
    if (!el || this.attached) return;
    this.attached = true;

    ensurePageStyle();
    if (!el.children.length) el.appendChild(emptyParagraph());
    el.contentEditable = "true";
    el.setAttribute("data-float-editing", "");
    try {
      document.execCommand("defaultParagraphSeparator", false, "p");
    } catch {
      /* not supported */
    }
    this.bubble = new SelectionBubble(
      () => this.container,
      () => this.attached && !this.selected,
      (level) => this.setHeading(level),
    );

    el.addEventListener("keydown", this.onKeydown);
    el.addEventListener("keyup", this.onKeyup);
    el.addEventListener("paste", this.onPaste);
    el.addEventListener("click", this.onClick);
    el.addEventListener("mouseover", this.onMouseOver);
    el.addEventListener("mouseleave", this.onMouseLeave);
    el.addEventListener("dragstart", this.onDragStart);
    el.addEventListener("dragenter", this.onDragEnter);
    el.addEventListener("dragover", this.onDragOver);
    el.addEventListener("dragleave", this.onDragLeave);
    el.addEventListener("drop", this.onDrop);
    el.addEventListener("dragend", this.onDragEnd);
    document.addEventListener("click", this.onDocumentClick, true);
    document.addEventListener("keydown", this.onDocumentKeydown);
    window.addEventListener("scroll", this.reposition, true);
    window.addEventListener("resize", this.reposition);

    this.observer = new MutationObserver(() => this.queueChange());
    this.observer.observe(el, { childList: true, characterData: true, subtree: true, attributes: true });
  }

  /** Stop editing but keep the DOM (and dirty state) exactly as it is. */
  detach() {
    const el = this.container;
    if (!el || !this.attached) return;
    this.attached = false;
    this.bubble?.dispose();
    this.bubble = null;
    el.contentEditable = "false";
    el.removeAttribute("contenteditable");
    el.removeAttribute("data-float-editing");
    el.removeAttribute("data-float-dragging");
    el.removeEventListener("keydown", this.onKeydown);
    el.removeEventListener("keyup", this.onKeyup);
    el.removeEventListener("paste", this.onPaste);
    el.removeEventListener("click", this.onClick);
    el.removeEventListener("mouseover", this.onMouseOver);
    el.removeEventListener("mouseleave", this.onMouseLeave);
    el.removeEventListener("dragstart", this.onDragStart);
    el.removeEventListener("dragenter", this.onDragEnter);
    el.removeEventListener("dragover", this.onDragOver);
    el.removeEventListener("dragleave", this.onDragLeave);
    el.removeEventListener("drop", this.onDrop);
    el.removeEventListener("dragend", this.onDragEnd);
    document.removeEventListener("click", this.onDocumentClick, true);
    document.removeEventListener("keydown", this.onDocumentKeydown);
    window.removeEventListener("scroll", this.reposition, true);
    window.removeEventListener("resize", this.reposition);
    this.observer?.disconnect();
    this.observer = null;
    this.select(null);
    this.hovered = null;
    this.hideOverlays();
  }

  /** Let go of the container and take back everything `bind` put on its islands. */
  unbind() {
    this.detach();
    for (const node of Array.from(this.container?.querySelectorAll<HTMLElement>("[data-float-island]") ?? [])) {
      node.removeAttribute("data-float-island");
      node.removeAttribute("data-float-key");
      node.removeAttribute("contenteditable");
      node.removeAttribute("draggable");
    }
    this.container = null;
    this.snapshot = [];
    this.mapped = false;
  }

  // ---- state ---------------------------------------------------------------------

  isDirty() {
    return this.container ? this.blockKeys().join("\n") !== this.baselineKeys : false;
  }

  /** Throw away every unsaved edit: the DOM goes back to the last clean baseline. Listeners are delegated, so nothing else to redo. */
  restoreBaseline() {
    if (!this.container) return;
    this.select(null);
    if (this.isDirty()) this.container.innerHTML = this.baselineHTML;
  }

  /** Where the live DOM first departs from the clean baseline (for bug reports). */
  debugDiff(): string | null {
    if (!this.container) return null;
    const a = this.baselineHTML;
    const b = this.container.innerHTML;
    if (a === b) return null;
    let i = 0;
    while (i < a.length && a[i] === b[i]) i++;
    return `@${i}\n  baseline: ${JSON.stringify(a.slice(Math.max(0, i - 40), i + 80))}\n  now:      ${JSON.stringify(b.slice(Math.max(0, i - 40), i + 80))}`;
  }

  /** Focus the body with the first block selected — a fresh entry's placeholder gets replaced by whatever you type. */
  focusStart() {
    const el = this.container;
    if (!el) return;
    el.focus();
    const first = el.firstElementChild ?? el;
    const range = document.createRange();
    range.selectNodeContents(first);
    const sel = document.getSelection();
    sel?.removeAllRanges();
    sel?.addRange(range);
  }

  /** True while the caret lives in the body (focus, not just a lingering selection). */
  hasFocus() {
    const el = this.container;
    if (!el) return false;
    return document.activeElement === el || el.contains(document.activeElement);
  }

  /**
   * Turn the block under the selection into an h1–h3, or back into a paragraph
   * when it already is that heading. Only plain blocks convert (paragraphs and
   * headings) — list items, quotes, code and islands are left alone.
   */
  setHeading(level: 1 | 2 | 3) {
    const range = this.selectionRange();
    if (!range || !this.container) return;
    const block = this.topLevelBlock(range.startContainer);
    if (!block || block.hasAttribute("data-float-island") || !/^(P|DIV|H[1-6])$/.test(block.tagName)) return;
    const tag = block.tagName === `H${level}` ? "p" : `h${level}`;
    const replacement = document.createElement(tag);
    const start: [Node, number] = [range.startContainer, range.startOffset];
    const end: [Node, number] = [range.endContainer, range.endOffset];
    while (block.firstChild) replacement.appendChild(block.firstChild);
    block.replaceWith(replacement);
    // Text nodes travelled with the children; only endpoints on the block itself need re-homing.
    const next = document.createRange();
    next.setStart(start[0] === block ? replacement : start[0], start[1]);
    next.setEnd(end[0] === block ? replacement : end[0], end[1]);
    const sel = document.getSelection();
    sel?.removeAllRanges();
    sel?.addRange(next);
    this.container.focus({ preventScroll: true });
  }

  /**
   * Where a DOM block starts in the Markdown `toMarkdown()` produces, so a
   * source view can open at the block you were looking at. Returns the block
   * index and its character offset, or null when the body is empty.
   */
  markdownOffsetOf(target: Node | null): { index: number; offset: number } | null {
    if (!this.container) return null;
    const nodes = this.domBlocks();
    if (!nodes.length) return null;
    let index = 0;
    if (target) {
      const block = this.topLevelBlock(target);
      const i = block ? nodes.indexOf(block) : -1;
      if (i >= 0) index = i;
    }
    const md = this.toMarkdown();
    const parts = this.markdownParts();
    let offset = 0;
    if (this.source.lead) offset += this.source.lead.length + 2;
    for (let i = 0; i < index && i < parts.length; i++) if (parts[i]) offset += parts[i].length + 2;
    return { index, offset: Math.min(offset, md.length) };
  }

  /** The block that contains a Markdown character offset (inverse of markdownOffsetOf). */
  blockAtMarkdownOffset(offset: number): number {
    const parts = this.markdownParts();
    let pos = this.source.lead ? this.source.lead.length + 2 : 0;
    for (let i = 0; i < parts.length; i++) {
      if (!parts[i]) continue;
      pos += parts[i].length + 2;
      if (offset < pos) return i;
    }
    return Math.max(0, parts.length - 1);
  }

  /** Put the caret at the start of the n-th block and scroll so it sits at `viewportY` (or just into view). */
  focusBlock(index: number, viewportY?: number) {
    const el = this.container;
    if (!el) return;
    const nodes = this.domBlocks();
    const block = nodes[Math.max(0, Math.min(index, nodes.length - 1))];
    if (!(block instanceof HTMLElement)) return;
    if (viewportY !== undefined) {
      const r = block.getBoundingClientRect();
      window.scrollBy(0, r.top - viewportY);
    }
    el.focus({ preventScroll: true });
    if (block.hasAttribute("data-float-island")) {
      this.select(block);
      return;
    }
    const range = document.createRange();
    range.setStart(block, 0);
    range.collapse(true);
    const sel = document.getSelection();
    sel?.removeAllRanges();
    sel?.addRange(range);
  }

  /** Per-block Markdown in DOM order — the pieces `toMarkdown()` joins with blank lines. */
  private markdownParts(): string[] {
    if (!this.container) return [];
    const ctx: SerializeContext = { imageSrc: (src) => this.relativeImageSrc(src) };
    const nodes = this.domBlocks();
    const matches = this.matchBlocks(nodes);
    return nodes.map((node, i) => {
      const j = matches[i];
      if (j >= 0) {
        const { block } = this.snapshot[j];
        return block.trailer ? `${block.src}\n\n${block.trailer}` : block.src;
      }
      const pending = node instanceof HTMLElement && node.dataset.floatKey ? this.pendingSource.get(node.dataset.floatKey) : undefined;
      return pending ?? blockToMarkdown(node, ctx);
    });
  }

  /** Line up DOM blocks with the source snapshot: islands by key, the rest by content (LCS). -1 = new/changed. */
  private matchBlocks(nodes: Node[]): number[] {
    const matches = new Array<number>(nodes.length).fill(-1);
    if (!this.mapped) return matches;
    const byKey = new Map<string, number>();
    this.snapshot.forEach((s, j) => {
      if (s.key.startsWith("key:")) byKey.set(s.key, j);
    });
    const restDom: number[] = [];
    nodes.forEach((node, i) => {
      const key = keyOf(node);
      const j = byKey.get(key);
      if (j !== undefined) matches[i] = j;
      else restDom.push(i);
    });
    const restSnap = this.snapshot.map((s, j) => j).filter((j) => !this.snapshot[j].key.startsWith("key:"));
    const lcs = alignByLcs(
      restSnap.map((j) => this.snapshot[j].key),
      restDom.map((i) => keyOf(nodes[i])),
    );
    restDom.forEach((i, k) => {
      if (lcs[k] >= 0) matches[i] = restSnap[lcs[k]];
    });
    return matches;
  }

  /** Current body as Markdown. Unchanged blocks reuse their original source; islands always do. */
  toMarkdown(): string {
    if (!this.container) return "";
    const parts: string[] = [];
    if (this.source.lead) parts.push(this.source.lead);
    for (const part of this.markdownParts()) if (part) parts.push(part);
    return parts.join("\n\n").replace(/\n{3,}/g, "\n\n") + "\n";
  }

  /** Insert an uploaded file where it was dropped: an image as a paragraph, a video as a raw-HTML island. */
  insertMedia(item: { name: string; src: string; url: string }, at: Range | null = null) {
    if (mediaKind(item.name) === "video") this.insertHtmlBlock(videoHtml(item.src), at, videoHtml(item.url));
    else this.insertImage(item.url, altFromName(item.name), at);
  }

  /** Insert an image as its own block after the caret's block (or at the end). */
  insertImage(url: string, alt: string, at: Range | null = null) {
    const figure = document.createElement("p");
    const img = document.createElement("img");
    img.src = url;
    img.alt = alt;
    figure.appendChild(img);
    this.placeBlock(figure, at);
  }

  /**
   * Insert one raw-HTML block (a `<video>`, an embed) as an island. `html` is
   * what gets written to the Markdown, verbatim; the DOM shows `preview`
   * (defaults to the same markup — a fresh upload previews through `/@fs/`).
   */
  insertHtmlBlock(html: string, at: Range | null = null, preview = html) {
    const tpl = document.createElement("template");
    tpl.innerHTML = preview.trim();
    const node = tpl.content.firstElementChild;
    if (!(node instanceof HTMLElement)) return;
    const key = `island-${++this.keyCounter}-${Date.now().toString(36)}`;
    node.setAttribute("data-float-island", "");
    node.dataset.floatKey = key;
    node.contentEditable = "false";
    node.draggable = true;
    this.pendingSource.set(key, html.trim());
    this.placeBlock(node, at);
  }

  /** Put a new block after the caret's block (replacing an empty paragraph, else at the end) and park the caret below it. */
  private placeBlock(block: HTMLElement, at: Range | null) {
    const el = this.container;
    if (!el) return;
    const range = at ?? this.selectionRange();
    const anchor = range ? this.topLevelBlock(range.startContainer) : null;
    if (anchor && anchor.parentNode === el) {
      if (isEmptyBlock(anchor)) anchor.replaceWith(block);
      else anchor.after(block);
    } else {
      el.appendChild(block);
    }
    const after = emptyParagraph();
    block.after(after);
    placeCaret(after);
  }

  // ---- islands -----------------------------------------------------------------------

  /**
   * Mark the DOM blocks that came from component / raw-HTML source as islands.
   * Static attributes only, applied before the baseline is taken so they never
   * count as edits. Without a source map, fall back to DOM heuristics.
   */
  private decorateIslands(source: BodySource) {
    const nodes = this.domBlocks();
    const mapped = nodes.length === source.blocks.length;
    nodes.forEach((node, i) => {
      if (!(node instanceof HTMLElement)) return;
      const isIsland = mapped ? Boolean(source.blocks[i].island) : node.matches(ISLAND_SELECTOR) || node.tagName.includes("-");
      if (!isIsland) {
        node.removeAttribute("data-float-island");
        node.removeAttribute("data-float-key");
        return;
      }
      node.setAttribute("data-float-island", "");
      if (!node.dataset.floatKey) node.dataset.floatKey = `island-${++this.keyCounter}-${Date.now().toString(36)}`;
      node.contentEditable = "false";
      node.draggable = true;
    });
  }

  private islandFrom(target: EventTarget | null): HTMLElement | null {
    if (!(target instanceof Element) || !this.container) return null;
    const island = target.closest<HTMLElement>("[data-float-island]");
    return island && island.parentElement === this.container ? island : null;
  }

  private select(island: HTMLElement | null) {
    if (this.selected === island) return;
    this.selected = island;
    this.confirming = false;
    if (island) document.getSelection()?.removeAllRanges();
    this.renderOverlays();
  }

  private moveIsland(island: HTMLElement, dir: -1 | 1) {
    const sibling = dir < 0 ? island.previousElementSibling : island.nextElementSibling;
    if (!sibling) return;
    if (dir < 0) sibling.before(island);
    else sibling.after(island);
    island.scrollIntoView({ block: "nearest", behavior: "smooth" });
    requestAnimationFrame(this.reposition);
  }

  private removeIsland(island: HTMLElement) {
    const next = island.nextElementSibling ?? island.previousElementSibling;
    island.remove();
    this.select(null);
    if (!this.container?.children.length) this.container?.appendChild(emptyParagraph());
    if (next instanceof HTMLElement && !next.hasAttribute("data-float-island")) placeCaret(next);
  }

  private ensureOverlays() {
    if (!this.frame) {
      this.frame = document.createElement("div");
      this.frame.className = "astro-float-frame";
      this.dropLine = document.createElement("div");
      this.dropLine.className = "astro-float-dropline";
      this.bar = document.createElement("div");
      this.bar.className = "astro-float-bar";
      this.bar.addEventListener("mousedown", (e) => e.preventDefault()); // keep page selection where it is
      for (const el of [this.frame, this.dropLine, this.bar]) el.hidden = true;
    }
    // A page swap may have dropped them from the document; put them back.
    for (const el of [this.frame, this.dropLine!, this.bar!]) if (!el.isConnected) document.body.appendChild(el);
  }

  private hideOverlays() {
    for (const el of [this.frame, this.bar, this.dropLine]) if (el) el.hidden = true;
  }

  private renderOverlays() {
    this.ensureOverlays();
    const frame = this.frame!;
    const bar = this.bar!;
    const target = this.selected ?? this.hovered;
    if (!target || !this.attached || !target.isConnected) {
      frame.hidden = true;
      bar.hidden = true;
      return;
    }
    const r = target.getBoundingClientRect();
    const pad = 6;
    Object.assign(frame.style, { left: `${r.left - pad}px`, top: `${r.top - pad}px`, width: `${r.width + pad * 2}px`, height: `${r.height + pad * 2}px` });
    frame.toggleAttribute("data-selected", target === this.selected);
    frame.hidden = false;

    if (target !== this.selected) {
      bar.hidden = true;
      return;
    }
    bar.textContent = "";
    if (this.confirming) {
      const wrap = document.createElement("span");
      wrap.className = "astro-float-confirm";
      wrap.append("Remove this block?");
      const yes = button(null, "Remove", () => this.removeIsland(target), "Remove");
      yes.setAttribute("data-danger", "");
      const no = button(null, "Keep", () => {
        this.confirming = false;
        this.renderOverlays();
      }, "Keep");
      wrap.append(yes, no);
      bar.appendChild(wrap);
    } else {
      const up = button("arrowUp", "Move up", () => this.moveIsland(target, -1));
      const down = button("arrowDown", "Move down", () => this.moveIsland(target, 1));
      up.disabled = !target.previousElementSibling;
      down.disabled = !target.nextElementSibling;
      const grip = button("grip", "Drag to reorder", () => {});
      grip.setAttribute("data-grip", "");
      grip.draggable = true;
      grip.addEventListener("dragstart", (e) => this.startIslandDrag(e, target));
      const sep = document.createElement("span");
      sep.className = "astro-float-sep";
      const del = button("trash", "Remove", () => {
        this.confirming = true;
        this.renderOverlays();
      });
      del.setAttribute("data-danger", "");
      bar.append(up, down, grip, sep, del);
    }
    bar.hidden = false;
    const bw = bar.offsetWidth;
    const left = Math.min(Math.max(8, r.right - bw - 2), window.innerWidth - bw - 8);
    const top = r.top - pad - bar.offsetHeight - 6 >= 4 ? r.top - pad - bar.offsetHeight - 6 : r.top + pad + 4;
    Object.assign(bar.style, { left: `${left}px`, top: `${top}px` });
  }

  private reposition = () => {
    if (this.selected || this.hovered) this.renderOverlays();
  };

  private startIslandDrag(e: DragEvent, island: HTMLElement) {
    this.dragging = island;
    if (e.dataTransfer) {
      e.dataTransfer.setData(ISLAND_DRAG_TYPE, island.dataset.floatKey ?? "");
      e.dataTransfer.effectAllowed = "move";
      const r = island.getBoundingClientRect();
      e.dataTransfer.setDragImage(island, Math.min(40, r.width / 2), 20);
    }
    this.hovered = null;
    if (this.bar) this.bar.hidden = true;
  }

  private updateDropTarget(y: number) {
    const el = this.container!;
    const blocks = Array.from(el.children).filter((c) => c !== this.dragging) as HTMLElement[];
    let best: { block: HTMLElement; before: boolean; dist: number } | null = null;
    for (const block of blocks) {
      const r = block.getBoundingClientRect();
      const mid = r.top + r.height / 2;
      const before = y < mid;
      const edge = before ? r.top : r.bottom;
      const dist = Math.abs(y - edge);
      if (!best || dist < best.dist) best = { block, before, dist };
    }
    this.dropTarget = best ? { block: best.block, before: best.before } : null;
    this.ensureOverlays();
    const line = this.dropLine!;
    if (!best) {
      line.hidden = true;
      return;
    }
    const r = best.block.getBoundingClientRect();
    const cr = el.getBoundingClientRect();
    Object.assign(line.style, { left: `${cr.left}px`, width: `${cr.width}px`, top: `${(best.before ? r.top : r.bottom) - 1}px` });
    line.hidden = false;
  }

  // ---- events --------------------------------------------------------------------

  private queueChange() {
    if (this.changeQueued) return;
    this.changeQueued = true;
    queueMicrotask(() => {
      this.changeQueued = false;
      this.hooks.onChange();
      this.reposition();
    });
  }

  /** The dev toolbar closes the active app on Escape keyup; inside the body Escape only leaves the text. */
  private onKeyup = (e: KeyboardEvent) => {
    if (e.key === "Escape") e.stopPropagation();
  };

  private onKeydown = (e: KeyboardEvent) => {
    const el = this.container!;
    const mod = e.metaKey || e.ctrlKey;

    if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      if (this.selected) this.select(null);
      else el.blur();
      return;
    }

    // An island is selected: it is atomic. Nothing types into it; Backspace asks first.
    if (this.selected) {
      if (mod && ["c", "x", "v", "z", "y", "s"].includes(e.key.toLowerCase())) {
        if (e.key.toLowerCase() === "x") e.preventDefault();
        return;
      }
      if (e.key === "Backspace" || e.key === "Delete") {
        e.preventDefault();
        this.confirming = true;
        this.renderOverlays();
        return;
      }
      if (e.key === "Enter") {
        e.preventDefault();
        const p = emptyParagraph();
        this.selected.after(p);
        this.select(null);
        placeCaret(p);
        return;
      }
      if (e.key === "ArrowUp" || e.key === "ArrowDown") {
        e.preventDefault();
        const sibling = e.key === "ArrowUp" ? this.selected.previousElementSibling : this.selected.nextElementSibling;
        if (sibling instanceof HTMLElement) {
          if (sibling.hasAttribute("data-float-island")) this.select(sibling);
          else {
            this.select(null);
            placeCaret(sibling);
          }
        }
        return;
      }
      if (!mod && e.key.length === 1) {
        e.preventDefault();
        return;
      }
    }

    if (mod && !e.shiftKey && !e.altKey) {
      const key = e.key.toLowerCase();
      if (key === "b" || key === "i") {
        e.preventDefault();
        document.execCommand(key === "b" ? "bold" : "italic");
        return;
      }
      if (key === "k") {
        e.preventDefault();
        const current = (this.selectionRange()?.startContainer.parentElement?.closest("a") as HTMLAnchorElement | null)?.href;
        const url = window.prompt("Link URL", current ?? "https://");
        if (url === null) return;
        if (url === "" && current) document.execCommand("unlink");
        else if (url) document.execCommand("createLink", false, url);
        return;
      }
      return;
    }

    const range = this.selectionRange();
    if (!range) return;

    // Backspace/Delete against an island edge selects it instead of silently eating it.
    if ((e.key === "Backspace" || e.key === "Delete") && range.collapsed) {
      const block = this.topLevelBlock(range.startContainer);
      if (block) {
        const neighbour = e.key === "Backspace" ? block.previousElementSibling : block.nextElementSibling;
        const atEdge = e.key === "Backspace" ? isCaretAtStart(block, range) : isCaretAtEnd(block, range);
        if (atEdge && neighbour instanceof HTMLElement && neighbour.hasAttribute("data-float-island")) {
          e.preventDefault();
          this.select(neighbour);
          return;
        }
      }
    }

    const pre = closestWithin(range.startContainer, el, "pre");
    if (pre) {
      if (e.key === "Enter" && e.shiftKey) {
        e.preventDefault();
        const p = emptyParagraph();
        pre.after(p);
        placeCaret(p);
        return;
      }
      if (e.key === "Enter") {
        e.preventDefault();
        document.execCommand("insertText", false, "\n");
        return;
      }
      if (e.key === "Tab") {
        e.preventDefault();
        document.execCommand("insertText", false, "  ");
        return;
      }
      return;
    }

    if (e.key === "Tab") {
      const li = closestWithin(range.startContainer, el, "li");
      if (li) {
        e.preventDefault();
        if (e.shiftKey) outdentListItem(li);
        else indentListItem(li);
      }
      return;
    }

    if (e.key === " " && range.collapsed) this.markdownShortcut(e, range);
    else if (e.key === "`" && range.collapsed) this.codeFenceShortcut(e, range);
  };

  /** `# `, `- `, `1. `, `> ` at the start of a paragraph become the matching block. */
  private markdownShortcut(e: KeyboardEvent, range: Range) {
    const block = this.topLevelBlock(range.startContainer);
    if (!block || (block.tagName !== "P" && block.tagName !== "DIV")) return;
    const text = (block.textContent ?? "").replace(/\u00a0/g, " ");
    if (!isCaretAtEnd(block, range)) return;
    const m = text.match(/^(#{1,6}|[-*+]|1\.|>)$/);
    if (!m) return;
    e.preventDefault();

    const marker = m[1];
    let replacement: HTMLElement;
    let caretTarget: HTMLElement;
    if (marker.startsWith("#")) {
      replacement = caretTarget = document.createElement(`h${marker.length}`);
    } else if (marker === ">") {
      replacement = document.createElement("blockquote");
      caretTarget = document.createElement("p");
      replacement.appendChild(caretTarget);
    } else {
      replacement = document.createElement(marker === "1." ? "ol" : "ul");
      caretTarget = document.createElement("li");
      replacement.appendChild(caretTarget);
    }
    caretTarget.appendChild(document.createElement("br"));
    block.replaceWith(replacement);
    placeCaret(caretTarget);
  }

  /** Typing the third backtick on an otherwise-empty line opens a code block. */
  private codeFenceShortcut(e: KeyboardEvent, range: Range) {
    const block = this.topLevelBlock(range.startContainer);
    if (!block || (block.tagName !== "P" && block.tagName !== "DIV")) return;
    if ((block.textContent ?? "").replace(/\u00a0/g, " ") !== "``" || !isCaretAtEnd(block, range)) return;
    e.preventDefault();
    const pre = document.createElement("pre");
    const code = document.createElement("code");
    code.appendChild(document.createElement("br"));
    pre.appendChild(code);
    block.replaceWith(pre);
    placeCaret(code);
  }

  private onPaste = (e: ClipboardEvent) => {
    if (this.selected) {
      e.preventDefault();
      return;
    }
    const files = Array.from(e.clipboardData?.files ?? []).filter((f) => mediaKind(f.name, f.type) !== null);
    if (files.length) {
      e.preventDefault();
      this.hooks.onFiles(files, this.selectionRange());
      return;
    }
    const text = e.clipboardData?.getData("text/plain");
    if (text) {
      e.preventDefault();
      // A lone URL pasted on an empty line becomes an embed (YouTube, Vimeo, tweet, video file).
      const range = this.selectionRange();
      const block = range ? this.topLevelBlock(range.startContainer) : null;
      const embed = block && isEmptyBlock(block) && /^(P|DIV)$/.test(block.tagName) ? embedFor(text) : null;
      if (embed) {
        this.insertHtmlBlock(embed.html, range);
        return;
      }
      document.execCommand("insertText", false, text);
    }
  };

  /** Links stay editable text while editing (⌘-click follows them); clicking an island selects it. */
  private onClick = (e: MouseEvent) => {
    const island = this.islandFrom(e.target);
    if (island) {
      e.preventDefault();
      this.select(island);
      return;
    }
    if (this.selected) this.select(null);
    const a = (e.target as HTMLElement).closest("a");
    if (a && !e.metaKey && !e.ctrlKey) e.preventDefault();
  };

  private onDocumentClick = (e: MouseEvent) => {
    if (!this.selected) return;
    const path = e.composedPath();
    if (path.includes(this.selected) || (this.bar && path.includes(this.bar))) return;
    this.select(null);
  };

  /** Clicking a non-editable island leaves focus outside the body, so its Escape / Delete arrive here. */
  private onDocumentKeydown = (e: KeyboardEvent) => {
    if (!this.selected || this.container?.contains(document.activeElement)) return;
    const target = e.target as HTMLElement | null;
    if (target && target !== document.body && target.matches("input, textarea, select, [contenteditable]")) return;
    if (e.key === "Escape") {
      e.preventDefault();
      this.select(null);
    } else if (e.key === "Backspace" || e.key === "Delete") {
      e.preventDefault();
      this.confirming = true;
      this.renderOverlays();
    }
  };

  private onMouseOver = (e: MouseEvent) => {
    const island = this.islandFrom(e.target);
    if (island !== this.hovered) {
      this.hovered = island;
      this.renderOverlays();
    }
  };
  private onMouseLeave = () => {
    if (this.hovered) {
      this.hovered = null;
      this.renderOverlays();
    }
  };

  private onDragStart = (e: DragEvent) => {
    const island = this.islandFrom(e.target);
    if (!island) return;
    this.startIslandDrag(e, island);
  };
  private onDragEnter = (e: DragEvent) => {
    if (this.dragging) {
      e.preventDefault();
      return;
    }
    if (!hasFiles(e)) return;
    e.preventDefault();
    this.dragDepth++;
    this.container?.setAttribute("data-float-dragging", "");
  };
  private onDragOver = (e: DragEvent) => {
    if (this.dragging) {
      e.preventDefault();
      if (e.dataTransfer) e.dataTransfer.dropEffect = "move";
      this.updateDropTarget(e.clientY);
      return;
    }
    if (!hasFiles(e)) return;
    e.preventDefault();
    if (e.dataTransfer) e.dataTransfer.dropEffect = "copy";
  };
  private onDragLeave = () => {
    if (this.dragging) return;
    this.dragDepth = Math.max(0, this.dragDepth - 1);
    if (this.dragDepth === 0) this.container?.removeAttribute("data-float-dragging");
  };
  private onDrop = (e: DragEvent) => {
    if (this.dragging) {
      e.preventDefault();
      const island = this.dragging;
      const target = this.dropTarget;
      this.onDragEnd();
      if (target && target.block !== island) {
        if (target.before) target.block.before(island);
        else target.block.after(island);
        this.select(island);
      }
      return;
    }
    this.dragDepth = 0;
    this.container?.removeAttribute("data-float-dragging");
    const files = Array.from(e.dataTransfer?.files ?? []);
    if (!files.length) return;
    e.preventDefault();
    this.hooks.onFiles(files, rangeFromPoint(e.clientX, e.clientY));
  };
  private onDragEnd = () => {
    this.dragging = null;
    this.dropTarget = null;
    if (this.dropLine) this.dropLine.hidden = true;
    this.renderOverlays();
  };

  // ---- helpers --------------------------------------------------------------------

  private domBlocks(): Node[] {
    if (!this.container) return [];
    return Array.from(this.container.childNodes).filter(
      (n) => n.nodeType === Node.ELEMENT_NODE || (n.nodeType === Node.TEXT_NODE && (n.textContent ?? "").trim() !== ""),
    );
  }

  private topLevelBlock(node: Node): HTMLElement | null {
    const el = this.container;
    if (!el) return null;
    let cur: Node | null = node;
    while (cur && cur.parentNode !== el) cur = cur.parentNode;
    return cur instanceof HTMLElement ? cur : null;
  }

  private selectionRange(): Range | null {
    const sel = document.getSelection();
    if (!sel || !sel.rangeCount) return null;
    const range = sel.getRangeAt(0);
    return this.container?.contains(range.startContainer) ? range : null;
  }

  /**
   * `/_image?href=%2F%40fs%2F…%2Fpost%2Fphoto.png…` and `/@fs/…/post/photo.png`
   * both come back as `./photo.png` when they live next to the entry.
   */
  private relativeImageSrc(src: string): string {
    try {
      let s = src;
      if (s.startsWith("/_image")) {
        const href = new URL(s, location.origin).searchParams.get("href");
        if (href) s = href;
      }
      if (s.startsWith("/@fs/")) {
        let abs = s.slice("/@fs".length).split("?")[0];
        try {
          abs = decodeURIComponent(abs);
        } catch {
          /* leave as-is */
        }
        if (/^\/[A-Za-z]:\//.test(abs)) abs = abs.slice(1);
        if (abs.startsWith(this.absDir + "/")) return "./" + abs.slice(this.absDir.length + 1);
        return abs;
      }
      return src;
    } catch {
      return src;
    }
  }
}

// ---- module helpers ------------------------------------------------------------------

/** Islands key by identity; everything else by its HTML. */
function keyOf(node: Node): string {
  if (node instanceof HTMLElement && node.dataset.floatKey) return "key:" + node.dataset.floatKey;
  if (node instanceof Element) return node.outerHTML;
  return "#text:" + (node.textContent ?? "");
}

function button(name: IconName | null, label: string, onClick: () => void, text?: string): HTMLButtonElement {
  const b = document.createElement("button");
  b.type = "button";
  if (name) b.appendChild(icon(name, 14));
  if (text) b.appendChild(Object.assign(document.createElement("span"), { textContent: text }));
  b.setAttribute("data-tip", label);
  b.setAttribute("aria-label", label);
  b.addEventListener("click", (e) => {
    e.preventDefault();
    e.stopPropagation();
    onClick();
  });
  return b;
}

/** A block with nothing in it but the browser's caret placeholder. */
function isEmptyBlock(block: HTMLElement): boolean {
  return !block.textContent?.trim() && !block.querySelector("img, video, iframe, audio");
}

/** `<p><br></p>` and friends: the paragraphs contenteditable makes for the caret, which write no Markdown. */
function isBlankParagraph(node: Node): boolean {
  if (!(node instanceof HTMLElement) || !/^(P|DIV)$/.test(node.tagName) || node.dataset.floatKey) return false;
  return !node.textContent?.trim() && !node.querySelector(":not(br)");
}

function emptyParagraph(): HTMLParagraphElement {
  const p = document.createElement("p");
  p.appendChild(document.createElement("br"));
  return p;
}

function placeCaret(el: HTMLElement) {
  const sel = document.getSelection();
  if (!sel) return;
  const range = document.createRange();
  range.setStart(el, 0);
  range.collapse(true);
  sel.removeAllRanges();
  sel.addRange(range);
  (el.closest("[data-float-body]") as HTMLElement | null)?.focus();
}

function isCaretAtEnd(block: HTMLElement, range: Range): boolean {
  const probe = range.cloneRange();
  probe.selectNodeContents(block);
  probe.setStart(range.endContainer, range.endOffset);
  return probe.toString().trim() === "";
}

function isCaretAtStart(block: HTMLElement, range: Range): boolean {
  const probe = range.cloneRange();
  probe.selectNodeContents(block);
  probe.setEnd(range.startContainer, range.startOffset);
  return probe.toString().trim() === "";
}

function closestWithin(node: Node, root: HTMLElement, selector: string): HTMLElement | null {
  const start = node instanceof HTMLElement ? node : node.parentElement;
  const hit = start?.closest(selector) as HTMLElement | null;
  return hit && root.contains(hit) && hit !== root ? hit : null;
}

function hasFiles(e: DragEvent): boolean {
  return Array.from(e.dataTransfer?.types ?? []).includes("Files");
}

function rangeFromPoint(x: number, y: number): Range | null {
  const doc = document as Document & {
    caretRangeFromPoint?: (x: number, y: number) => Range | null;
    caretPositionFromPoint?: (x: number, y: number) => { offsetNode: Node; offset: number } | null;
  };
  if (doc.caretRangeFromPoint) return doc.caretRangeFromPoint(x, y);
  const pos = doc.caretPositionFromPoint?.(x, y);
  if (!pos) return null;
  const r = document.createRange();
  r.setStart(pos.offsetNode, pos.offset);
  r.collapse(true);
  return r;
}

function indentListItem(li: HTMLElement) {
  const prev = li.previousElementSibling as HTMLElement | null;
  if (!prev || prev.tagName !== "LI") return;
  const parent = li.parentElement!;
  let nested = prev.querySelector(":scope > ul, :scope > ol") as HTMLElement | null;
  if (!nested) {
    nested = document.createElement(parent.tagName.toLowerCase());
    prev.appendChild(nested);
  }
  nested.appendChild(li);
}

function outdentListItem(li: HTMLElement) {
  const list = li.parentElement!;
  const parentLi = list.parentElement?.closest("li");
  if (!parentLi) return;
  parentLi.after(li);
  if (!list.children.length) list.remove();
}

/**
 * Align two block sequences by exact key equality (longest common subsequence).
 * Returns, for every entry of `next`, the matched index in `prev` or -1.
 */
function alignByLcs(prev: string[], next: string[]): number[] {
  const n = prev.length;
  const m = next.length;
  const dp: Uint16Array[] = Array.from({ length: n + 1 }, () => new Uint16Array(m + 1));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i][j] = prev[i] === next[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }
  const out = new Array<number>(m).fill(-1);
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (prev[i] === next[j]) {
      out[j] = i;
      i++;
      j++;
    } else if (dp[i + 1][j] >= dp[i][j + 1]) i++;
    else j++;
  }
  return out;
}
