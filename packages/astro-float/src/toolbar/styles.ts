export const STYLES = /* css */ `
:host {
  all: initial;
}

.float {
  --bg: #ffffff;
  --bg-subtle: #f6f7f9;
  --bg-hover: #eef0f3;
  --bg-active: #e6e8ec;
  --fg: #111318;
  --fg-muted: #6b7280;
  --fg-faint: #9ca3af;
  --line: rgba(17, 19, 24, 0.09);
  --line-strong: rgba(17, 19, 24, 0.16);
  --accent: #111318;
  --accent-fg: #ffffff;
  --focus: rgba(17, 19, 24, 0.14);
  --ok: #15803d;
  --warn: #b45309;
  --err: #b91c1c;
  --shadow: 0 1px 2px rgba(16, 18, 24, 0.05), 0 12px 32px -12px rgba(16, 18, 24, 0.18);
  --radius: 10px;
  --mono: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;

  position: fixed;
  top: 50%;
  transform: translateY(-50%);
  z-index: 2000000000;
  display: flex;
  align-items: center;
  gap: 8px;
  font: 13px/1.45 -apple-system, BlinkMacSystemFont, "Inter", "Segoe UI", system-ui, sans-serif;
  color: var(--fg);
  -webkit-font-smoothing: antialiased;
  letter-spacing: 0;
}
@media (prefers-color-scheme: dark) {
  .float {
    --bg: #16181d;
    --bg-subtle: #1b1e24;
    --bg-hover: #22262d;
    --bg-active: #2a2f37;
    --fg: #e7e9ee;
    --fg-muted: #9aa1ad;
    --fg-faint: #6b7280;
    --line: rgba(255, 255, 255, 0.08);
    --line-strong: rgba(255, 255, 255, 0.16);
    --accent: #e7e9ee;
    --accent-fg: #111318;
    --focus: rgba(255, 255, 255, 0.16);
    --ok: #4ade80;
    --warn: #fbbf24;
    --err: #f87171;
    --shadow: 0 1px 2px rgba(0, 0, 0, 0.4), 0 16px 40px -12px rgba(0, 0, 0, 0.6);
  }
}
.float[data-side="right"] { right: 12px; flex-direction: row-reverse; }
.float[data-side="left"] { left: 12px; flex-direction: row; }

.float *, .float *::before, .float *::after { box-sizing: border-box; }
/* :where() keeps these resets at class-level specificity so .btn/.switch etc. can override them. */
.float :where(button, input, select, textarea) {
  font: inherit;
  color: inherit;
  margin: 0;
}
.float :where(button) { cursor: pointer; background: none; border: 0; padding: 0; text-align: left; }
.float :focus-visible { outline: 2px solid var(--focus); outline-offset: 1px; }
.float :where(a) { color: inherit; text-decoration: none; }

/* ---- rail ---------------------------------------------------------------- */
.rail {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 2px;
  padding: 6px;
  background: var(--bg);
  border: 1px solid var(--line);
  border-radius: var(--radius);
  box-shadow: var(--shadow);
}
.rail-btn {
  position: relative;
  width: 28px;
  height: 28px;
  display: grid;
  place-items: center;
  border-radius: 7px;
  color: var(--fg-muted);
  transition: background 120ms ease, color 120ms ease;
}
.rail-btn:hover { background: var(--bg-hover); color: var(--fg); }
.rail-btn[aria-pressed="true"] { background: var(--bg-active); color: var(--fg); }
.rail-btn:disabled { opacity: 0.35; cursor: default; }
.rail-btn:disabled:hover { background: none; color: var(--fg-muted); }
.rail-sep { width: 16px; height: 1px; background: var(--line); margin: 4px 0; }

.rail-btn[data-tip]::after {
  content: attr(data-tip);
  position: absolute;
  top: 50%;
  transform: translateY(-50%);
  white-space: nowrap;
  padding: 4px 8px;
  border-radius: 6px;
  background: var(--fg);
  color: var(--bg);
  font-size: 11.5px;
  font-weight: 500;
  pointer-events: none;
  opacity: 0;
  transition: opacity 120ms ease 200ms;
}
.float[data-side="right"] .rail-btn[data-tip]::after { right: calc(100% + 10px); }
.float[data-side="left"] .rail-btn[data-tip]::after { left: calc(100% + 10px); }
.rail-btn[data-tip]:hover::after { opacity: 1; }

/* bottom slot: a quiet status dot, or the Save button when there's work to save */
.status-slot {
  width: 28px;
  height: 28px;
  margin-top: 4px;
  display: grid;
  place-items: center;
}
.status-dot {
  width: 6px;
  height: 6px;
  border-radius: 999px;
  background: var(--line-strong);
  transition: background 200ms ease;
}
.status-dot[data-state="dirty"] { background: var(--warn); }
.status-dot[data-state="saving"] { background: var(--fg-faint); animation: float-pulse 900ms ease-in-out infinite; }
.status-dot[data-state="saved"] { background: var(--ok); }
.status-dot[data-state="error"], .status-dot[data-state="conflict"] { background: var(--err); }
@keyframes float-pulse { 50% { opacity: 0.3; } }
.rail-save {
  position: relative;
  width: 28px;
  height: 28px;
  display: grid;
  place-items: center;
  border-radius: 7px;
  background: var(--accent);
  color: var(--accent-fg);
  animation: float-in 160ms ease;
}
.rail-save:hover { opacity: 0.88; }
@keyframes float-in { from { transform: scale(0.85); opacity: 0; } }
.rail-save[data-tip]::after {
  content: attr(data-tip);
  position: absolute;
  top: 50%;
  transform: translateY(-50%);
  white-space: nowrap;
  padding: 4px 8px;
  border-radius: 6px;
  background: var(--fg);
  color: var(--bg);
  font-size: 11.5px;
  font-weight: 500;
  pointer-events: none;
  opacity: 0;
  transition: opacity 120ms ease 200ms;
}
.float[data-side="right"] .rail-save[data-tip]::after { right: calc(100% + 10px); }
.float[data-side="left"] .rail-save[data-tip]::after { left: calc(100% + 10px); }
.rail-save[data-tip]:hover::after { opacity: 1; }

/* ---- panel --------------------------------------------------------------- */
.panel {
  width: 340px;
  max-height: min(680px, calc(100vh - 96px));
  display: flex;
  flex-direction: column;
  background: var(--bg);
  border: 1px solid var(--line);
  border-radius: var(--radius);
  box-shadow: var(--shadow);
  overflow: hidden;
}
.panel[data-panel="source"] { height: min(620px, calc(100vh - 96px)); }

.panel-head {
  display: flex;
  align-items: center;
  gap: 8px;
  min-height: 42px;
  padding: 0 8px 0 14px;
  border-bottom: 1px solid var(--line);
}
.panel-title { font-weight: 600; font-size: 12.5px; }
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
  min-height: 42px;
  padding: 6px 8px 6px 14px;
  border-top: 1px solid var(--line);
}
.foot-status { flex: 1; min-width: 0; font-size: 11.5px; color: var(--fg-muted); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.foot-status[data-tone="err"] { color: var(--err); }
.foot-status[data-tone="warn"] { color: var(--warn); }

/* ---- controls ------------------------------------------------------------ */
.icon-btn {
  width: 26px;
  height: 26px;
  display: grid;
  place-items: center;
  border-radius: 6px;
  color: var(--fg-muted);
}
.icon-btn:hover { background: var(--bg-hover); color: var(--fg); }

.btn {
  height: 28px;
  padding: 0 10px;
  border-radius: 6px;
  border: 1px solid var(--line-strong);
  background: var(--bg);
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
.btn-primary:hover { opacity: 0.9; background: var(--accent); }
.btn-sm { height: 24px; padding: 0 8px; font-size: 11.5px; }
.btn-ghost { border-color: transparent; }

.input, .textarea, .select {
  width: 100%;
  min-height: 28px;
  padding: 4px 8px;
  border: 1px solid var(--line-strong);
  border-radius: 6px;
  background: var(--bg);
  font-size: 12.5px;
  transition: border-color 120ms ease;
}
.input:hover, .textarea:hover, .select:hover { border-color: var(--fg-faint); }
.input:focus, .textarea:focus, .select:focus { border-color: var(--fg-faint); outline: 2px solid var(--focus); outline-offset: 0; }
.input[data-invalid], .textarea[data-invalid] { border-color: var(--err); }
.textarea { resize: vertical; line-height: 1.5; }
.textarea.mono { font-family: var(--mono); font-size: 12px; }
.select { appearance: none; padding-right: 24px; background-image: linear-gradient(45deg, transparent 50%, var(--fg-muted) 50%), linear-gradient(135deg, var(--fg-muted) 50%, transparent 50%); background-position: calc(100% - 13px) 12px, calc(100% - 9px) 12px; background-size: 4px 4px; background-repeat: no-repeat; }

.switch {
  position: relative;
  display: inline-block;
  width: 30px;
  height: 18px;
  border-radius: 999px;
  background: #cfd3da;
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
  transition: transform 150ms ease;
}
[aria-checked="true"] > .switch, .switch[aria-checked="true"] { background: var(--accent); }
[aria-checked="true"] > .switch::after, .switch[aria-checked="true"]::after { transform: translateX(12px); }
@media (prefers-color-scheme: dark) {
  .switch { background: #3a404b; }
  [aria-checked="true"] > .switch::after, .switch[aria-checked="true"]::after { background: var(--accent-fg); }
}
/* whole-row toggles: label on the left, switch on the right, click anywhere */
.toggle-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  width: 100%;
  border-radius: 6px;
}
.toggle-row:hover .switch:not([aria-checked="true"]) { background: #c2c7cf; }
[aria-checked="true"].toggle-row:hover .switch { opacity: 0.9; }

.segmented { display: inline-flex; padding: 2px; border-radius: 7px; background: var(--bg-subtle); border: 1px solid var(--line); }
.segmented button { height: 22px; padding: 0 10px; border-radius: 5px; font-size: 11.5px; font-weight: 500; color: var(--fg-muted); display: inline-flex; align-items: center; gap: 6px; }
.segmented button[aria-pressed="true"] { background: var(--bg); color: var(--fg); box-shadow: 0 1px 2px rgba(0, 0, 0, 0.06); }

/* ---- source (read-only escape hatch) ------------------------------------- */
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
.source-note code { font-family: var(--mono); font-size: 10.5px; background: var(--bg); border: 1px solid var(--line); border-radius: 4px; padding: 0 4px; }
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

/* ---- fields -------------------------------------------------------------- */
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

/* ---- media --------------------------------------------------------------- */
.dropzone {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 6px;
  padding: 22px 12px;
  border: 1px dashed var(--line-strong);
  border-radius: 8px;
  color: var(--fg-muted);
  font-size: 12px;
  text-align: center;
  cursor: pointer;
  transition: border-color 120ms ease, background 120ms ease;
}
.dropzone:hover, .dropzone[data-dragging] { border-color: var(--fg-faint); background: var(--bg-subtle); color: var(--fg); }
.dropzone strong { font-weight: 500; color: var(--fg); }
.media-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 8px; margin-top: 12px; }
.media-item { display: flex; flex-direction: column; gap: 4px; text-align: left; min-width: 0; }
.media-item img { width: 100%; aspect-ratio: 1; object-fit: cover; border-radius: 6px; border: 1px solid var(--line); background: var(--bg-subtle); display: block; }
.media-item:hover img { border-color: var(--fg-faint); }
.media-item span { font-family: var(--mono); font-size: 10.5px; color: var(--fg-muted); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }

/* ---- lists --------------------------------------------------------------- */
.list { display: flex; flex-direction: column; padding: 6px; }
.list-item {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 7px 8px;
  border-radius: 7px;
  min-width: 0;
}
.list-item:hover { background: var(--bg-hover); }
.list-item[aria-current="page"] { background: var(--bg-subtle); }
.list-item .title { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 12.5px; }
.list-item .id { font-family: var(--mono); font-size: 10.5px; color: var(--fg-faint); white-space: nowrap; }
.list-item svg { color: var(--fg-faint); flex: none; }
.list-item:hover svg { color: var(--fg-muted); }

.toolbar-row { display: flex; align-items: center; gap: 8px; padding: 10px 14px; border-bottom: 1px solid var(--line); }
.toolbar-row .grow { flex: 1; min-width: 0; }
.section-label { font-size: 11px; font-weight: 600; letter-spacing: 0.04em; text-transform: uppercase; color: var(--fg-faint); padding: 10px 14px 4px; }

.form { display: flex; flex-direction: column; gap: 10px; padding: 12px 14px; border-bottom: 1px solid var(--line); background: var(--bg-subtle); }
.form label { display: flex; flex-direction: column; gap: 4px; font-size: 11.5px; color: var(--fg-muted); }
.form-actions { display: flex; justify-content: flex-end; gap: 6px; }

.empty { padding: 18px 14px; color: var(--fg-muted); font-size: 12px; line-height: 1.5; }
.empty code { font-family: var(--mono); font-size: 11px; background: var(--bg-subtle); border: 1px solid var(--line); border-radius: 4px; padding: 1px 4px; }

.setting { display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 10px 0; }
.setting + .setting { border-top: 1px solid var(--line); }
.setting > :first-child { flex: 1; min-width: 0; }
.setting .label { font-size: 12.5px; color: var(--fg); }
.setting .desc { font-size: 11px; color: var(--fg-muted); margin-top: 1px; }
.meta { font-family: var(--mono); font-size: 10.5px; color: var(--fg-faint); word-break: break-all; padding-top: 12px; border-top: 1px solid var(--line); margin-top: 4px; }
`;
