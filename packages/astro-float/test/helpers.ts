import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createMarkdownProcessor, type MarkdownProcessor } from "@astrojs/markdown-remark";

export const FIXTURES = path.join(path.dirname(fileURLToPath(import.meta.url)), "fixtures");

export function readFixture(rel: string): string {
  return fs.readFileSync(path.join(FIXTURES, rel), "utf8");
}

/** `[name, contents]` for every file in a fixture directory, sorted by name. */
export function fixtureFiles(dir: string, ext: string): Array<[string, string]> {
  const abs = path.join(FIXTURES, dir);
  return fs
    .readdirSync(abs)
    .filter((f) => f.endsWith(ext))
    .sort()
    .map((f) => [f.slice(0, -ext.length), fs.readFileSync(path.join(abs, f), "utf8")]);
}

let processor: MarkdownProcessor | null = null;

/** Render Markdown the way Astro's default pipeline does (GFM, smartypants, Shiki). */
export async function renderMarkdown(md: string): Promise<string> {
  processor ??= await createMarkdownProcessor({});
  return (await processor.render(md)).code;
}

/** A detached container holding `html`, with the whitespace between blocks dropped (as `PageEditor` sees the DOM). */
export function containerFrom(html: string): HTMLElement {
  const div = document.createElement("div");
  div.innerHTML = html;
  for (const node of Array.from(div.childNodes)) {
    if (node.nodeType === Node.TEXT_NODE && !(node.textContent ?? "").trim()) node.remove();
  }
  return div;
}

/** A throwaway project root; removed when the test file finishes. */
export function tempRoot(prefix = "astro-float-"): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

export function writeFiles(root: string, files: Record<string, string | Buffer>) {
  for (const [rel, contents] of Object.entries(files)) {
    const abs = path.join(root, rel);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, contents);
  }
}
