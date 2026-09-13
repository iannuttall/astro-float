export const STYLES = /* css */ `
:host {
  all: initial;
}

/*
 * The panel: light by default, dark when the viewer prefers it. Cool neutral
 * greys, one hairline, one radius, 13px system type with 12px help text.
 * Nothing shouts: labels are quiet, controls are quiet until hovered, the only
 * strong element is Save.
 */
.float {
  --bg: #ffffff;
  --bg-elev: #f6f7f9;
  --bg-input: #ffffff;
  --bg-hover: #f1f2f5;
  --bg-active: #e8eaee;
  --fg: #1b1f26;
  --fg-muted: #6b7280;
  --fg-faint: #9aa1ad;
  --line: #e9ebef;
  --line-strong: #d8dce3;
  --line-focus: #9aa1ad;
  --accent: #1b1f26;
  --accent-fg: #ffffff;
  --ok: #1f9d63;
  --warn: #c48a17;
  --err: #d4423e;
  --radius: 8px;
  --radius-sm: 6px;
  --shadow: 0 1px 2px rgba(16, 20, 28, 0.06), 0 12px 32px -12px rgba(16, 20, 28, 0.25);
  --mono: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  color-scheme: light;

  /* A viewport-sized, click-through layer; the panel positions itself inside. */
  position: fixed;
  inset: 0;
  z-index: 2000000000;
  pointer-events: none;
  font: 13px/1.45 -apple-system, BlinkMacSystemFont, "Inter", "Segoe UI", system-ui, sans-serif;
  color: var(--fg);
  -webkit-font-smoothing: antialiased;
  letter-spacing: -0.005em;
  font-feature-settings: "cv11", "ss01";
}
@media (prefers-color-scheme: dark) {
  .float {
    --bg: #0f1114;
    --bg-elev: #15181c;
    --bg-input: #0b0d10;
    --bg-hover: #1b1f24;
    --bg-active: #22262c;
    --fg: #e6e8eb;
    --fg-muted: #8b93a1;
    --fg-faint: #5c6470;
    --line: #1f242a;
    --line-strong: #2a3038;
    --line-focus: #4a5260;
    --accent: #e6e8eb;
    --accent-fg: #0f1114;
    --ok: #3ecf8e;
    --warn: #e5a83b;
    --err: #ef6f6c;
    --shadow: 0 1px 2px rgba(0, 0, 0, 0.3), 0 12px 32px -12px rgba(0, 0, 0, 0.6);
    color-scheme: dark;
  }
}

.float *, .float *::before, .float *::after { box-sizing: border-box; }
.float :where(button, input, select, textarea) { font: inherit; color: inherit; margin: 0; letter-spacing: inherit; }
.float :where(button) { cursor: pointer; background: none; border: 0; padding: 0; text-align: left; }
.float :focus-visible { outline: 2px solid var(--line-focus); outline-offset: 1px; }
.float :where(a) { color: inherit; text-decoration: none; }
.float svg { flex: none; }
.float [hidden] { display: none !important; }
.muted { color: var(--fg-muted); }
.mono { font-family: var(--mono); font-size: 11.5px; letter-spacing: 0; }

/* ---- the panel: a flush column on the right edge -------------------------- */
.panel {
  position: absolute;
  top: 0;
  right: 0;
  bottom: 0;
  width: var(--sb-width, 320px);
  display: flex;
  flex-direction: column;
  overflow: hidden;
  pointer-events: auto;
  background: var(--bg);
  border-left: 1px solid var(--line);
  animation: panel-in 160ms ease;
  transition: transform 200ms cubic-bezier(0.2, 0, 0, 1), opacity 140ms ease;
}
@keyframes panel-in { from { opacity: 0; transform: translateX(8px); } }
.float[data-panel-hidden] .panel { transform: translateX(100%); opacity: 0; pointer-events: none; }
.float[data-resizing] .panel { transition: none; }

/* Only the left edge drags. Invisible until hovered; a hairline while you hold it. */
.resize {
  position: absolute;
  top: 0;
  bottom: 0;
  right: calc(var(--sb-width, 320px) - 4px);
  width: 9px;
  cursor: col-resize;
  pointer-events: auto;
  z-index: 3;
  touch-action: none;
}
.resize::after { content: ""; position: absolute; top: 0; bottom: 0; left: 4px; width: 1px; background: transparent; transition: background 120ms ease; }
.resize:hover::after, .float[data-resizing] .resize::after { background: var(--line-focus); }
.float[data-panel-hidden] .resize { display: none; }

/* Hidden panel: a small tab flush to the edge brings it back and keeps status / Save in view. */
.edge-tab {
  position: absolute;
  top: 50%;
  right: 0;
  transform: translate(100%, -50%);
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 4px;
  padding: 4px;
  background: var(--bg);
  border: 1px solid var(--line);
  border-right: 0;
  border-radius: var(--radius) 0 0 var(--radius);
  box-shadow: var(--shadow);
  pointer-events: none;
  opacity: 0;
  transition: transform 200ms cubic-bezier(0.2, 0, 0, 1) 40ms, opacity 140ms ease 40ms;
}
.float[data-panel-hidden] .edge-tab { transform: translate(0, -50%); opacity: 1; pointer-events: auto; }
.edge-open { width: 28px; height: 28px; display: grid; place-items: center; border-radius: var(--radius-sm); color: var(--fg-muted); }
.edge-open:hover { background: var(--bg-hover); color: var(--fg); }
.edge-status { display: grid; place-items: center; min-height: 10px; }
.edge-status .status-slot { min-width: 0; min-height: 0; padding: 2px 0; }
.edge-status .btn-primary { width: 28px; height: 28px; padding: 0; justify-content: center; border-radius: var(--radius-sm); }
.edge-status .btn-primary span, .edge-status .btn-discard { display: none; }
.edge-status .status-dot { margin: 6px 0; }

/* ---- header ---------------------------------------------------------------- */
.head { display: flex; flex-direction: column; gap: 2px; padding: 10px 8px 8px 14px; border-bottom: 1px solid var(--line); flex: none; }
.head-row { display: flex; align-items: center; gap: 2px; min-width: 0; height: 26px; }
.head-entry { flex: 1; min-width: 0; font-size: 13px; font-weight: 600; letter-spacing: -0.01em; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; margin-right: 6px; }
.head-collection { font-weight: 400; color: var(--fg-muted); }
.icon-btn { width: 26px; height: 26px; display: grid; place-items: center; border-radius: var(--radius-sm); color: var(--fg-muted); }
.icon-btn:hover { background: var(--bg-hover); color: var(--fg); }
.icon-btn:disabled { opacity: 0.35; cursor: default; background: none; }
.icon-btn-danger:hover { color: var(--err); }
.head-status { display: flex; align-items: center; gap: 8px; min-height: 26px; padding-right: 2px; }
.status-text { flex: 1; min-width: 0; font-size: 12px; color: var(--fg-muted); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; font-variant-numeric: tabular-nums; }
.status-text[data-tone="err"] { color: var(--err); }
.status-text[data-tone="warn"] { color: var(--warn); }
.status-actions { display: flex; align-items: center; gap: 4px; }
.status-slot { display: flex; align-items: center; gap: 4px; min-width: 12px; min-height: 12px; justify-content: center; }
.status-dot { width: 6px; height: 6px; border-radius: 999px; background: var(--line-strong); transition: background 200ms ease; margin-right: 6px; }
.status-dot[data-state="dirty"] { background: var(--warn); }
.status-dot[data-state="saving"] { background: var(--fg-faint); animation: float-pulse 900ms ease-in-out infinite; }
.status-dot[data-state="saved"] { background: var(--ok); }
.status-dot[data-state="error"], .status-dot[data-state="conflict"] { background: var(--err); }
@keyframes float-pulse { 50% { opacity: 0.3; } }

.autosave { flex: none; gap: 6px; height: 22px; padding: 0 4px; margin-right: 4px; border-radius: 4px; }
.autosave:hover { background: var(--bg-hover); }
.autosave-label { font-size: 12px; color: var(--fg-muted); }
.autosave[aria-checked="true"] .autosave-label { color: var(--fg); }
.switch-sm { width: 26px; height: 16px; }
.switch-sm::after { width: 12px; height: 12px; }
[aria-checked="true"] > .switch-sm::after { transform: translateX(10px); }

/* ---- tabs ------------------------------------------------------------------ */
.tabs { display: flex; gap: 2px; padding: 8px 10px 0; border-bottom: 1px solid var(--line); flex: none; }
.tab {
  position: relative;
  display: inline-flex;
  align-items: center;
  gap: 5px;
  height: 30px;
  padding: 0 8px;
  margin-bottom: -1px;
  border-bottom: 2px solid transparent;
  font-size: 12.5px;
  font-weight: 500;
  color: var(--fg-muted);
  border-radius: var(--radius-sm) var(--radius-sm) 0 0;
  transition: color 120ms ease, background 120ms ease;
}
.tab:hover { color: var(--fg); background: var(--bg-hover); }
.tab[aria-selected="true"] { color: var(--fg); border-bottom-color: var(--fg); }
.tab:disabled { opacity: 0.4; cursor: default; background: none; }
.tab-dot { width: 6px; height: 6px; border-radius: 999px; background: var(--err); }

/* ---- views ----------------------------------------------------------------- */
.views { flex: 1; min-height: 0; display: flex; flex-direction: column; position: relative; }
.view {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  overflow-x: hidden;
  overscroll-behavior: contain;
  /* Scroll, but never show a bar that would change the content width. */
  scrollbar-width: none;
  -ms-overflow-style: none;
}
.view::-webkit-scrollbar { display: none; }
.view-md, .view-yaml { display: flex; flex-direction: column; }
.empty { padding: 12px 14px; color: var(--fg-muted); font-size: 12.5px; line-height: 1.55; margin: 0; }
.empty code { font-family: var(--mono); font-size: 11px; background: var(--bg-elev); border: 1px solid var(--line-strong); border-radius: 4px; padding: 0 4px; letter-spacing: 0; }

/* ---- controls ------------------------------------------------------------- */
.btn {
  height: 28px;
  padding: 0 10px;
  border-radius: var(--radius-sm);
  border: 1px solid var(--line-strong);
  background: var(--bg);
  font-size: 12px;
  font-weight: 500;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  white-space: nowrap;
  color: var(--fg);
  transition: background 120ms ease, border-color 120ms ease, color 120ms ease;
}
.btn:hover { background: var(--bg-hover); border-color: var(--line-focus); }
.btn:disabled { opacity: 0.5; cursor: default; }
.btn-primary { background: var(--accent); color: var(--accent-fg); border-color: var(--accent); animation: float-in 160ms ease; }
.btn-primary:hover { background: var(--accent); border-color: var(--accent); opacity: 0.88; }
.btn-sm { height: 26px; padding: 0 9px; font-size: 12px; }
.btn-ghost { border-color: transparent; background: none; color: var(--fg-muted); }
.btn-ghost:hover { background: var(--bg-hover); border-color: transparent; color: var(--fg); }
.btn-icon { width: 28px; padding: 0; }
@keyframes float-in { from { opacity: 0; } }

.input, .textarea, .select {
  width: 100%;
  min-height: 30px;
  padding: 5px 9px;
  border: 1px solid var(--line-strong);
  border-radius: var(--radius-sm);
  background: var(--bg-input);
  font-size: 13px;
  color: var(--fg);
  transition: border-color 120ms ease, box-shadow 120ms ease;
}
.input::placeholder, .textarea::placeholder { color: var(--fg-faint); }
.input:hover, .textarea:hover, .select:hover { border-color: var(--line-focus); }
.input:focus, .textarea:focus, .select:focus { border-color: var(--line-focus); outline: none; box-shadow: 0 0 0 3px color-mix(in srgb, var(--line-focus) 22%, transparent); }
.input[data-invalid], .textarea[data-invalid], .code[data-invalid] { border-color: var(--err); box-shadow: none; }
.input-number { width: 96px; text-align: right; font-variant-numeric: tabular-nums; }
.input-time { width: auto; min-width: 96px; font-variant-numeric: tabular-nums; }
.textarea { resize: none; line-height: 1.5; overflow: hidden; }
.textarea.mono { font-family: var(--mono); font-size: 12px; }
.select {
  appearance: none;
  padding-right: 26px;
  background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='%238b93a1' stroke-width='1.75' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='m6 9 6 6 6-6'/%3E%3C/svg%3E");
  background-position: right 8px center;
  background-size: 12px 12px;
  background-repeat: no-repeat;
  cursor: pointer;
}
.row-side .select { width: auto; max-width: 180px; text-overflow: ellipsis; }
.select-inline { width: auto; min-height: 26px; height: 26px; padding: 0 22px 0 8px; font-weight: 500; font-size: 12.5px; background-color: transparent; border-color: transparent; }
.select-inline:hover { border-color: var(--line-strong); }

.date-btn { display: inline-flex; align-items: center; justify-content: space-between; gap: 8px; width: auto; text-align: left; cursor: pointer; font-variant-numeric: tabular-nums; white-space: nowrap; }
.date-btn svg { color: var(--fg-faint); }
.date-btn:hover svg { color: var(--fg-muted); }
.date-btn[data-float-open] { border-color: var(--line-focus); box-shadow: 0 0 0 3px color-mix(in srgb, var(--line-focus) 22%, transparent); }
.date-btn[data-iso=""] .date-label { color: var(--fg-faint); }
.datetime { display: flex; gap: 6px; flex-wrap: wrap; }
.datetime .date-btn { flex: 1; min-width: 140px; }

.switch {
  position: relative;
  display: inline-block;
  width: 30px;
  height: 18px;
  border-radius: 999px;
  background: var(--line-strong);
  transition: background 150ms ease;
  flex: none;
}
.switch::after {
  content: "";
  position: absolute;
  top: 2px;
  left: 2px;
  width: 14px;
  height: 14px;
  border-radius: 999px;
  background: #fff;
  box-shadow: 0 1px 2px rgba(0, 0, 0, 0.2);
  transition: transform 150ms ease, background 150ms ease;
}
[aria-checked="true"] > .switch { background: var(--ok); }
[aria-checked="true"] > .switch::after { transform: translateX(12px); }
.toggle { display: flex; align-items: center; justify-content: space-between; gap: 12px; border-radius: 4px; }
.toggle:hover .switch:not([aria-checked="true"]) { background: var(--line-focus); }

.segmented { display: inline-flex; padding: 2px; gap: 2px; border-radius: var(--radius-sm); background: var(--bg-elev); border: 1px solid var(--line); max-width: 100%; }
.seg-btn { flex: 1; min-width: 0; height: 24px; padding: 0 10px; border-radius: 4px; font-size: 12px; font-weight: 500; color: var(--fg-muted); text-align: center; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; transition: background 120ms ease, color 120ms ease, box-shadow 120ms ease; }
.seg-btn:hover { color: var(--fg); }
.seg-btn[aria-checked="true"] { background: var(--bg); color: var(--fg); box-shadow: 0 1px 2px rgba(16, 20, 28, 0.12), 0 0 0 1px var(--line-strong); }

.chips { display: flex; flex-wrap: wrap; align-items: center; gap: 4px; min-height: 30px; padding: 3px 4px; border: 1px solid var(--line-strong); border-radius: var(--radius-sm); background: var(--bg-input); cursor: text; transition: border-color 120ms ease, box-shadow 120ms ease; }
.chips:hover { border-color: var(--line-focus); }
.chips:focus-within { border-color: var(--line-focus); box-shadow: 0 0 0 3px color-mix(in srgb, var(--line-focus) 22%, transparent); }
.chips-list { display: contents; }
.chip { display: inline-flex; align-items: center; gap: 2px; height: 22px; padding: 0 3px 0 8px; border-radius: 999px; background: var(--bg-elev); border: 1px solid var(--line); font-size: 12px; max-width: 100%; }
.chip-text { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.chip-x { width: 16px; height: 16px; display: grid; place-items: center; border-radius: 999px; color: var(--fg-faint); }
.chip-x:hover { background: var(--bg-active); color: var(--fg); }
.chips-input { flex: 1; min-width: 60px; height: 22px; padding: 0 4px; border: 0; background: none; outline: none; font-size: 13px; }
.chips-input::placeholder { color: var(--fg-faint); }

.image-field { display: flex; flex-direction: column; gap: 6px; }
.image-row { display: flex; align-items: center; gap: 10px; }
.image-thumb { flex: none; width: 56px; height: 56px; display: grid; place-items: center; border-radius: var(--radius-sm); border: 1px solid var(--line-strong); background: var(--bg-elev); color: var(--fg-faint); overflow: hidden; }
.image-thumb img { width: 100%; height: 100%; object-fit: cover; display: block; }
.image-meta { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 6px; }
.image-path { color: var(--fg-muted); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.image-actions { display: flex; gap: 4px; }
.image-picker { display: grid; grid-template-columns: repeat(auto-fill, minmax(72px, 1fr)); gap: 6px; padding: 8px; border: 1px solid var(--line); border-radius: var(--radius-sm); background: var(--bg-elev); }
.image-picker .muted { grid-column: 1 / -1; font-size: 12px; }
.image-option { display: flex; flex-direction: column; gap: 4px; padding: 3px; border-radius: var(--radius-sm); border: 1px solid transparent; }
.image-option:hover { background: var(--bg-hover); }
.image-option[aria-pressed="true"] { border-color: var(--fg); }
.image-option img { width: 100%; aspect-ratio: 1; object-fit: cover; border-radius: 4px; display: block; background: var(--bg); }
.image-option span { font-size: 10.5px; color: var(--fg-muted); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }

.group { display: flex; flex-direction: column; gap: 10px; padding: 8px 0 4px 12px; border-left: 2px solid var(--line); }
.array { display: flex; flex-direction: column; gap: 6px; }
.items { display: flex; flex-direction: column; gap: 6px; }
.item { display: flex; gap: 6px; align-items: flex-start; padding: 8px; border: 1px solid var(--line); border-radius: var(--radius-sm); background: var(--bg-elev); }
.item-body { flex: 1; min-width: 0; }
.item-body .group { padding: 0 0 0 8px; }
.item-body > .input, .item-body > .textarea, .item-body > .chips { background: var(--bg-input); }
.item-tools { display: flex; flex-direction: column; gap: 0; flex: none; }
.item-tools .icon-btn { width: 22px; height: 22px; }
.add-item { align-self: flex-start; }

/* ---- fields view -------------------------------------------------------------- */
.form { display: flex; flex-direction: column; }
.rows { display: flex; flex-direction: column; }
.row { display: flex; flex-direction: column; gap: 6px; padding: 10px 14px; border-bottom: 1px solid var(--line); }
.row-nested { padding: 0; border-bottom: 0; }
.row-head { display: flex; align-items: flex-start; justify-content: space-between; gap: 10px; min-width: 0; }
.row-text { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 1px; padding-top: 1px; }
.row-label { display: flex; flex-wrap: wrap; align-items: center; gap: 0 6px; font-size: 13px; font-weight: 500; color: var(--fg); min-width: 0; }
.row-name { white-space: nowrap; }
.row-nested .row-label { font-size: 12.5px; }
.req { color: var(--fg-faint); font-weight: 400; margin-left: -3px; }
.on-page { font-size: 10px; font-weight: 500; letter-spacing: 0.06em; text-transform: uppercase; color: var(--fg-faint); }
.row-help { font-size: 12px; line-height: 1.4; color: var(--fg-muted); }
.row-side { display: flex; align-items: center; gap: 4px; flex: none; max-width: 64%; }
.row[data-inline] .row-head { align-items: center; }
.row-static { color: var(--fg-muted); padding: 4px 0; }
.row-revert { width: 22px; height: 22px; display: grid; place-items: center; border-radius: 4px; color: var(--warn); }
.row-revert:hover { background: var(--bg-hover); }
.row-remove { width: 22px; height: 22px; display: grid; place-items: center; border-radius: 4px; color: var(--fg-faint); opacity: 0; transition: opacity 120ms ease; }
.row:hover > .row-head .row-remove, .row-remove:focus-visible { opacity: 1; }
.row-remove:hover { background: var(--bg-hover); color: var(--fg); }
.row-note { font-size: 11.5px; line-height: 1.45; color: var(--warn); }
.row-note:empty { display: none; }
.row-removed .row-label { text-decoration: line-through; color: var(--fg-faint); }
.row[data-unset] .row-help::after { content: " · not set"; color: var(--fg-faint); }
.row[data-unset][data-type="boolean"] .switch { opacity: 0.6; }
.field-add { display: flex; gap: 6px; padding: 12px 14px; }
.form-foot { margin: 0; padding: 10px 14px; font-size: 11.5px; line-height: 1.5; }
.form-note { margin: 0; padding: 8px 14px; font-size: 11.5px; line-height: 1.5; color: var(--fg-muted); border-bottom: 1px solid var(--line); word-break: break-all; }

/* ---- code views (YAML / Markdown) ---------------------------------------------- */
.code-view { display: flex; flex-direction: column; flex: 1; min-height: 0; }
.code-box { position: relative; display: flex; flex: 1; min-height: 0; }
.code {
  flex: 1;
  min-width: 0;
  min-height: 200px;
  margin: 0;
  padding: 10px 12px;
  border: 0;
  border-radius: 0;
  background: var(--bg);
  color: var(--fg);
  font: 12px/1.6 var(--mono);
  tab-size: 2;
  resize: none;
  outline: none;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
  overflow: auto;
}
.code-md { font-size: 12.5px; }
.code:focus { box-shadow: inset 0 0 0 1px var(--line-focus); }
/* YAML: the mirror defines the height and draws the numbers; the textarea lies over it, transparent, never scrolling on its own. */
.code-box-mirrored { flex: 1 0 auto; display: block; }
.code-mirror, .code-box-mirrored .code {
  --gutter: 36px;
  margin: 0;
  padding: 10px 12px 10px calc(var(--gutter) + 10px);
  font: 12px/1.6 var(--mono);
  tab-size: 2;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
  word-break: normal;
  letter-spacing: 0;
}
.code-mirror {
  position: relative;
  display: block;
  min-height: 200px;
  color: transparent;
  background: linear-gradient(to right, var(--bg-elev) var(--gutter), var(--line) var(--gutter), var(--line) calc(var(--gutter) + 1px), transparent calc(var(--gutter) + 1px));
  counter-reset: line;
  pointer-events: none;
  user-select: none;
  -webkit-user-select: none;
}
.code-line { display: block; position: relative; counter-increment: line; min-height: 1.6em; }
.code-line::before {
  content: counter(line);
  position: absolute;
  left: calc(-1 * var(--gutter) - 10px);
  width: calc(var(--gutter) - 6px);
  text-align: right;
  color: var(--fg-faint);
}
.code-box-mirrored .code {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  min-height: 0;
  background: transparent;
  overflow: hidden;
  display: block;
}
.code-box-mirrored .code[data-invalid] { box-shadow: inset 0 0 0 1px var(--err); }
.code-error { padding: 8px 14px; font-size: 12px; line-height: 1.45; color: var(--err); border-top: 1px solid var(--line); }
.code-error:empty { display: none; }
.code-status { display: flex; align-items: center; gap: 8px; padding: 8px 14px; font-size: 12px; line-height: 1.45; border-top: 1px solid var(--line); }
.code-error-inline { display: inline-flex; align-items: center; gap: 5px; color: var(--err); flex: 1; min-width: 0; }

/* ---- footer: collection / entries ----------------------------------------------- */
.foot-host { flex: none; }
.foot { border-top: 1px solid var(--line); background: var(--bg); }
.foot-bar { display: flex; align-items: center; gap: 4px; padding: 6px 8px 6px 6px; min-height: 40px; }
.foot-name { font-weight: 500; font-size: 12.5px; padding: 0 8px; }
.foot-toggle { display: inline-flex; align-items: center; gap: 4px; height: 26px; padding: 0 8px 0 4px; border-radius: var(--radius-sm); color: var(--fg-muted); font-size: 12px; flex: 1; min-width: 0; }
.foot-toggle:hover { background: var(--bg-hover); color: var(--fg); }
.foot-toggle svg { transition: transform 150ms ease; }
.foot-toggle[aria-expanded="true"] svg { transform: rotate(180deg); }
.foot-count { white-space: nowrap; }
.foot-body { max-height: min(40vh, 320px); overflow-y: auto; border-top: 1px solid var(--line); padding: 6px 0; scrollbar-width: none; }
.foot-body::-webkit-scrollbar { display: none; }
.list { display: flex; flex-direction: column; padding: 0 6px; }
.list-item { display: flex; align-items: center; gap: 8px; height: 30px; padding: 0 8px; border-radius: var(--radius-sm); min-width: 0; width: 100%; color: var(--fg); font-size: 12.5px; }
.list-item:hover { background: var(--bg-hover); }
.list-item[aria-current="page"] { background: var(--bg-elev); font-weight: 500; }
.list-item .title { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.list-item svg { color: var(--fg-faint); }
.list-action { color: var(--fg-muted); }
.list-action:hover { color: var(--fg); }
.list-item + .list-action { margin-top: 6px; position: relative; }
.list-item + .list-action::before { content: ""; position: absolute; left: 8px; right: 8px; top: -4px; border-top: 1px solid var(--line); }

.card { display: flex; flex-direction: column; gap: 10px; margin: 4px 10px 10px; padding: 12px; border: 1px solid var(--line-strong); border-radius: var(--radius); background: var(--bg-elev); }
.card-title { font-size: 12.5px; font-weight: 600; }
.card label { display: flex; flex-direction: column; gap: 5px; font-size: 12px; color: var(--fg-muted); }
.card .input { background: var(--bg-input); }
.card-note { margin: 0; font-size: 11.5px; line-height: 1.5; color: var(--fg-faint); }
.form-error { font-size: 11.5px; color: var(--err); }
.form-error:empty { display: none; }
.card-actions { display: flex; justify-content: flex-end; gap: 6px; }

/* ---- small screens ---------------------------------------------------------
 * The root becomes a box the size of the *visual* viewport (updated from JS as
 * the keyboard opens/closes) and the panel becomes a bottom sheet above the
 * Astro bar. Inputs are 16px so iOS never zooms.
 */
@media (max-width: 640px) {
  .float {
    inset: auto;
    top: var(--vv-top, 0px);
    left: var(--vv-left, 0px);
    width: var(--vv-width, 100vw);
    height: var(--vv-height, 100dvh);
  }
  .panel { top: auto; left: 0; right: 0; bottom: 0; width: auto; max-height: min(70%, 560px); padding-bottom: 56px; border-left: 0; border-top: 1px solid var(--line); border-radius: 12px 12px 0 0; animation-name: sheet-up; -webkit-overflow-scrolling: touch; }
  @keyframes sheet-up { from { opacity: 0; transform: translateY(8px); } }
  .float[data-panel-hidden] .panel { transform: translateY(100%); }
  .edge-tab { top: auto; bottom: 64px; transform: translate(100%, 0); }
  .float[data-panel-hidden] .edge-tab { transform: translate(0, 0); }
  .resize { display: none; }
  .input, .textarea, .select, .chips-input, .code { font-size: 16px; }
  .input, .select { min-height: 40px; }
  .select-inline { min-height: 32px; height: 32px; font-size: 14px; }
  .btn { height: 38px; padding: 0 14px; font-size: 14px; }
  .btn-icon { width: 40px; padding: 0; }
  .btn-sm { height: 32px; padding: 0 12px; font-size: 13px; }
  .icon-btn { width: 32px; height: 32px; }
  .head-row { height: 32px; }
  .tab { height: 36px; font-size: 14px; }
  .list-item { height: 44px; padding: 0 10px; font-size: 15px; }
  .row-label { font-size: 15px; }
  .row-help { font-size: 13px; }
  .row-remove { opacity: 1; width: 28px; height: 28px; }
  .row .toggle { min-height: 40px; }
  .row .switch { width: 40px; height: 24px; }
  .row .switch::after { width: 20px; height: 20px; }
  .row [aria-checked="true"] > .switch::after { transform: translateX(16px); }
  .seg-btn { height: 32px; font-size: 14px; }
  .chip { height: 28px; font-size: 14px; }
  .card label, .card-note { font-size: 13px; }
  .foot-body { max-height: 28vh; }
}
`;
