export const STYLES = /* css */ `
:host {
  all: initial;
}

/* Palette lifted from the Astro dev toolbar so the rail reads as a sibling of the bottom pill. */
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

  position: fixed;
  top: 50%;
  transform: translateY(-50%);
  z-index: 2000000000;
  display: flex;
  align-items: center;
  gap: 10px;
  font: 13px/1.45 system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
  color: var(--fg);
  color-scheme: dark;
  -webkit-font-smoothing: antialiased;
  letter-spacing: 0;
}
.float[data-side="right"] { right: 16px; flex-direction: row-reverse; }
.float[data-side="left"] { left: 16px; flex-direction: row; }

.float *, .float *::before, .float *::after { box-sizing: border-box; }
.float :where(button, input, select, textarea) { font: inherit; color: inherit; margin: 0; }
.float :where(button) { cursor: pointer; background: none; border: 0; padding: 0; text-align: left; }
.float :focus-visible { outline: 2px solid var(--focus); outline-offset: 1px; }
.float :where(a) { color: inherit; text-decoration: none; }
.muted { color: var(--fg-muted); }
.mono { font-family: var(--mono); font-size: 11px; }

/* ---- rail: a vertical Astro pill ------------------------------------------ */
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
  transition: transform 0.35s var(--ease-pop);
}
/* Slide in from the edge on mount; nudge out a little further on hover, like the bottom bar. */
.float[data-side="right"]:not([data-entered]) .rail { transform: translateX(calc(100% + 24px)); }
.float[data-side="left"]:not([data-entered]) .rail { transform: translateX(calc(-100% - 24px)); }
.float[data-side="right"][data-entered] .rail:hover { transform: translateX(-3px); }
.float[data-side="left"][data-entered] .rail:hover { transform: translateX(3px); }

.rail-btn, .status-slot {
  position: relative;
  width: 100%;
  height: 36px;
  display: grid;
  place-items: center;
  color: var(--icon);
  transition: background 120ms ease, color 120ms ease, opacity 200ms ease-out;
}
.rail > :first-child { border-top-left-radius: 9999px; border-top-right-radius: 9999px; padding-top: 3px; height: 39px; }
.rail > :last-child { border-bottom-left-radius: 9999px; border-bottom-right-radius: 9999px; padding-bottom: 3px; height: 39px; }
.rail-btn:hover, .rail-btn:focus-visible { background: var(--bg-hover); color: #fff; outline-offset: -3px; }
.rail-btn[aria-pressed="true"] { background: var(--bg-active); color: #fff; }
.rail-btn:disabled { opacity: 0.3; cursor: default; }
.rail-btn:disabled:hover { background: none; color: var(--icon); }
.rail-sep { display: block; height: 1px; background: var(--line); }

/* Astro-style tooltip: dark rounded label with a caret pointing at the icon. */
.tip::after {
  content: attr(data-tip);
  position: absolute;
  top: 50%;
  transform: translateY(-50%);
  white-space: nowrap;
  padding: 4px 9px;
  border-radius: 4px;
  background: #13151a;
  border: 1px solid var(--line);
  color: #fff;
  font-size: 15px;
  line-height: 1.3;
  pointer-events: none;
  user-select: none;
  opacity: 0;
  transition: opacity 0.2s ease-in-out 0s;
}
.tip::before {
  content: "";
  position: absolute;
  top: 50%;
  transform: translateY(-50%);
  border: 5px solid transparent;
  pointer-events: none;
  opacity: 0;
  transition: opacity 0.2s ease-in-out 0s;
}
.float[data-side="right"] .tip::after { right: calc(100% + 13px); }
.float[data-side="right"] .tip::before { right: calc(100% + 3px); border-left-color: var(--line); }
.float[data-side="left"] .tip::after { left: calc(100% + 13px); }
.float[data-side="left"] .tip::before { left: calc(100% + 3px); border-right-color: var(--line); }
.tip:hover::after, .tip:hover::before, .tip:focus-visible::after, .tip:focus-visible::before {
  opacity: 1;
  transition-delay: 200ms;
}
.rail-btn:disabled::after, .rail-btn:disabled::before { opacity: 0 !important; }

/* Bottom slot: a quiet status dot, or the Save button when there's work to save. */
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

/* ---- panel ---------------------------------------------------------------- */
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
}
.float[data-side="left"] .panel { animation-name: panel-in-left; }
@keyframes panel-in { from { opacity: 0; transform: translateX(8px); } }
@keyframes panel-in-left { from { opacity: 0; transform: translateX(-8px); } }
.panel[data-panel="source"] { height: min(620px, calc(100vh - 96px)); }

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
.toggle-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  width: 100%;
  border-radius: 6px;
}
.toggle-row:hover .switch:not([aria-checked="true"]) { background: #454b57; }

.segmented { display: inline-flex; padding: 2px; border-radius: 8px; background: rgba(255, 255, 255, 0.04); border: 1px solid var(--line); }
.segmented button { height: 22px; padding: 0 10px; border-radius: 6px; font-size: 11.5px; font-weight: 500; color: var(--fg-muted); display: inline-flex; align-items: center; gap: 6px; }
.segmented button[aria-pressed="true"] { background: var(--bg-active); color: #fff; }

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
  min-height: 0;
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
`;
