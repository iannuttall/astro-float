import { fileURLToPath } from "node:url";
import path from "node:path";
import { attachFloatApi } from "./server/api.js";
import { createSyncGate } from "./server/sync-gate.js";

const EDIT_ICON = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21.174 6.812a1 1 0 0 0-3.986-3.987L3.842 16.174a2 2 0 0 0-.5.83l-1.321 4.352a.5.5 0 0 0 .623.622l4.353-1.32a2 2 0 0 0 .83-.497z"/><path d="m15 5 4 4"/></svg>`;

/**
 * astro-float — an on-page content editor for Astro content collections.
 *
 * Dev-only. Adds an "Edit" app to the Astro Dev Toolbar: while it's on, the
 * rendered entry (title, description, Markdown body) is editable in place and
 * a small piece of chrome — popover, tucked rail or docked sheet, your pick —
 * holds the rest. Localhost-only JSON endpoints under `/__float/api/*` read and
 * write the Markdown files on disk. Nothing is added to production builds.
 *
 * @param {import('../index.js').AstroFloatOptions} [options]
 * @returns {import('astro').AstroIntegration}
 */
export default function astroFloat(options = {}) {
  /** @type {string | undefined} */
  let root;
  /** @type {string | undefined} */
  let srcDir;
  /** @type {string | undefined} */
  let publicDir;
  /** @type {Record<string, unknown> | undefined} */
  let markdown;
  let isDev = false;

  return {
    name: "astro-float",
    hooks: {
      "astro:config:setup": ({ command, config, addDevToolbarApp, updateConfig, logger }) => {
        isDev = command === "dev";
        if (!isDev) return;

        // The toolbar app imports `yaml` in the browser. Vite only pre-bundles
        // what it finds by scanning the project, and the toolbar entry lives in
        // this package, so it would discover `yaml` on the first page load,
        // re-optimize and force a reload — which leaves the dev toolbar's own
        // entry answering 504 "Outdated Optimize Dep" until the next manual
        // reload (Astro 6 and 7). Declaring it up front avoids the round trip.
        updateConfig({ vite: { optimizeDeps: { include: ["astro-float > yaml"] } } });

        root = fileURLToPath(config.root);
        srcDir = fileURLToPath(config.srcDir);
        publicDir = fileURLToPath(config.publicDir);
        // The live-render endpoint runs the project's own Markdown pipeline (same options Astro's Markdown plugin uses).
        markdown = {
          image: config.image,
          experimentalHeadingIdCompat: config.experimental?.headingIdCompat,
          ...config.markdown,
        };

        addDevToolbarApp({
          id: "astro-float",
          name: "Edit",
          icon: EDIT_ICON,
          entrypoint: new URL("./toolbar/app.ts", import.meta.url),
        });

        logger.info("on-page content editor enabled (dev only) — toggle it from the toolbar's Edit icon");
      },

      "astro:server:setup": ({ server, logger }) => {
        if (!isDev || !root || !srcDir) return;

        const contentDir = options.contentDir
          ? path.resolve(root, options.contentDir)
          : path.join(srcDir, "content");

        const gate = createSyncGate(server, logger);

        attachFloatApi(server, {
          root,
          // The schema reader loads content.config.ts through Vite to find image() / reference() fields.
          server,
          contentDir,
          collections: options.collections ?? {},
          allowRemote: options.allowRemote ?? false,
          maxUploadBytes: options.maxUploadBytes ?? 15 * 1024 * 1024,
          maxVideoBytes: options.maxVideoBytes ?? 200 * 1024 * 1024,
          publicDir,
          markdown,
          gate,
          logger,
        });
      },
    },
  };
}
