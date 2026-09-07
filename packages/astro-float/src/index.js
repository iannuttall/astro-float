import { fileURLToPath } from "node:url";
import path from "node:path";
import { attachFloatApi } from "./server/api.js";
import { createSyncGate } from "./server/sync-gate.js";

const TOOLBAR_ICON = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="3"/><path d="M15 3v18"/><path d="M7 8h4"/><path d="M7 12h4"/><path d="M7 16h2"/></svg>`;

/**
 * astro-float — a minimal floating content editor for Astro content collections.
 *
 * Dev-only. Registers a Dev Toolbar app plus a handful of localhost-only JSON
 * endpoints under `/__float/api/*` that read and write Markdown files on disk.
 * Nothing is added to production builds.
 *
 * @param {import('../index.js').AstroFloatOptions} [options]
 * @returns {import('astro').AstroIntegration}
 */
export default function astroFloat(options = {}) {
  /** @type {string | undefined} */
  let root;
  /** @type {string | undefined} */
  let srcDir;
  let isDev = false;

  return {
    name: "astro-float",
    hooks: {
      "astro:config:setup": ({ command, config, addDevToolbarApp, logger }) => {
        isDev = command === "dev";
        if (!isDev) return;

        root = fileURLToPath(config.root);
        srcDir = fileURLToPath(config.srcDir);

        addDevToolbarApp({
          id: "astro-float",
          name: "Float",
          icon: TOOLBAR_ICON,
          entrypoint: new URL("./toolbar/app.ts", import.meta.url),
        });

        logger.info("floating content editor enabled (dev only)");
      },

      "astro:server:setup": ({ server, logger }) => {
        if (!isDev || !root || !srcDir) return;

        const contentDir = options.contentDir
          ? path.resolve(root, options.contentDir)
          : path.join(srcDir, "content");

        const gate = createSyncGate(server, logger);

        attachFloatApi(server, {
          root,
          contentDir,
          collections: options.collections ?? {},
          allowRemote: options.allowRemote ?? false,
          maxUploadBytes: options.maxUploadBytes ?? 15 * 1024 * 1024,
          gate,
          logger,
        });
      },
    },
  };
}
