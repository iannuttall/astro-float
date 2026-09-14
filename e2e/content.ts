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

/** The demo content file for an entry, e.g. `blog/hello-lee/index.md`. */
export function entryPath(rel: string) {
  return path.join(CONTENT_DIR, rel);
}

export function readEntry(rel: string) {
  return fs.readFileSync(entryPath(rel), "utf8");
}

/** The entry as it was when the run started. */
export function originalEntry(rel: string) {
  return fs.readFileSync(path.join(process.env.LEE_BACKUP!, "content", rel), "utf8");
}

const MEDIA = /\.(png|jpe?g|gif|webp|avif|svg|mp4|webm|mov|m4v)$/i;

/**
 * Put the demo content back the way the run found it: rewrite files that
 * differ, delete entries that were added, and ask Astro to finish a content
 * refresh before the next test starts.
 *
 * Media a test added is deleted after the dev server stops. Astro's asset map
 * is additive, so removing an image while the server uses it can break pages.
 */
export async function restoreContent(base: string) {
  const backup = path.join(process.env.LEE_BACKUP!, "content");
  const want = new Set(listFiles(backup));
  const have = listFiles(CONTENT_DIR);
  const changes: Array<() => void> = [];
  const deferred: string[] = [];

  for (const rel of have) {
    if (want.has(rel)) continue;
    if (MEDIA.test(rel)) deferred.push(path.join(CONTENT_DIR, rel));
    else changes.push(() => fs.rmSync(path.join(CONTENT_DIR, rel), { force: true }));
  }
  for (const rel of want) {
    const src = path.join(backup, rel);
    const dst = path.join(CONTENT_DIR, rel);
    if (!fs.existsSync(dst) || !fs.readFileSync(src).equals(fs.readFileSync(dst))) {
      changes.push(() => {
        fs.mkdirSync(path.dirname(dst), { recursive: true });
        fs.copyFileSync(src, dst);
      });
    }
  }
  if (fs.existsSync(PUBLIC_MEDIA)) deferred.push(PUBLIC_MEDIA);
  if (deferred.length) fs.appendFileSync(deferredFile(), deferred.join("\n") + "\n");

  if (!changes.length) return;
  for (const apply of changes) apply();
  await syncContent(base);
}

function deferredFile() {
  return path.join(process.env.LEE_BACKUP!, "deferred-deletes.txt");
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

/** Ask Lee to run and await Astro's public content refresh signal. */
export async function syncContent(base: string): Promise<void> {
  const res = await fetch(`${base}/__lee/api/sync`, {
    method: "POST",
    headers: { "x-lee": "1" },
  });
  if (!res.ok) throw new Error(`content refresh failed: ${res.status} ${await res.text()}`);
}

/** Lines that differ between two texts of the same length; -1 when the line counts differ. */
export function changedLines(before: string, after: string): number {
  const a = before.split("\n");
  const b = after.split("\n");
  if (a.length !== b.length) return -1;
  return a.filter((line, i) => line !== b[i]).length;
}
