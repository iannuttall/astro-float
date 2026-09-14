import fs from "node:fs";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { pruneAssetImports } from "../src/server/assets.js";
import { tempRoot, writeFiles } from "./helpers";

const id = (src, importer) => `${src}?astroContentImageFlag=&importer=${encodeURIComponent(importer)}`;
const line = (symbol, importId) => `import ${symbol} from ${JSON.stringify(importId)};`;

describe("pruneAssetImports", () => {
  const root = tempRoot();
  const file = path.join(root, ".astro/content-assets.mjs");
  afterAll(() => fs.rmSync(root, { recursive: true, force: true }));

  const kept = id("./cover.png", "src/content/notes/n/index.md");
  const movedEntry = id("./pic.png", "src/content/blog/old/index.md");
  const deletedImage = id("./gone.png", "src/content/notes/n/index.md");
  const alias = id("~/assets/logo.png", "src/content/notes/n/index.md");
  const map = (ids) => `\n${ids.map(([s, i]) => line(s, i)).join("\n")}\nexport default new Map([${ids.map(([s, i]) => `[${JSON.stringify(i)}, ${s}]`).join(", ")}]);\n\t\t`;

  writeFiles(root, {
    "src/content/notes/n/index.md": "---\ntitle: n\n---\n",
    "src/content/notes/n/cover.png": "png",
    ".astro/content-assets.mjs": map([
      ["__A", kept],
      ["__B", movedEntry],
      ["__C", deletedImage],
      ["__D", alias],
    ]),
  });

  it("drops imports whose entry or relative image is gone, keeps the rest, and leaves a loadable module", async () => {
    const removed = await pruneAssetImports({ root });
    expect(removed).toEqual([movedEntry, deletedImage]);
    const text = fs.readFileSync(file, "utf8");
    expect(text).toBe(`\n${line("__A", kept)}\n${line("__D", alias)}\nexport default new Map([[${JSON.stringify(kept)}, __A], [${JSON.stringify(alias)}, __D]]);\n\t\t`);
    expect(await pruneAssetImports({ root })).toEqual([]);
    expect(fs.readdirSync(path.join(root, ".astro"))).toEqual(["content-assets.mjs"]);
  });

  it("does nothing without a map, or with an empty one", async () => {
    expect(await pruneAssetImports({ root: tempRoot() })).toEqual([]);
    fs.writeFileSync(file, "export default new Map();");
    expect(await pruneAssetImports({ root })).toEqual([]);
    expect(fs.readFileSync(file, "utf8")).toBe("export default new Map();");
  });
});
