import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
export const DEMO = path.join(REPO, "demo");
export const CONTENT_DIR = path.join(DEMO, "src", "content");
export const PUBLIC_MEDIA = path.join(DEMO, "public", "media");

export function copyTree(from: string, to: string) {
  fs.cpSync(from, to, { recursive: true });
}

/** Every file under `dir`, as paths relative to it. */
export function listFiles(dir: string, prefix = ""): string[] {
  if (!fs.existsSync(dir)) return [];
  const out: string[] = [];
  for (const d of fs.readdirSync(dir, { withFileTypes: true })) {
    const rel = prefix ? `${prefix}/${d.name}` : d.name;
    if (d.isDirectory()) out.push(...listFiles(path.join(dir, d.name), rel));
    else out.push(rel);
  }
  return out.sort();
}

/** The demo content file for an entry, e.g. `blog/hello-float/index.md`. */
export function entryPath(rel: string) {
  return path.join(CONTENT_DIR, rel);
}

export function readEntry(rel: string) {
  return fs.readFileSync(entryPath(rel), "utf8");
}

/** The entry as it was when the run started. */
export function originalEntry(rel: string) {
  return fs.readFileSync(path.join(process.env.FLOAT_BACKUP!, "content", rel), "utf8");
}

const MEDIA = /\.(png|jpe?g|gif|webp|avif|svg|mp4|webm|mov|m4v)$/i;

/**
 * Put the demo content back the way the run found it: rewrite files that
 * differ, delete entries that were added, and wait for Astro to re-sync so the
 * next test's page renders the restored entry.
 *
 * Media a test added (a dropped image) is only deleted once the dev server has
 * stopped: Astro's content asset map is additive, and deleting an image it has
 * seen makes every page that imported it 500 until a restart (see the README's
 * notes). The entry text is restored right away, so nothing references it.
 */
export async function restoreContent(base: string) {
  const backup = path.join(process.env.FLOAT_BACKUP!, "content");
  const want = new Set(listFiles(backup));
  const have = listFiles(CONTENT_DIR);
  const changes: Array<() => void> = [];
  const deferred: string[] = [];
  const restoredEntries: string[] = [];

  for (const rel of have) {
    if (want.has(rel)) continue;
    if (MEDIA.test(rel)) deferred.push(path.join(CONTENT_DIR, rel));
    else changes.push(() => fs.rmSync(path.join(CONTENT_DIR, rel), { force: true }));
  }
  for (const rel of want) {
    const src = path.join(backup, rel);
    const dst = path.join(CONTENT_DIR, rel);
    if (!fs.existsSync(dst) || !fs.readFileSync(src).equals(fs.readFileSync(dst))) {
      if (/\.mdx?$/.test(rel)) restoredEntries.push(rel);
      changes.push(() => {
        fs.mkdirSync(path.dirname(dst), { recursive: true });
        fs.copyFileSync(src, dst);
      });
    }
  }
  if (fs.existsSync(PUBLIC_MEDIA)) deferred.push(PUBLIC_MEDIA);
  if (deferred.length) fs.appendFileSync(deferredFile(), deferred.join("\n") + "\n");

  if (!changes.length) return;
  // Connect before writing: the sync signal must not slip past us.
  const synced = waitForContentSync(base, 6_000).catch(() => new Promise((r) => setTimeout(r, 1_500)));
  for (const apply of changes) apply();
  await synced;
  // The signal says the store changed; make sure the restored entries render again before the next test asks.
  for (const rel of restoredEntries) await waitForEntryPage(base, rel);
}

/** Poll an entry's page until it prints the entry's title again (the store re-sync has landed). */
async function waitForEntryPage(base: string, rel: string) {
  const m = rel.match(/^([^/]+)\/(.+?)(?:\/index)?\.mdx?$/);
  if (!m) return;
  const title = /^---\n(?:.*\n)*?title: (.+)\n/.exec(fs.readFileSync(path.join(CONTENT_DIR, rel), "utf8"))?.[1]?.replace(/^"(.*)"$/, "$1");
  if (!title) return;
  const url = `${base}/${m[1]}/${m[2]}/`;
  const deadline = Date.now() + 8_000;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(url, { headers: { accept: "text/html" } });
      const html = res.ok ? await res.text() : "";
      if (html.includes("<h1") && html.includes(title)) return;
    } catch {
      /* server busy */
    }
    await new Promise((r) => setTimeout(r, 150));
  }
}

function deferredFile() {
  return path.join(process.env.FLOAT_BACKUP!, "deferred-deletes.txt");
}

/** After the dev server is down: delete the media tests added, then any directories that emptied out. */
export function deleteDeferred() {
  const file = deferredFile();
  if (!fs.existsSync(file)) return;
  for (const target of new Set(fs.readFileSync(file, "utf8").split("\n").filter(Boolean))) {
    fs.rmSync(target, { recursive: true, force: true });
  }
  pruneEmptyDirs(CONTENT_DIR);
}

function pruneEmptyDirs(dir: string) {
  for (const d of fs.readdirSync(dir, { withFileTypes: true })) {
    if (!d.isDirectory()) continue;
    const sub = path.join(dir, d.name);
    pruneEmptyDirs(sub);
    if (!fs.readdirSync(sub).length) fs.rmdirSync(sub);
  }
}

/**
 * Astro's content layer asks the browser for a full reload once a changed
 * entry is back in its store. Listening on Vite's HMR socket for that message
 * is the same signal Float's sync gate uses.
 */
export function waitForContentSync(base: string, timeoutMs: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(base.replace(/^http/, "ws") + "/", "vite-hmr");
    const timer = setTimeout(() => {
      ws.close();
      reject(new Error("no content sync signal"));
    }, timeoutMs);
    const done = (err?: Error) => {
      clearTimeout(timer);
      ws.close();
      err ? reject(err) : resolve();
    };
    ws.addEventListener("message", (e) => {
      try {
        const msg = JSON.parse(String(e.data));
        if (msg.type === "full-reload") done();
      } catch {
        /* not JSON */
      }
    });
    ws.addEventListener("error", () => done(new Error("hmr socket error")));
  });
}

/** Lines that differ between two texts of the same length; -1 when the line counts differ. */
export function changedLines(before: string, after: string): number {
  const a = before.split("\n");
  const b = after.split("\n");
  if (a.length !== b.length) return -1;
  return a.filter((line, i) => line !== b[i]).length;
}
