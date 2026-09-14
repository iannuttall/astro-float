import fs from "node:fs";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { assetImportsForEntry, countAssetImports, invalidateAssetImports, pruneAssetImports } from "../src/server/assets.js";
import { tempRoot, writeFiles } from "./helpers";

const id = (src, importer) => `${src}?astroContentImageFlag=&importer=${encodeURIComponent(importer)}`;
const line = (symbol, importId) => `import ${symbol} from ${JSON.stringify(importId)};`;
const map = (ids) => `\n${ids.map(([s, i]) => line(s, i)).join("\n")}\nexport default new Map([${ids.map(([s, i]) => `[${JSON.stringify(i)}, ${s}]`).join(", ")}]);\n\t\t`;

describe("pruneAssetImports", () => {
  const root = tempRoot();
  const file = path.join(root, ".astro/content-assets.mjs");
  afterAll(() => fs.rmSync(root, { recursive: true, force: true }));

  const kept = id("./cover.png", "src/content/notes/n/index.md");
  const movedEntry = id("./pic.png", "src/content/blog/old/index.md");
  const deletedImage = id("./gone.png", "src/content/notes/n/index.md");
  const alias = id("~/assets/logo.png", "src/content/notes/n/index.md");

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

describe("assetImportsForEntry / countAssetImports", () => {
  const root = tempRoot();
  const file = path.join(root, ".astro/content-assets.mjs");
  afterAll(() => fs.rmSync(root, { recursive: true, force: true }));
  writeFiles(root, {
    ".astro/content-assets.mjs": map([
      ["__A", id("./a.png", "src/content/blog/old/index.md")],
      ["__B", id("./b.png", "src/content/blog/old/index.md")],
      ["__C", id("~/assets/logo.png", "src/content/blog/other/index.md")],
    ]),
  });

  it("counts the images the map imports for one entry file", async () => {
    expect(await assetImportsForEntry({ root }, "src/content/blog/old/index.md")).toEqual(new Set(["./a.png", "./b.png"]));
    expect(await countAssetImports({ root }, "src/content/blog/old/index.md")).toBe(2);
    expect(await countAssetImports({ root }, "src/content/blog/new/index.md")).toBe(0);
    expect(await countAssetImports({ root: tempRoot() }, "src/content/blog/old/index.md")).toBe(0);
    // Only what the entry still links to: the map keeps every image an entry ever had.
    expect(await countAssetImports({ root }, "src/content/blog/old/index.md", "---\ntitle: Old\n---\n\n![a](./a.png)\n")).toBe(1);
  });

});

describe("invalidateAssetImports", () => {
  const file = path.join("/project", ".astro/content-assets.mjs");
  const stub = `${String.fromCharCode(0)}astro:asset-imports`;
  const graph = (name, calls) => ({
    getModulesByFile: (f) => (f === file ? new Set([`${name} file`]) : undefined),
    getModuleById: (moduleId) => (moduleId === stub ? `${name} stub` : undefined),
    invalidateModule: (m) => calls.push(m),
  });

  it("invalidates the map as a file and as Astro's virtual copy, in every environment, a runner that exists, and the legacy graph", () => {
    const calls = [];
    const ssr = { moduleGraph: graph("ssr", calls), _runner: { evaluatedModules: graph("ssr runner", calls) } };
    const client = {
      moduleGraph: graph("client", calls),
      get runner() {
        throw new Error("a runner was created");
      },
    };
    invalidateAssetImports({ environments: { ssr, client }, moduleGraph: graph("legacy", calls) }, "/project");
    expect(calls).toEqual(["ssr file", "ssr stub", "ssr runner file", "ssr runner stub", "client file", "client stub", "legacy file", "legacy stub"]);
  });

  it("survives a server with neither environments nor a module graph", () => {
    expect(() => invalidateAssetImports(undefined, "/project")).not.toThrow();
    expect(() => invalidateAssetImports({}, "/project")).not.toThrow();
  });
});
