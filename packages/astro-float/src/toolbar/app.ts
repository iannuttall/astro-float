import { defineToolbarApp } from "astro/toolbar";
import { mountFloat, type FloatHandle } from "./float";

const EDIT_KEY = "astro-float:edit";

/**
 * The Astro Dev Toolbar "Edit" app. Toggling it on is the only way edit mode
 * starts: the page looks perfectly normal until then. Everything Float draws
 * lives in this app's canvas, so Astro hides it all again when the app is off.
 */
let float: FloatHandle | null = null;

export default defineToolbarApp({
  init(canvas, app) {
    float = mountFloat(canvas, {
      requestOff: () => app.toggleState({ state: false }),
    });

    app.onToggled(({ state }) => {
      if (state) sessionStorage.setItem(EDIT_KEY, "1");
      else sessionStorage.removeItem(EDIT_KEY);
      void float?.setEditing(state);
    });

    // Edit mode survives a full reload (e.g. you saved a file in your IDE).
    if (sessionStorage.getItem(EDIT_KEY) === "1") app.toggleState({ state: true });
  },

  /** Unsaved work is saved before edit mode closes; a failed save keeps it open. */
  async beforeTogglingOff() {
    return float ? float.beforeEditOff() : true;
  },
});
