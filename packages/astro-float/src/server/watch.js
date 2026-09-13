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
 * @param {{ root: string, contentDir: string, collections: Record<string, { dir?: string, route?: string }>, gate: { noteEntryChange(): void, awaitSync(timeoutMs: number): Promise<boolean> }, logger: { debug(msg: string): void } }} ctx
 */
export function watchEntries(server, ctx) {
  const onChange = async (file) => {
    if (!ENTRY_EXTS.has(path.extname(file).toLowerCase())) return;
    try {
      const rel = path.relative(ctx.root, file).split(path.sep).join("/");
      const collections = await discoverCollections(ctx);
      for (const collection of collections) {
        const entry = collection.entries.find((e) => e.file === rel);
        if (!entry) continue;
        ctx.gate.noteEntryChange();
        // Let the content layer catch up first, so a page fetch after the event renders the new content.
        await ctx.gate.awaitSync(2500);
        const raw = await fs.readFile(file, "utf8");
        server.ws.send({
          type: "custom",
          event: "astro-float:file-changed",
          data: { collection: collection.name, id: entry.id, hash: hashOf(raw) },
        });
        ctx.logger.debug(`entry changed on disk: ${rel}`);
        return;
      }
    } catch {
      /* the file may be gone already; nothing to announce */
    }
  };
  server.watcher.on("change", onChange);
  server.watcher.on("add", onChange);
}
