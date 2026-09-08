export const STYLES = /* css */ `
:host {
  all: initial;
}

/* Palette lifted from the Astro dev toolbar so every shell reads as a sibling of the bottom pill. */
.float {
  --bg: #13151a;
  --bg-gradient: linear-gradient(180deg, #13151a 0%, rgba(19, 21, 26, 0.88) 100%);
  --bg-subtle: #1a1d24;
  --bg-hover: rgba(255, 255, 255, 0.08);
  --bg-active: rgba(71, 78, 94, 1);
  --fg: #eef0f4;
  --fg-muted: #9aa1ad;
  --fg-faint: #6b7280;
  --icon: #d5d8de;
  --line: #343841;
  --line-strong: #454b57;
  --accent: #eef0f4;
  --accent-fg: #13151a;
  --focus: rgba(255, 255, 255, 0.2);
  --ok: #4ade80;
  --warn: #fbbf24;
  --err: #f87171;
  --shadow: 0 0 0 0 rgba(19, 21, 26, 0.3), 0 1px 2px 0 rgba(19, 21, 26, 0.29), 0 4px 4px 0 rgba(19, 21, 26, 0.26),
    0 10px 6px 0 rgba(19, 21, 26, 0.15), 0 17px 7px 0 rgba(19, 21, 26, 0.04);
  --ease-pop: cubic-bezier(0.485, -0.05, 0.285, 1.505);
  --mono: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;

  /* A viewport-sized, click-through layer; each shell positions itself inside. */
  position: fixed;
  inset: 0;
  z-index: 2000000000;
  pointer-events: none;
  font: 13px/1.45 system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
  color: var(--fg);
  color-scheme: dark;
  -webkit-font-smoothing: antialiased;
  letter-spacing: 0;
}
.chrome-host { position: absolute; inset: 0; pointer-events: none; }
.chrome-host > * { pointer-events: auto; }

.float *, .float *::before, .float *::after { box-sizing: border-box; }
.float :where(button, input, select, textarea) { font: inherit; color: inherit; margin: 0; }
.float :where(button) { cursor: pointer; background: none; border: 0; padding: 0; text-align: left; }
.float :focus-visible { outline: 2px solid var(--focus); outline-offset: 1px; }
.float :where(a) { color: inherit; text-decoration: none; }
.muted { color: var(--fg-muted); }
.mono { font-family: var(--mono); font-size: 11px; }

/* Shared bits of chrome */
.chrome-mode {
  font-size: 10.5px;
  font-weight: 600;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: var(--fg-faint);
  white-space: nowrap;
}
.chrome-entry { font-family: var(--mono); font-size: 11px; color: var(--fg-muted); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }

/* ---- shared icon buttons -------------------------------------------------- */
.rail-btn, .status-slot {
  position: relative;
  z-index: 1;
  display: grid;
  place-items: center;
  color: var(--icon);
  transition: background 120ms ease, color 120ms ease, opacity 200ms ease-out;
}
.rail-btn:hover, .rail-btn:focus-visible { background: var(--bg-hover); color: #fff; outline-offset: -3px; }
.rail-btn[aria-pressed="true"] { background: var(--bg-active); color: #fff; }
.rail-btn:disabled { opacity: 0.3; cursor: default; }
.rail-btn:disabled:hover { background: none; color: var(--icon); }

/* Astro-style tooltip: dark rounded label with a caret pointing at the icon. */
.tip::after {
  content: attr(data-tip);
  position: absolute;
  white-space: nowrap;
  padding: 4px 9px;
  border-radius: 4px;
  background: #13151a;
  border: 1px solid var(--line);
  color: #fff;
  font-size: 15px;
  line-height: 1.3;
  font-weight: 400;
  letter-spacing: 0;
  text-transform: none;
  pointer-events: none;
  user-select: none;
  opacity: 0;
  transition: opacity 0.2s ease-in-out 0s;
}
.tip::before {
  content: "";
  position: absolute;
  border: 5px solid transparent;
  pointer-events: none;
  opacity: 0;
  transition: opacity 0.2s ease-in-out 0s;
}
.tip:hover::after, .tip:hover::before, .tip:focus-visible::after, .tip:focus-visible::before { opacity: 1; transition-delay: 200ms; }
.rail-btn:disabled::after, .rail-btn:disabled::before { opacity: 0 !important; }
/* beside a vertical rail / sheet */
.float[data-side="right"] .tip::after { top: 50%; right: calc(100% + 13px); transform: translateY(-50%); }
.float[data-side="right"] .tip::before { top: 50%; right: calc(100% + 3px); transform: translateY(-50%); border-left-color: var(--line); }
.float[data-side="left"] .tip::after { top: 50%; left: calc(100% + 13px); transform: translateY(-50%); }
.float[data-side="left"] .tip::before { top: 50%; left: calc(100% + 3px); transform: translateY(-50%); border-right-color: var(--line); }
/* above the popover */
.float .popover .tip::after { top: auto; right: auto; bottom: calc(100% + 12px); left: 50%; transform: translateX(-50%); }
.float .popover .tip::before { top: auto; right: auto; bottom: calc(100% + 2px); left: 50%; transform: translateX(-50%); border-color: transparent; border-top-color: var(--line); }

/* Status slot: a quiet dot, or the Save button when there's work to save. */
.status-dot {
  width: 6px;
  height: 6px;
  border-radius: 999px;
  background: var(--line-strong);
  transition: background 200ms ease;
}
.status-dot[hidden] { display: none; }
.status-dot[data-state="dirty"] { background: var(--warn); }
.status-dot[data-state="saving"] { background: var(--fg-faint); animation: float-pulse 900ms ease-in-out infinite; }
.status-dot[data-state="saved"] { background: var(--ok); }
.status-dot[data-state="error"], .status-dot[data-state="conflict"] { background: var(--err); }
@keyframes float-pulse { 50% { opacity: 0.3; } }
.rail-save {
  position: relative;
  width: 24px;
  height: 24px;
  display: grid;
  place-items: center;
  border-radius: 999px;
  background: var(--accent);
  color: var(--accent-fg);
  animation: float-in 200ms var(--ease-pop);
}
.rail-save[hidden] { display: none; }
.rail-save:hover { background: #fff; }
@keyframes float-in { from { transform: scale(0.6); opacity: 0; } }

/* ==== mode 1: toolbar popover ============================================== */
.float[data-mode="toolbar"] .popover {
  position: absolute;
  bottom: 72px;
  left: 50%;
  transform: translateX(-50%);
  height: 40px;
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 0 4px 0 14px;
  background: var(--bg-gradient);
  border: 1px solid var(--line);
  border-radius: 9999px;
  box-shadow: var(--shadow);
  max-width: calc(100vw - 32px);
  animation: pop-in 180ms ease;
}
.float[data-mode="toolbar"][data-placement="bottom-left"] .popover { left: 16px; transform: none; }
.float[data-mode="toolbar"][data-placement="bottom-right"] .popover { left: auto; right: 16px; transform: none; }
@keyframes pop-in { from { opacity: 0; transform: translate(-50%, 6px); } }
.float[data-mode="toolbar"][data-placement="bottom-left"] .popover, .float[data-mode="toolbar"][data-placement="bottom-right"] .popover { animation-name: pop-in-edge; }
@keyframes pop-in-edge { from { opacity: 0; transform: translateY(6px); } }
.popover .chrome-entry { max-width: 220px; margin-left: 8px; }
.pop-sep { width: 1px; height: 18px; background: var(--line); margin: 0 6px; flex: none; }
.pop-actions { display: flex; align-items: center; }
.popover .rail-btn { width: 36px; height: 32px; border-radius: 8px; }
.popover .status-slot { width: 36px; height: 32px; }
.float[data-mode="toolbar"] .panel-host {
  position: absolute;
  bottom: 124px;
  left: 50%;
  transform: translateX(-50%);
  pointer-events: none;
}
.float[data-mode="toolbar"][data-placement="bottom-left"] .panel-host { left: 16px; transform: none; }
.float[data-mode="toolbar"][data-placement="bottom-right"] .panel-host { left: auto; right: 16px; transform: none; }
.float[data-mode="toolbar"] .panel { max-height: min(640px, calc(100vh - 160px)); pointer-events: auto; animation-name: panel-up; }
@keyframes panel-up { from { opacity: 0; transform: translateY(8px); } }

/* ==== mode 2: the tucked rail =============================================== */
.float[data-mode="float"] .chrome-host {
  inset: auto;
  top: 50%;
  transform: translateY(-50%);
  display: flex;
  align-items: center;
  gap: 10px;
}
.float[data-mode="float"][data-side="right"] .chrome-host { right: 16px; flex-direction: row-reverse; }
.float[data-mode="float"][data-side="left"] .chrome-host { left: 16px; flex-direction: row; }
.rail {
  position: relative;
  z-index: 1; /* tooltips paint over the panel beside it */
  width: 40px;
  display: flex;
  flex-direction: column;
  align-items: stretch;
  background: var(--bg-gradient);
  border: 1px solid var(--line);
  border-radius: 9999px;
  box-shadow: var(--shadow);
  --rail-x: 0px;
  --rail-y: 0px;
  transform: translate(var(--rail-x), var(--rail-y));
  transition: transform 0.35s var(--ease-pop);
  animation: rail-in 220ms ease; /* it fades in already tucked — it never slides out first */
}
@keyframes rail-in { from { opacity: 0; } }
.float[data-side="right"][data-tucked] .rail { --rail-x: 26px; }
.float[data-side="left"][data-tucked] .rail { --rail-x: -26px; }
.float[data-tucked] .rail > * { opacity: 0.35; }
@media (hover: hover) {
  .float[data-side="right"]:not([data-tucked]) .rail:hover { --rail-x: -3px; }
  .float[data-side="left"]:not([data-tucked]) .rail:hover { --rail-x: 3px; }
  /* Generous invisible hit zone so the tucked sliver is easy to catch (Astro has the same above its bar). */
  .rail::after { content: ""; position: absolute; top: -12px; bottom: -12px; left: -28px; right: -20px; }
  .float[data-side="left"] .rail::after { left: -20px; right: -28px; }
}
.rail .rail-btn, .rail .status-slot { width: 100%; height: 36px; }
.rail > :first-child { border-top-left-radius: 9999px; border-top-right-radius: 9999px; padding-top: 3px; height: 39px; }
.rail > :last-child { border-bottom-left-radius: 9999px; border-bottom-right-radius: 9999px; padding-bottom: 3px; height: 39px; }
.rail-sep { display: block; height: 1px; background: var(--line); }
.float[data-mode="float"] .panel { animation-name: panel-in; }
.float[data-mode="float"][data-side="left"] .panel { animation-name: panel-in-left; }
@keyframes panel-in { from { opacity: 0; transform: translateX(8px); } }
@keyframes panel-in-left { from { opacity: 0; transform: translateX(-8px); } }

/* ==== mode 3: docked sheet ================================================== */
.sheet {
  position: absolute;
  top: 16px;
  bottom: 16px;
  width: 340px;
  display: flex;
  flex-direction: column;
  background: var(--bg);
  border: 1px solid var(--line);
  border-radius: 12px;
  box-shadow: var(--shadow);
  overflow: hidden;
  animation: sheet-in 200ms ease;
  transition: transform 0.3s var(--ease-pop), opacity 0.2s ease;
}
.float[data-side="right"] .sheet { right: 16px; }
.float[data-side="left"] .sheet { left: 16px; }
@keyframes sheet-in { from { opacity: 0; } }
.float[data-side="right"][data-sheet-collapsed] .sheet { transform: translateX(calc(100% + 24px)); opacity: 0; pointer-events: none; }
.float[data-side="left"][data-sheet-collapsed] .sheet { transform: translateX(calc(-100% - 24px)); opacity: 0; pointer-events: none; }
.sheet-head { display: flex; align-items: center; gap: 10px; min-height: 44px; padding: 0 8px 0 14px; border-bottom: 1px solid var(--line); }
.sheet-head .chrome-entry { flex: 1; min-width: 0; }
.sheet-hide { color: var(--fg-muted); gap: 2px; padding: 0 6px 0 8px; }
.sheet-hide:hover { color: var(--fg); }
.float[data-side="left"] .sheet-hide svg { transform: rotate(180deg); }
.sheet-tabs { display: flex; gap: 0; padding: 8px 6px 0; border-bottom: 1px solid var(--line); }
.sheet-tabs button {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  height: 32px;
  padding: 0 8px;
  border-radius: 7px 7px 0 0;
  font-size: 12px;
  white-space: nowrap;
  color: var(--fg-muted);
  border-bottom: 2px solid transparent;
  margin-bottom: -1px;
}
.sheet-tabs button:hover { color: var(--fg); background: var(--bg-hover); }
.sheet-tabs button[aria-pressed="true"] { color: var(--fg); border-bottom-color: var(--fg); }
.sheet-tabs button:disabled { opacity: 0.3; cursor: default; background: none; }
.sheet-body { flex: 1; min-height: 0; display: flex; flex-direction: column; overflow: hidden; }
.sheet-body > .panel-body { flex: 1; }
.sheet-handle {
  position: absolute;
  top: 50%;
  transform: translateY(-50%);
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
  width: 40px;
  padding: 12px 0 8px;
  background: var(--bg-gradient);
  border: 1px solid var(--line);
  border-radius: 9999px;
  box-shadow: var(--shadow);
  color: var(--icon);
  font-size: 10.5px;
  font-weight: 600;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  opacity: 0;
  pointer-events: none;
  transition: opacity 0.2s ease 0.1s;
}
.sheet-handle span { writing-mode: vertical-rl; }
.float[data-side="right"] .sheet-handle { right: 16px; }
.float[data-side="left"] .sheet-handle { left: 16px; }
.float[data-sheet-collapsed] .sheet-handle { opacity: 1; pointer-events: auto; }
.sheet-handle .status-slot { width: 100%; height: 28px; }

/* ---- panel (modes 1 & 2) --------------------------------------------------- */
.panel {
  width: 340px;
  max-height: min(680px, calc(100vh - 96px));
  display: flex;
  flex-direction: column;
  background: var(--bg);
  border: 1px solid var(--line);
  border-radius: 12px;
  box-shadow: var(--shadow);
  overflow: hidden;
  animation: panel-in 180ms ease;
  pointer-events: auto;
}
.panel[data-panel="source"] { height: min(620px, calc(100vh - 160px)); }

.panel-head {
  display: flex;
  align-items: center;
  gap: 8px;
  min-height: 44px;
  padding: 0 8px 0 14px;
  border-bottom: 1px solid var(--line);
}
.panel-title { font-weight: 600; font-size: 13px; }
.panel-sub {
  flex: 1;
  min-width: 0;
  font-family: var(--mono);
  font-size: 11px;
  color: var(--fg-muted);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.panel-body { flex: 1; min-height: 0; overflow: auto; }
.panel-body.pad { padding: 12px 14px; }
.panel-foot {
  display: flex;
  align-items: center;
  gap: 8px;
  min-height: 44px;
  padding: 6px 8px 6px 14px;
  border-top: 1px solid var(--line);
}
.foot-status { flex: 1; min-width: 0; font-size: 11.5px; color: var(--fg-muted); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.foot-status[data-tone="err"] { color: var(--err); }
.foot-status[data-tone="warn"] { color: var(--warn); }
.foot-actions { display: flex; gap: 6px; }

/* ---- controls ------------------------------------------------------------- */
.icon-btn {
  position: relative;
  width: 28px;
  height: 28px;
  display: grid;
  place-items: center;
  border-radius: 7px;
  color: var(--fg-muted);
}
.icon-btn:hover { background: var(--bg-hover); color: var(--fg); }

.btn {
  height: 28px;
  padding: 0 10px;
  border-radius: 7px;
  border: 1px solid var(--line-strong);
  background: rgba(255, 255, 255, 0.04);
  font-size: 12px;
  font-weight: 500;
  display: inline-flex;
  align-items: center;
  gap: 6px;
  white-space: nowrap;
  transition: background 120ms ease;
}
.btn:hover { background: var(--bg-hover); }
.btn:disabled { opacity: 0.5; cursor: default; }
.btn-primary { background: var(--accent); color: var(--accent-fg); border-color: var(--accent); }
.btn-primary:hover { background: #fff; }
.btn-sm { height: 24px; padding: 0 8px; font-size: 11.5px; }
.btn-ghost { border-color: transparent; background: none; }

.input, .textarea, .select {
  width: 100%;
  min-height: 28px;
  padding: 4px 8px;
  border: 1px solid var(--line);
  border-radius: 7px;
  background: rgba(255, 255, 255, 0.04);
  font-size: 12.5px;
  transition: border-color 120ms ease;
}
.input::placeholder, .textarea::placeholder { color: var(--fg-faint); }
.input:hover, .textarea:hover, .select:hover { border-color: var(--line-strong); }
.input:focus, .textarea:focus, .select:focus { border-color: #5b6270; outline: 2px solid var(--focus); outline-offset: 0; }
.input[data-invalid], .textarea[data-invalid] { border-color: var(--err); }
.textarea { resize: vertical; line-height: 1.5; }
.textarea.mono { font-family: var(--mono); font-size: 12px; }
.select {
  appearance: none;
  padding-right: 24px;
  background-image: linear-gradient(45deg, transparent 50%, var(--fg-muted) 50%), linear-gradient(135deg, var(--fg-muted) 50%, transparent 50%);
  background-position: calc(100% - 13px) 12px, calc(100% - 9px) 12px;
  background-size: 4px 4px;
  background-repeat: no-repeat;
}

.switch {
  position: relative;
  display: inline-block;
  width: 30px;
  height: 18px;
  border-radius: 999px;
  background: #3a404b;
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
  background: #d5d8de;
  transition: transform 150ms ease, background 150ms ease;
}
[aria-checked="true"] > .switch { background: var(--accent); }
[aria-checked="true"] > .switch::after { transform: translateX(12px); background: var(--accent-fg); }
.toggle-row { display: flex; align-items: center; justify-content: space-between; gap: 12px; width: 100%; border-radius: 6px; }
.toggle-row:hover .switch:not([aria-checked="true"]) { background: #454b57; }

.segmented { display: inline-flex; padding: 2px; border-radius: 8px; background: rgba(255, 255, 255, 0.04); border: 1px solid var(--line); }
.segmented button { height: 22px; padding: 0 10px; border-radius: 6px; font-size: 11.5px; font-weight: 500; color: var(--fg-muted); display: inline-flex; align-items: center; gap: 6px; }
.segmented button[aria-pressed="true"] { background: var(--bg-active); color: #fff; }
.segmented-wide { display: flex; width: 100%; }
.segmented-wide button { flex: 1; justify-content: center; height: 26px; }
.setting-stack { flex-direction: column; align-items: stretch; gap: 8px; }
.mode-blurb { margin-top: -2px; }

/* ---- source (read-only escape hatch) -------------------------------------- */
.panel-body.source { display: flex; flex-direction: column; }
.source-note {
  margin: 0;
  padding: 10px 14px;
  font-size: 11.5px;
  line-height: 1.5;
  color: var(--fg-muted);
  border-bottom: 1px solid var(--line);
  background: var(--bg-subtle);
}
.source-note code, .empty code {
  font-family: var(--mono);
  font-size: 10.5px;
  background: rgba(255, 255, 255, 0.06);
  border: 1px solid var(--line);
  border-radius: 4px;
  padding: 0 4px;
}
.source-view {
  flex: 1;
  min-height: 160px;
  width: 100%;
  padding: 12px 14px;
  border: 0;
  resize: none;
  background: transparent;
  font-family: var(--mono);
  font-size: 12px;
  line-height: 1.6;
  tab-size: 2;
  color: var(--fg);
  white-space: pre-wrap;
  overflow: auto;
}
.source-view:read-only { color: var(--fg-muted); }
.source-view:focus { outline: none; }

/* ---- fields --------------------------------------------------------------- */
.field { display: flex; flex-direction: column; gap: 5px; padding: 8px 0; }
.field + .field { border-top: 1px solid var(--line); }
.field-head { display: flex; align-items: center; gap: 6px; min-height: 20px; }
.field-key { font-size: 11.5px; font-weight: 500; color: var(--fg-muted); flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.field-type { font-family: var(--mono); font-size: 10px; color: var(--fg-faint); text-transform: lowercase; }
.field-remove { width: 20px; height: 20px; display: grid; place-items: center; border-radius: 5px; color: var(--fg-faint); opacity: 0; transition: opacity 120ms ease; }
.field:hover .field-remove, .field-remove:focus-visible { opacity: 1; }
.field-remove:hover { background: var(--bg-hover); color: var(--fg); }
.field-hint { font-size: 11px; color: var(--fg-faint); }
.field .toggle-row { padding: 2px 0; }
.field-add { display: flex; gap: 6px; padding-top: 10px; margin-top: 4px; border-top: 1px solid var(--line); }

/* ---- lists / collection --------------------------------------------------- */
.list { display: flex; flex-direction: column; padding: 6px; }
.list-item { display: flex; align-items: center; gap: 10px; padding: 7px 8px; border-radius: 7px; min-width: 0; }
.list-item:hover { background: var(--bg-hover); }
.list-item[aria-current="page"] { background: rgba(255, 255, 255, 0.05); }
.list-item .title { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 12.5px; }
.list-item .id { font-family: var(--mono); font-size: 10.5px; color: var(--fg-faint); white-space: nowrap; }
.list-item svg { color: var(--fg-faint); flex: none; }
.list-item:hover svg { color: var(--fg-muted); }

.toolbar-row { display: flex; align-items: center; gap: 8px; padding: 10px 14px; border-bottom: 1px solid var(--line); }
.toolbar-row .grow { flex: 1; min-width: 0; }
.collection-name { font-weight: 500; }

.row-action {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  padding: 10px 14px;
  border-top: 1px solid var(--line);
  color: var(--fg-muted);
  font-size: 12.5px;
  transition: background 120ms ease, color 120ms ease;
}
.row-action:hover { background: var(--bg-hover); color: var(--fg); }
.row-action-hint { margin-left: auto; font-family: var(--mono); font-size: 10.5px; color: var(--fg-faint); }

.form { display: flex; flex-direction: column; gap: 10px; padding: 12px 14px; border-bottom: 1px solid var(--line); background: var(--bg-subtle); }
.form-title { font-size: 12.5px; font-weight: 600; }
.form label { display: flex; flex-direction: column; gap: 4px; font-size: 11.5px; color: var(--fg-muted); }
.form-note { margin: 0; font-size: 11px; line-height: 1.5; color: var(--fg-faint); }
.form-error { font-size: 11px; color: var(--err); }
.form-error:empty { display: none; }
.form-actions { display: flex; justify-content: flex-end; gap: 6px; }

.empty { padding: 16px 14px; color: var(--fg-muted); font-size: 12px; line-height: 1.5; margin: 0; }

.setting { display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 10px 0; }
.setting + .setting { border-top: 1px solid var(--line); }
.setting > :first-child { flex: 1; min-width: 0; }
.setting .label { font-size: 12.5px; color: var(--fg); }
.setting .desc { font-size: 11px; color: var(--fg-muted); margin-top: 1px; line-height: 1.5; }
.meta { font-family: var(--mono); font-size: 10.5px; color: var(--fg-faint); word-break: break-all; padding-top: 12px; border-top: 1px solid var(--line); margin-top: 4px; line-height: 1.6; }

/* ---- small screens ---------------------------------------------------------
 * The root becomes a box the size of the *visual* viewport (updated from JS as
 * the keyboard opens/closes) so nothing hides behind the on-screen keyboard.
 * Inputs are 16px so iOS never zooms.
 */
@media (max-width: 640px) {
  .float {
    inset: auto;
    top: var(--vv-top, 0px);
    left: var(--vv-left, 0px);
    width: var(--vv-width, 100vw);
    height: var(--vv-height, 100dvh);
  }
  /* mode 1 */
  .float[data-mode="toolbar"] .popover { left: 8px; right: 8px; transform: none; max-width: none; padding-left: 12px; animation-name: pop-in-edge; }
  .float[data-mode="toolbar"] .popover .chrome-entry { flex: 1; max-width: none; }
  .float[data-mode="toolbar"] .panel-host { left: 8px; right: 8px; transform: none; }
  .float[data-mode="toolbar"] .panel { width: 100%; max-height: calc(var(--vv-height, 100dvh) - 140px); }
  /* mode 2 */
  .float[data-mode="float"][data-side="right"] .chrome-host,
  .float[data-mode="float"][data-side="left"] .chrome-host { inset: 0; top: 0; right: 0; left: 0; transform: none; display: block; }
  .rail { position: absolute; top: 50%; --rail-y: -50%; width: 44px; }
  .float[data-side="right"] .rail { right: max(12px, env(safe-area-inset-right)); }
  .float[data-side="left"] .rail { left: max(12px, env(safe-area-inset-left)); }
  .float[data-side="right"][data-tucked] .rail { --rail-x: 28px; }
  .float[data-side="left"][data-tucked] .rail { --rail-x: -28px; }
  .rail .rail-btn, .rail .status-slot { height: 44px; }
  .rail > :first-child, .rail > :last-child { height: 47px; }
  .float[data-mode="float"] .panel-host {
    position: absolute;
    top: calc(8px + env(safe-area-inset-top));
    bottom: calc(8px + env(safe-area-inset-bottom));
    left: max(8px, env(safe-area-inset-left));
    right: calc(max(12px, env(safe-area-inset-right)) + 44px + 8px);
    display: flex;
    align-items: flex-start;
    pointer-events: none;
  }
  .float[data-mode="float"][data-side="left"] .panel-host {
    left: calc(max(12px, env(safe-area-inset-left)) + 44px + 8px);
    right: max(8px, env(safe-area-inset-right));
  }
  .float[data-mode="float"] .panel { width: 100%; max-height: 100%; }
  /* mode 3 */
  .sheet { top: auto; left: 8px; right: 8px; bottom: 72px; width: auto; max-height: min(60%, 480px); }
  .sheet-handle { top: auto; bottom: 72px; transform: none; flex-direction: row; width: auto; padding: 0 14px; height: 40px; }
  .sheet-handle span { writing-mode: horizontal-tb; }
  .sheet-handle .status-slot { width: 28px; }
  .float[data-side="right"][data-sheet-collapsed] .sheet, .float[data-side="left"][data-sheet-collapsed] .sheet { transform: translateY(calc(100% + 24px)); }
  .tip::after, .tip::before { display: none; }

  .panel-body { -webkit-overflow-scrolling: touch; overscroll-behavior: contain; }
  .panel[data-panel="source"] { height: auto; }
  .input, .textarea, .select, .source-view { font-size: 16px; }
  .input, .select { min-height: 40px; }
  .btn { height: 38px; padding: 0 14px; font-size: 14px; }
  .btn-sm { height: 34px; padding: 0 12px; font-size: 13px; }
  .icon-btn { width: 40px; height: 40px; }
  .panel-head, .panel-foot, .sheet-head { min-height: 52px; }
  .list-item { padding: 12px 10px; }
  .list-item .title { font-size: 15px; }
  .row-action { padding: 14px; font-size: 14px; }
  .field-remove { opacity: 1; width: 28px; height: 28px; }
  .toggle-row { min-height: 40px; }
  .switch { width: 40px; height: 24px; }
  .switch::after { width: 20px; height: 20px; }
  [aria-checked="true"] > .switch::after { transform: translateX(16px); }
  .segmented button { height: 32px; padding: 0 14px; font-size: 13px; }
  .sheet-tabs button { height: 40px; font-size: 14px; }
  .form label, .form-note, .source-note { font-size: 13px; }
}
`;
