/**
 * Lee without the dev server: the same pill, panel and on-page editors,
 * mounted straight onto a page and talking to an API you host (the routes
 * `server/api.js` answers in `astro dev`, served from `apiBase`). Edit mode is
 * on for as long as the page is open.
 *
 *   import { mountHostedLee } from "astro-lee/hosted";
 *   mountHostedLee({ apiBase: "/admin/lee/api" });
 */
import type { EntryDoc } from "./toolbar/api";
import { setApiBase } from "./toolbar/api";
import { mountLee, type LeeHandle, type LeeHost } from "./toolbar/lee";

export type { EntryDoc };

export interface HostedOptions {
  apiBase: string;
  /** Buttons for a saved, clean entry, such as Publish (see `LeeHost.entryActions`). */
  entryActions?: LeeHost["entryActions"];
  /** A link in the popover's footer back to your own page, such as `{ label: "All posts", href: "/admin" }`. */
  home?: LeeHost["home"];
}

export function mountHostedLee(options: HostedOptions): LeeHandle {
  setApiBase(options.apiBase);
  const host = document.createElement("div");
  host.setAttribute("data-lee-host", "");
  document.body.appendChild(host);
  const lee = mountLee(host.attachShadow({ mode: "open" }), {
    requestOff: () => {},
    // A save here is a draft, so it can happen on its own.
    autosave: true,
    entryActions: options.entryActions,
    home: options.home,
  });
  void lee.setEditing(true);
  return lee;
}
