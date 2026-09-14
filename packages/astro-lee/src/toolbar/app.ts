import { defineToolbarApp } from "astro/toolbar";
import { api } from "./api";
import { mountLee, type LeeHandle } from "./lee";

const EDIT_KEY = "astro-lee:edit";

/**
 * The Astro Dev Toolbar "Edit" app. Toggling it on is the only way edit mode
 * starts: the page looks perfectly normal until then. Everything Lee draws
 * lives in this app's canvas, so Astro hides it all again when the app is off.
 */
let lee: LeeHandle | null = null;

/**
 * The server-side edit session: while it's on, an outside change to the entry
 * file doesn't reload the page (see `api.session`). Any API call refreshes its
 * 60 s TTL; this timer covers a long pause with a dirty draft.
 */
let keepAlive: number | null = null;
function setSession(editing: boolean) {
  if (keepAlive !== null) {
    window.clearInterval(keepAlive);
    keepAlive = null;
  }
  void api.session(editing).catch(() => {});
  if (editing) keepAlive = window.setInterval(() => void api.session(true).catch(() => {}), 30_000);
}

export default defineToolbarApp({
  init(canvas, app) {
    lee = mountLee(canvas, {
      requestOff: () => app.toggleState({ state: false }),
    });

    app.onToggled(({ state }) => {
      if (state) sessionStorage.setItem(EDIT_KEY, "1");
      else sessionStorage.removeItem(EDIT_KEY);
      setSession(state);
      void lee?.setEditing(state);
    });

    // Edit mode survives a full reload (e.g. you saved a file in your IDE).
    if (sessionStorage.getItem(EDIT_KEY) === "1") app.toggleState({ state: true });
  },

  /** Unsaved work is saved before edit mode closes; a failed save keeps it open. */
  async beforeTogglingOff() {
    return lee ? lee.beforeEditOff() : true;
  },
});
