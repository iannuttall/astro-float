import { defineToolbarApp } from "astro/toolbar";
import { mountFloat } from "./float";

const OPEN_KEY = "astro-float:open";

export default defineToolbarApp({
  init(canvas, app) {
    const float = mountFloat(canvas);

    app.onToggled(({ state }) => float.setOpen(state));

    // Survive full reloads (e.g. you edited a file in your IDE): if the float was
    // open before, open it again.
    if (sessionStorage.getItem(OPEN_KEY) === "1") {
      app.toggleState({ state: true });
    }
  },
});
