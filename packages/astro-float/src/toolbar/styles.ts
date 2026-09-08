export const STYLES = /* css */ `
:host {
  all: initial;
}

/*
 * Cool neutral grays, one hairline weight, one radius, tight 12–13px type.
 * Nothing shouts: labels are muted, controls are quiet until hovered, the only
 * strong element is the primary Save.
 */
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
  --radius: 6px;
  --mono: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;

  /* A viewport-sized, click-through layer; the sidebar positions itself inside. */
  position: fixed;
  inset: 0;
  z-index: 2000000000;
  pointer-events: none;
  font: 13px/1.45 -apple-system, BlinkMacSystemFont, "Inter", "Segoe UI", system-ui, sans-serif;
  color: var(--fg);
  color-scheme: dark;
  -webkit-font-smoothing: antialiased;
  letter-spacing: -0.005em;
  font-feature-settings: "cv11", "ss01";
}

.float *, .float *::before, .float *::after { box-sizing: border-box; }
.float :where(button, input, select, textarea) { font: inherit; color: inherit; margin: 0; letter-spacing: inherit; }
.float :where(button) { cursor: pointer; background: none; border: 0; padding: 0; text-align: left; }
.float :focus-visible { outline: 1px solid var(--line-focus); outline-offset: 1px; }
.float :where(a) { color: inherit; text-decoration: none; }
.float svg { flex: none; }
.muted { color: var(--fg-muted); }
.mono { font-family: var(--mono); font-size: 11px; letter-spacing: 0; }

/* ---- the sidebar: a flush column on the right edge ------------------------ */
.sidebar {
  position: absolute;
  top: 0;
  right: 0;
  bottom: 0;
  width: 300px;
  display: flex;
  flex-direction: column;
  overflow-y: auto;
  overflow-x: hidden;
  pointer-events: auto;
  background: var(--bg);
  border-left: 1px solid var(--line);
  animation: sidebar-in 160ms ease;
  overscroll-behavior: contain;
  /* Scroll, but never show a bar that would change the content width. */
  scrollbar-width: none;
  -ms-overflow-style: none;
  transition: transform 200ms cubic-bezier(0.2, 0, 0, 1), opacity 140ms ease;
}
.sidebar::-webkit-scrollbar { display: none; }
@keyframes sidebar-in { from { opacity: 0; transform: translateX(8px); } }
.float[data-panel-hidden] .sidebar { transform: translateX(100%); opacity: 0; pointer-events: none; }

/* Hidden sidebar: a small tab flush to the edge brings it back and keeps status / Save in view. */
.sb-tab {
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
  pointer-events: none;
  opacity: 0;
  transition: transform 200ms cubic-bezier(0.2, 0, 0, 1) 40ms, opacity 140ms ease 40ms;
}
.float[data-panel-hidden] .sb-tab { transform: translate(0, -50%); opacity: 1; pointer-events: auto; }
.sb-tab-open { width: 26px; height: 26px; display: grid; place-items: center; border-radius: 4px; color: var(--fg-muted); }
.sb-tab-open:hover { background: var(--bg-hover); color: var(--fg); }
.sb-tab-status { display: grid; place-items: center; min-height: 10px; }
.sb-tab-status .status-slot { min-width: 0; min-height: 0; padding: 2px 0; }
.sb-tab-status .btn-primary { width: 26px; height: 26px; padding: 0; justify-content: center; border-radius: 4px; }
.sb-tab-status .btn-primary span, .sb-tab-status .btn-discard { display: none; }
.sb-tab-status .status-dot { margin: 6px 0; }

.sb-head {
  position: sticky;
  top: 0;
  z-index: 2;
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: 10px 10px 10px 16px;
  background: var(--bg);
  border-bottom: 1px solid var(--line);
}
.sb-title { display: flex; align-items: center; gap: 8px; min-width: 0; height: 24px; }
.sb-entry { flex: 1; min-width: 0; font-family: var(--mono); font-size: 11px; letter-spacing: 0; color: var(--fg-muted); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.icon-btn { width: 24px; height: 24px; display: grid; place-items: center; border-radius: 4px; color: var(--fg-faint); }
.icon-btn:hover { background: var(--bg-hover); color: var(--fg); }
.sb-status { display: flex; align-items: center; gap: 8px; min-height: 24px; padding-right: 6px; }
.foot-status { flex: 1; min-width: 0; font-size: 12px; color: var(--fg-muted); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.foot-status[data-tone="err"] { color: var(--err); }
.foot-status[data-tone="warn"] { color: var(--warn); }
.foot-actions { display: flex; align-items: center; gap: 4px; }
.status-slot { display: flex; align-items: center; gap: 4px; min-width: 12px; min-height: 12px; justify-content: center; }
.status-dot { width: 6px; height: 6px; border-radius: 999px; background: var(--line-strong); transition: background 200ms ease; }
.status-dot[hidden] { display: none; }
.status-dot[data-state="dirty"] { background: var(--warn); }
.status-dot[data-state="saving"] { background: var(--fg-faint); animation: float-pulse 900ms ease-in-out infinite; }
.status-dot[data-state="saved"] { background: var(--ok); }
.status-dot[data-state="error"], .status-dot[data-state="conflict"] { background: var(--err); }
@keyframes float-pulse { 50% { opacity: 0.3; } }

.sb-section { padding: 6px 0 12px; border-bottom: 1px solid var(--line); }
.sb-section[hidden] { display: none; }
.sb-heading {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
  min-height: 32px;
  margin: 0;
  padding: 4px 16px 2px;
  font-size: 12px;
  font-weight: 500;
  letter-spacing: 0;
  text-transform: none;
  color: var(--fg-muted);
}
.sb-heading-row { justify-content: space-between; padding-right: 10px; }
.sb-heading-aside { display: flex; align-items: center; gap: 6px; min-width: 0; }
.collection-name { font-family: var(--mono); font-size: 11px; letter-spacing: 0; color: var(--fg); }
.sb-details { border-bottom: 0; }
.sb-details summary { cursor: pointer; list-style: none; }
.sb-details summary::-webkit-details-marker { display: none; }
.sb-details summary::after { content: ""; width: 14px; height: 14px; margin-left: auto; margin-right: -2px; background: currentColor; opacity: 0.6; -webkit-mask: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='black' stroke-width='1.75' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='m9 18 6-6-6-6'/%3E%3C/svg%3E") center / contain no-repeat; mask: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='black' stroke-width='1.75' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='m9 18 6-6-6-6'/%3E%3C/svg%3E") center / contain no-repeat; transition: transform 150ms ease; }
.sb-details[open] summary::after { transform: rotate(90deg); }
.sb-details summary:hover { color: var(--fg); }
.sb-details-body { padding: 0 16px 8px; }

/* ---- controls ------------------------------------------------------------- */
.btn {
  height: 28px;
  padding: 0 10px;
  border-radius: var(--radius);
  border: 1px solid var(--line-strong);
  background: var(--bg-elev);
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
.btn[hidden] { display: none; }
.btn-primary { background: var(--accent); color: var(--accent-fg); border-color: var(--accent); animation: float-in 160ms ease; }
.btn-primary:hover { background: #fff; border-color: #fff; }
.btn-sm { height: 24px; padding: 0 8px; font-size: 11.5px; }
.btn-ghost { border-color: transparent; background: none; color: var(--fg-muted); }
.btn-ghost:hover { background: var(--bg-hover); border-color: transparent; color: var(--fg); }
.btn-icon { width: 28px; padding: 0; }
@keyframes float-in { from { opacity: 0; } }

.input, .textarea, .select {
  width: 100%;
  min-height: 28px;
  padding: 4px 8px;
  border: 1px solid var(--line-strong);
  border-radius: var(--radius);
  background: var(--bg-input);
  font-size: 12.5px;
  color: var(--fg);
  transition: border-color 120ms ease, box-shadow 120ms ease;
}
.input::placeholder, .textarea::placeholder { color: var(--fg-faint); }
.input:hover, .textarea:hover, .select:hover { border-color: var(--line-focus); }
.input:focus, .textarea:focus, .select:focus { border-color: var(--line-focus); outline: none; box-shadow: 0 0 0 1px var(--line-focus); }
.input[data-invalid], .textarea[data-invalid] { border-color: var(--err); box-shadow: none; }
.date-field { display: flex; align-items: center; justify-content: space-between; gap: 8px; text-align: left; cursor: pointer; }
.date-field svg { color: var(--fg-faint); }
.date-field:hover svg { color: var(--fg-muted); }
.date-field[data-float-open] { border-color: var(--line-focus); box-shadow: 0 0 0 1px var(--line-focus); }
.date-field[data-iso=""] .date-field-label { color: var(--fg-faint); }
.textarea { resize: vertical; line-height: 1.5; }
.textarea.mono { font-family: var(--mono); font-size: 12px; }
.select {
  appearance: none;
  padding-right: 24px;
  background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='%238b93a1' stroke-width='1.75' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='m6 9 6 6 6-6'/%3E%3C/svg%3E");
  background-position: right 7px center;
  background-size: 12px 12px;
  background-repeat: no-repeat;
}
.select-inline { width: auto; min-height: 24px; height: 24px; padding: 0 22px 0 8px; font-family: var(--mono); font-size: 11px; letter-spacing: 0; background-color: transparent; border-color: transparent; }
.select-inline:hover { border-color: var(--line-strong); }

.switch {
  position: relative;
  display: inline-block;
  width: 28px;
  height: 16px;
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
  width: 12px;
  height: 12px;
  border-radius: 999px;
  background: var(--fg-muted);
  transition: transform 150ms ease, background 150ms ease;
}
[aria-checked="true"] > .switch { background: var(--accent); }
[aria-checked="true"] > .switch::after { transform: translateX(12px); background: var(--accent-fg); }
.toggle-row { display: flex; align-items: center; justify-content: space-between; gap: 12px; border-radius: 4px; }
.toggle-row:hover .switch:not([aria-checked="true"]) { background: var(--line-focus); }

/* ---- fields --------------------------------------------------------------- */
.fields { display: flex; flex-direction: column; gap: 10px; padding: 2px 16px 0; }
.field { display: flex; flex-direction: column; gap: 4px; }
.field-head { display: flex; align-items: center; gap: 6px; min-height: 20px; }
.field-key { font-size: 12px; color: var(--fg-muted); flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.field-meta { font-size: 10.5px; color: var(--fg-faint); }
.field-remove { width: 20px; height: 20px; display: grid; place-items: center; border-radius: 4px; color: var(--fg-faint); opacity: 0; transition: opacity 120ms ease; }
.field:hover .field-remove, .field-remove:focus-visible { opacity: 1; }
.field-remove:hover { background: var(--bg-hover); color: var(--fg); }
.field-static { color: var(--fg-muted); padding: 4px 0; }
.field-revert { width: 20px; height: 20px; display: grid; place-items: center; border-radius: 4px; color: var(--warn); }
.field-revert[hidden] { display: none; }
.field-revert:hover { background: var(--bg-hover); }
.field-note { font-size: 11px; line-height: 1.45; color: var(--warn); }
.field-note:empty { display: none; }
.field-removed .field-key { text-decoration: line-through; color: var(--fg-faint); }
.field[data-kind="boolean"] .field-head { min-height: 24px; }
.field[data-kind="boolean"] .toggle-row { width: auto; }
.field-add { display: flex; gap: 6px; padding: 12px 16px 0; margin-top: 2px; }
.field-add .input { min-height: 28px; }

/* ---- lists / collection --------------------------------------------------- */
.list { display: flex; flex-direction: column; padding: 0 8px; }
.list-item { display: flex; align-items: center; gap: 8px; height: 30px; padding: 0 8px; border-radius: 4px; min-width: 0; width: 100%; color: var(--fg); font-size: 12.5px; }
.list-item:hover { background: var(--bg-hover); }
.list-item[aria-current="page"] { background: var(--bg-elev); }
.list-item .title { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.list-item svg { color: var(--fg-faint); }
.list-action { color: var(--fg-muted); margin-top: 2px; }
.list-action:first-of-type { margin-top: 0; }
.list-action:hover { color: var(--fg); }
.list-action svg { color: var(--fg-faint); }
.list-action:hover svg { color: var(--fg-muted); }
.list-item + .list-action { margin-top: 6px; position: relative; }
.list-item + .list-action::before { content: ""; position: absolute; left: 8px; right: 8px; top: -4px; border-top: 1px solid var(--line); }

.form { display: flex; flex-direction: column; gap: 10px; margin: 4px 16px 10px; padding: 12px; border: 1px solid var(--line-strong); border-radius: var(--radius); background: var(--bg-elev); }
.form-title { font-size: 12.5px; font-weight: 500; }
.form label { display: flex; flex-direction: column; gap: 5px; font-size: 11.5px; color: var(--fg-muted); }
.form-note { margin: 0; font-size: 11px; line-height: 1.5; color: var(--fg-faint); }
.form-error { font-size: 11px; color: var(--err); }
.form-error:empty { display: none; }
.form-actions { display: flex; justify-content: flex-end; gap: 6px; }

.empty { padding: 4px 16px 8px; color: var(--fg-muted); font-size: 12px; line-height: 1.5; margin: 0; }
.empty code { font-family: var(--mono); font-size: 10.5px; background: var(--bg-elev); border: 1px solid var(--line-strong); border-radius: 4px; padding: 0 4px; letter-spacing: 0; }

.setting { display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 10px 0; }
.setting + .setting { border-top: 1px solid var(--line); }
.setting > :first-child { flex: 1; min-width: 0; }
.setting .label { font-size: 12.5px; color: var(--fg); }
.setting .desc { font-size: 11px; color: var(--fg-muted); margin-top: 2px; line-height: 1.55; }
.meta { font-family: var(--mono); font-size: 10.5px; letter-spacing: 0; color: var(--fg-faint); word-break: break-all; padding-top: 12px; border-top: 1px solid var(--line); margin-top: 4px; line-height: 1.6; }

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
  .sidebar { top: auto; left: 0; right: 0; bottom: 0; width: auto; max-height: min(60%, 520px); padding-bottom: 56px; border-left: 0; border-top: 1px solid var(--line); border-radius: 10px 10px 0 0; animation-name: sheet-up; -webkit-overflow-scrolling: touch; }
  @keyframes sheet-up { from { opacity: 0; transform: translateY(8px); } }
  .float[data-panel-hidden] .sidebar { transform: translateY(100%); }
  .sb-tab { top: auto; bottom: 64px; transform: translate(100%, 0); }
  .float[data-panel-hidden] .sb-tab { transform: translate(0, 0); }
  .input, .textarea, .select { font-size: 16px; }
  .input, .select { min-height: 40px; }
  .select-inline { min-height: 32px; height: 32px; font-size: 13px; }
  .btn { height: 38px; padding: 0 14px; font-size: 14px; }
  .btn-icon { width: 40px; padding: 0; }
  .btn-sm { height: 32px; padding: 0 12px; font-size: 13px; }
  .icon-btn { width: 32px; height: 32px; }
  .sb-title { height: 32px; }
  .list-item { height: 44px; padding: 0 10px; font-size: 15px; }
  .field-key { font-size: 13px; }
  .field-remove { opacity: 1; width: 28px; height: 28px; }
  .toggle-row { min-height: 40px; }
  .switch { width: 40px; height: 24px; }
  .switch::after { width: 20px; height: 20px; }
  [aria-checked="true"] > .switch::after { transform: translateX(16px); }
  .form label, .form-note { font-size: 13px; }
}
`;
