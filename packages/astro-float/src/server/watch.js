import fs from "node:fs/promises";
import path from "node:path";
import { discoverCollections, ENTRY_EXTS, hashOf } from "./content.js";

/**
 * Tell the toolbar when an entry file changes on disk — a save in your editor,
 * a `git checkout`, a formatter, or a Float save from another tab. The event
 * goes over Vite's HMR socket once Astro has re-synced the entry (or given up):
 *
 *   `astro-float:file-changed` → `{ collection, id, hash }`
 *
 * `hash` is the same one `/entry` returns, so a tab can tell its own save
 * (same hash) from someone else's (different hash) and whether the copy it
 * holds is stale. While an edit session is active the sync gate swallows the
 * full reload Astro would send for the change, so this event is the only
 * signal; otherwise the page reloads as usual and the event is a courtesy.
 *
 * @param {import('vite').ViteDevServer} server
 * @param {{ root: string, contentDir: string, collections: Record<string, { dir?: string, route?: string }>, gate: { begin(label: string, options?: { requireChange?: boolean }): Promise<{ waitFor(target: any, options?: { refresh?: boolean }): Promise<boolean>, cancel(): void }> }, logger: { debug(msg: string): void } }} ctx
 */
export function watchEntries(server, ctx) {
  const onChange = async (file) => {
    if (!ENTRY_EXTS.has(path.extname(file).toLowerCase())) return;
    const operation = await ctx.gate.begin(`the outside change to ${path.relative(ctx.root, file)}`, { requireChange: false });
    try {
      const rel = path.relative(ctx.root, file).split(path.sep).join("/");
      const collections = await discoverCollections(ctx);
      for (const collection of collections) {
        const entry = collection.entries.find((e) => e.file === rel);
        if (!entry) continue;
        // Wait for this file's exact digest in Astro's store. The watcher can
        // run after Astro's own listener, so the immediate store check also
        // covers a signal that arrived before this callback found the entry.
        await operation.waitFor(
          { type: "entry", collection: collection.name, id: entry.id, file: entry.file },
          { refresh: false },
        );
        const raw = await fs.readFile(file, "utf8");
        // `server.ws` on Astro 5 / Vite 5; later Vites also expose the client environment's channel.
        const channel = server.ws ?? server.environments?.client?.hot ?? server.hot;
        channel.send({
          type: "custom",
          event: "astro-float:file-changed",
          data: { collection: collection.name, id: entry.id, hash: hashOf(raw) },
        });
        ctx.logger.debug(`entry changed on disk: ${rel}`);
        operation.cancel();
        return;
      }
      operation.cancel();
    } catch {
      operation.cancel();
      /* the file may be gone already; nothing to announce */
    }
  };
  server.watcher.on("change", onChange);
  server.watcher.on("add", onChange);
}
