import { fileURLToPath } from "node:url";
import path from "node:path";
import { attachFloatApi } from "./server/api.js";
import { createSyncGate } from "./server/sync-gate.js";

/**
 * astro-float — an on-page content editor for Astro content collections.
 *
 * Dev-only. Injects a small client that mounts the floating rail on every
 * page, plus localhost-only JSON endpoints under `/__float/api/*` that read
 * and write Markdown files on disk. Nothing is added to production builds.
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
      "astro:config:setup": ({ command, config, injectScript, logger }) => {
        isDev = command === "dev";
        if (!isDev) return;

        root = fileURLToPath(config.root);
        srcDir = fileURLToPath(config.srcDir);

        // Always on in dev: no toolbar icon to find, the rail is just there.
        injectScript("page", `import "astro-float/client";`);

        logger.info("on-page content editor enabled (dev only)");
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
