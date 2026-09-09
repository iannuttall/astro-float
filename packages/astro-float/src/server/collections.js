import fs from "node:fs/promises";
import path from "node:path";
import { discoverCollections, httpError, serializeDocument, slugify } from "./content.js";

const CONFIG_CANDIDATES = [
  "src/content.config.ts",
  "src/content.config.mts",
  "src/content.config.js",
  "src/content.config.mjs",
  "src/content/config.ts",
  "src/content/config.js",
];

/**
 * Create a brand-new collection the way an Astro 5 project expects it:
 *   1. `src/content/<name>/` directory
 *   2. a `defineCollection()` entry in `src/content.config.ts` (glob loader,
 *      a small starter schema) and a key in `export const collections`
 *   3. one seed entry so the collection renders immediately
 *
 * Config wiring is text-based and deliberately conservative: it only touches
 * files whose shape it recognises, and reports back when it couldn't.
 */
export async function createCollection(ctx, { name, title }) {
  if (typeof name !== "string" || !/^[a-z][a-z0-9-]*$/.test(name)) {
    throw httpError(400, "collection name must be kebab-case (a-z, 0-9, -)");
  }
  const existing = await discoverCollections(ctx);
  if (existing.some((c) => c.name === name)) throw httpError(409, `collection "${name}" already exists`);

  const dir = path.join(ctx.contentDir, name);
  await fs.mkdir(dir, { recursive: true });

  const config = await wireContentConfig(ctx, name);

  const seedTitle = (typeof title === "string" && title.trim()) || "First entry";
  const slug = slugify(seedTitle) || "first-entry";
  const abs = path.join(dir, slug, "index.md");
  const data = {
    title: seedTitle,
    description: "",
    pubDate: new Date().toISOString().slice(0, 10),
    tags: [],
    draft: false,
  };
  await fs.mkdir(path.dirname(abs), { recursive: true });
  await fs.writeFile(abs, serializeDocument(data, "Start writing…\n"), { encoding: "utf8", flag: "wx" });

  return {
    collection: name,
    id: slug,
    file: rel(ctx.root, abs),
    dir: rel(ctx.root, dir),
    config,
  };
}

async function wireContentConfig(ctx, name) {
  const ident = toIdentifier(name);
  const definition = [
    `const ${ident} = defineCollection({`,
    `  loader: glob({ pattern: "**/*.{md,mdx}", base: "./src/content/${name}" }),`,
    `  schema: z.object({`,
    `    title: z.string(),`,
    `    description: z.string().default(""),`,
    `    pubDate: z.coerce.date(),`,
    `    tags: z.array(z.string()).default([]),`,
    `    draft: z.boolean().default(false),`,
    `  }),`,
    `});`,
  ].join("\n");
  const entry = ident === name ? ident : `"${name}": ${ident}`;

  let file = null;
  for (const candidate of CONFIG_CANDIDATES) {
    const abs = path.join(ctx.root, candidate);
    if (await exists(abs)) {
      file = abs;
      break;
    }
  }

  if (!file) {
    file = path.join(ctx.root, "src/content.config.ts");
    const text = [
      `import { defineCollection, z } from "astro:content";`,
      `import { glob } from "astro/loaders";`,
      ``,
      definition,
      ``,
      `export const collections = { ${entry} };`,
      ``,
    ].join("\n");
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(file, text, "utf8");
    return { file: rel(ctx.root, file), updated: true, created: true };
  }

  let text = await fs.readFile(file, "utf8");
  const relFile = rel(ctx.root, file);

  const exportMatch = text.match(/export const collections\s*=\s*\{([^}]*)\}/);
  if (!exportMatch) {
    return {
      file: relFile,
      updated: false,
      note: `couldn't find \`export const collections = { … }\` in ${relFile}; register "${name}" by hand`,
    };
  }
  if (new RegExp(`(^|[\\s,{])${escapeRegExp(ident)}\\s*[,}:]|"${escapeRegExp(name)}"\\s*:`).test(exportMatch[1])) {
    return { file: relFile, updated: false, note: `"${name}" is already registered in ${relFile}` };
  }

  // Imports: make sure defineCollection + z and glob are available.
  const astroContentImport = text.match(/import\s*\{([^}]*)\}\s*from\s*["']astro:content["'];?/);
  if (astroContentImport) {
    const names = astroContentImport[1].split(",").map((s) => s.trim()).filter(Boolean);
    const missing = ["defineCollection", "z"].filter((n) => !names.includes(n));
    if (missing.length) {
      text = text.replace(astroContentImport[0], `import { ${[...names, ...missing].join(", ")} } from "astro:content";`);
    }
  } else {
    text = `import { defineCollection, z } from "astro:content";\n` + text;
  }
  if (!/from\s*["']astro\/loaders["']/.test(text)) {
    const firstImportEnd = text.search(/\n(?!import)/);
    const insertAt = firstImportEnd === -1 ? 0 : firstImportEnd + 1;
    text = text.slice(0, insertAt) + `import { glob } from "astro/loaders";\n` + text.slice(insertAt);
  }

  // Definition goes right before the export; the export gains a key.
  const exportIndex = text.indexOf("export const collections");
  text = text.slice(0, exportIndex) + definition + "\n\n" + text.slice(exportIndex);

  text = text.replace(/export const collections\s*=\s*\{([^}]*)\}/, (_, inner) => {
    const trimmed = inner.trim();
    if (trimmed === "") return `export const collections = { ${entry} }`;
    if (inner.includes("\n")) {
      const body = inner.replace(/\s*$/, "") + (trimmed.endsWith(",") ? "" : ",");
      return `export const collections = {${body}\n  ${entry},\n}`;
    }
    return `export const collections = { ${trimmed.replace(/,$/, "")}, ${entry} }`;
  });

  await fs.writeFile(file, text, "utf8");
  return { file: relFile, updated: true };
}

function toIdentifier(name) {
  const camel = name.replace(/-+([a-z0-9])/g, (_, c) => c.toUpperCase());
  const RESERVED = new Set(["default", "delete", "export", "import", "new", "class", "function", "return", "var", "let", "const"]);
  return RESERVED.has(camel) ? `${camel}Collection` : camel;
}

function escapeRegExp(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function rel(root, abs) {
  return path.relative(root, abs).split(path.sep).join("/");
}

async function exists(p) {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
}
