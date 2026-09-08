export const STYLES = /* css */ `
:host {
  all: initial;
}

/* Palette lifted from the Astro dev toolbar so the sidebar reads as a sibling of the bottom pill. */
.float {
  --bg: #13151a;
  --bg-subtle: #1a1d24;
  --bg-hover: rgba(255, 255, 255, 0.08);
  --bg-active: rgba(71, 78, 94, 1);
  --fg: #eef0f4;
  --fg-muted: #9aa1ad;
  --fg-faint: #6b7280;
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
  --mono: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;

  /* A viewport-sized, click-through layer; the sidebar positions itself inside. */
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

.float *, .float *::before, .float *::after { box-sizing: border-box; }
.float :where(button, input, select, textarea) { font: inherit; color: inherit; margin: 0; }
.float :where(button) { cursor: pointer; background: none; border: 0; padding: 0; text-align: left; }
.float :focus-visible { outline: 2px solid var(--focus); outline-offset: 1px; }
.float :where(a) { color: inherit; text-decoration: none; }
.muted { color: var(--fg-muted); }
.mono { font-family: var(--mono); font-size: 11px; }

/* ---- the sidebar ---------------------------------------------------------- */
.sidebar {
  position: absolute;
  top: 16px;
  right: 16px;
  bottom: 16px;
  width: 320px;
  display: flex;
  flex-direction: column;
  overflow: auto;
  pointer-events: auto;
  background: var(--bg);
  border: 1px solid var(--line);
  border-radius: 12px;
  box-shadow: var(--shadow);
  animation: sidebar-in 180ms ease;
  overscroll-behavior: contain;
}
@keyframes sidebar-in { from { opacity: 0; transform: translateX(8px); } }

.sb-head {
  position: sticky;
  top: 0;
  z-index: 2;
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 12px 14px 10px;
  background: var(--bg);
  border-bottom: 1px solid var(--line);
}
.sb-title { display: flex; align-items: baseline; gap: 8px; min-width: 0; }
.sb-label { font-size: 10.5px; font-weight: 600; letter-spacing: 0.06em; text-transform: uppercase; color: var(--fg-faint); }
.sb-entry { flex: 1; min-width: 0; font-family: var(--mono); font-size: 11px; color: var(--fg-muted); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.sb-status { display: flex; align-items: center; gap: 8px; min-height: 26px; }
.foot-status { flex: 1; min-width: 0; font-size: 11.5px; color: var(--fg-muted); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.foot-status[data-tone="err"] { color: var(--err); }
.foot-status[data-tone="warn"] { color: var(--warn); }
.foot-actions { display: flex; align-items: center; gap: 6px; }
.status-slot { display: grid; place-items: center; min-width: 12px; min-height: 12px; }
.status-dot { width: 6px; height: 6px; border-radius: 999px; background: var(--line-strong); transition: background 200ms ease; }
.status-dot[hidden] { display: none; }
.status-dot[data-state="dirty"] { background: var(--warn); }
.status-dot[data-state="saving"] { background: var(--fg-faint); animation: float-pulse 900ms ease-in-out infinite; }
.status-dot[data-state="saved"] { background: var(--ok); }
.status-dot[data-state="error"], .status-dot[data-state="conflict"] { background: var(--err); }
@keyframes float-pulse { 50% { opacity: 0.3; } }

.sb-section { padding: 6px 0 10px; border-bottom: 1px solid var(--line); }
.sb-section[hidden] { display: none; }
.sb-heading {
  display: flex;
  align-items: baseline;
  gap: 8px;
  margin: 0;
  padding: 8px 14px 4px;
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 0.05em;
  text-transform: uppercase;
  color: var(--fg-faint);
}
.sb-hint { font-size: 10.5px; font-weight: 400; letter-spacing: 0; text-transform: none; color: var(--fg-faint); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.sb-section .field, .sb-section .field-add { margin: 0 14px; }
.sb-details { border-bottom: 0; }
.sb-details summary { cursor: pointer; list-style: none; }
.sb-details summary::-webkit-details-marker { display: none; }
.sb-details summary::after { content: "+"; margin-left: auto; font-weight: 400; color: var(--fg-faint); }
.sb-details[open] summary::after { content: "–"; }
.sb-details-body { padding: 0 14px 8px; }

/* ---- controls ------------------------------------------------------------- */
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
.btn[hidden] { display: none; }
.btn-primary { background: var(--accent); color: var(--accent-fg); border-color: var(--accent); animation: float-in 160ms ease; }
.btn-primary:hover { background: #fff; }
.btn-sm { height: 24px; padding: 0 8px; font-size: 11.5px; }
.btn-ghost { border-color: transparent; background: none; }
@keyframes float-in { from { opacity: 0; } }

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
.field-static { color: var(--fg-muted); padding: 4px 0; }
.field .toggle-row { padding: 2px 0; }
.field-add { display: flex; gap: 6px; padding-top: 10px; margin-top: 4px; border-top: 1px solid var(--line); }

/* ---- lists / collection --------------------------------------------------- */
.list { display: flex; flex-direction: column; padding: 4px 6px; }
.list-item { display: flex; align-items: center; gap: 10px; padding: 7px 8px; border-radius: 7px; min-width: 0; }
.list-item:hover { background: var(--bg-hover); }
.list-item[aria-current="page"] { background: rgba(255, 255, 255, 0.05); }
.list-item .title { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 12.5px; }
.list-item .id { font-family: var(--mono); font-size: 10.5px; color: var(--fg-faint); white-space: nowrap; }
.list-item svg { color: var(--fg-faint); flex: none; }
.list-item:hover svg { color: var(--fg-muted); }

.toolbar-row { display: flex; align-items: center; gap: 8px; padding: 6px 14px 10px; }
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

.form { display: flex; flex-direction: column; gap: 10px; padding: 12px 14px; border-top: 1px solid var(--line); border-bottom: 1px solid var(--line); background: var(--bg-subtle); }
.form-title { font-size: 12.5px; font-weight: 600; }
.form label { display: flex; flex-direction: column; gap: 4px; font-size: 11.5px; color: var(--fg-muted); }
.form-note { margin: 0; font-size: 11px; line-height: 1.5; color: var(--fg-faint); }
.form-error { font-size: 11px; color: var(--err); }
.form-error:empty { display: none; }
.form-actions { display: flex; justify-content: flex-end; gap: 6px; }

.empty { padding: 8px 14px; color: var(--fg-muted); font-size: 12px; line-height: 1.5; margin: 0; }
.empty code { font-family: var(--mono); font-size: 10.5px; background: rgba(255, 255, 255, 0.06); border: 1px solid var(--line); border-radius: 4px; padding: 0 4px; }

.setting { display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 10px 0; }
.setting + .setting { border-top: 1px solid var(--line); }
.setting > :first-child { flex: 1; min-width: 0; }
.setting .label { font-size: 12.5px; color: var(--fg); }
.setting .desc { font-size: 11px; color: var(--fg-muted); margin-top: 1px; line-height: 1.5; }
.meta { font-family: var(--mono); font-size: 10.5px; color: var(--fg-faint); word-break: break-all; padding-top: 12px; border-top: 1px solid var(--line); margin-top: 4px; line-height: 1.6; }

/* ---- small screens ---------------------------------------------------------
 * The root becomes a box the size of the *visual* viewport (updated from JS as
 * the keyboard opens/closes) and the sidebar becomes a bottom sheet above the
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
  .sidebar { top: auto; left: 8px; right: 8px; bottom: 72px; width: auto; max-height: min(60%, 520px); animation-name: sheet-up; }
  @keyframes sheet-up { from { opacity: 0; transform: translateY(8px); } }
  .sidebar { -webkit-overflow-scrolling: touch; }
  .input, .textarea, .select { font-size: 16px; }
  .input, .select { min-height: 40px; }
  .btn { height: 38px; padding: 0 14px; font-size: 14px; }
  .btn-sm { height: 32px; padding: 0 12px; font-size: 13px; }
  .list-item { padding: 12px 10px; }
  .list-item .title { font-size: 15px; }
  .row-action { padding: 14px; font-size: 14px; }
  .field-remove { opacity: 1; width: 28px; height: 28px; }
  .toggle-row { min-height: 40px; }
  .switch { width: 40px; height: 24px; }
  .switch::after { width: 20px; height: 20px; }
  [aria-checked="true"] > .switch::after { transform: translateX(16px); }
  .form label, .form-note { font-size: 13px; }
}
`;
