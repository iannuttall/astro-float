import fs from "node:fs/promises";
import path from "node:path";
import { discoverCollections, httpError, isInside, publicMediaDir, serializeDocument, slugify } from "./content.js";
import { CONFIG_CANDIDATES } from "./schema.js";

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

/**
 * Delete a collection: its directory under the content dir, its
 * `public/media/<name>/` folder, and — mirroring `createCollection` — its
 * `defineCollection()` block and key in the content config. A config whose
 * shape isn't recognised is left alone and reported (`config.updated: false`,
 * with a note), the folder is gone either way.
 */
export async function deleteCollection(ctx, name) {
  if (typeof name !== "string" || !/^[a-z][a-z0-9-]*$/.test(name)) throw httpError(400, "collection name must be kebab-case (a-z, 0-9, -)");
  const collection = (await discoverCollections(ctx)).find((c) => c.name === name);
  if (!collection) throw httpError(404, `unknown collection "${name}"`);
  const dir = path.resolve(ctx.root, collection.dir);
  if (!isInside(ctx.contentDir, dir)) throw httpError(400, "collection directory is outside the content dir");

  // Unregister first, so Astro re-syncs without the collection before its files go.
  const config = await unwireContentConfig(ctx, name);
  const removed = [];
  for (const target of [dir, publicMediaDir(ctx, name, [])]) {
    if (!target || !(await exists(target))) continue;
    await fs.rm(target, { recursive: true, force: true });
    removed.push(rel(ctx.root, target));
  }
  return { collection: name, entries: collection.entries.length, removed, config };
}

/** Take a collection out of the content config: the key in `export const collections` and the `defineCollection` it names. */
async function unwireContentConfig(ctx, name) {
  let file = null;
  for (const candidate of CONFIG_CANDIDATES) {
    const abs = path.join(ctx.root, candidate);
    if (await exists(abs)) {
      file = abs;
      break;
    }
  }
  if (!file) return { file: null, updated: false, note: "no content config found; nothing to unregister" };
  const relFile = rel(ctx.root, file);
  let text = await fs.readFile(file, "utf8");

  const exportMatch = text.match(/export const collections\s*=\s*\{([^}]*)\}/);
  if (!exportMatch) {
    return { file: relFile, updated: false, note: `couldn't find \`export const collections = { … }\` in ${relFile}; remove "${name}" by hand` };
  }
  // `blog`, `blog: posts`, `"blog": posts` — the entry for this collection, and the variable it points at.
  const entries = exportMatch[1].split(",").map((s) => s.trim()).filter(Boolean);
  const keyRe = new RegExp(`^(?:"${escapeRegExp(name)}"|'${escapeRegExp(name)}'|${escapeRegExp(name)})\\s*(?::\\s*([A-Za-z_$][\\w$]*))?$`);
  const index = entries.findIndex((e) => keyRe.test(e));
  if (index === -1) return { file: relFile, updated: false, note: `"${name}" isn't registered in ${relFile}` };
  const ident = keyRe.exec(entries[index])[1] ?? name;
  const remaining = entries.filter((_, i) => i !== index);

  const inner = exportMatch[1];
  const replacement = !remaining.length
    ? "export const collections = {}"
    : inner.includes("\n")
      ? `export const collections = {\n${remaining.map((e) => `  ${e},`).join("\n")}\n}`
      : `export const collections = { ${remaining.join(", ")} }`;
  text = text.replace(exportMatch[0], replacement);

  // The definition: `const <ident> = defineCollection(` through its matching `);`, plus the blank line after it.
  const start = text.search(new RegExp(`(^|\\n)(export\\s+)?const\\s+${escapeRegExp(ident)}\\s*=\\s*defineCollection\\s*\\(`));
  if (start !== -1) {
    const open = text.indexOf("(", text.indexOf("defineCollection", start));
    const close = matchParen(text, open);
    if (close !== -1) {
      let end = close + 1;
      if (text[end] === ";") end++;
      while (text[end] === "\n") end++;
      const from = start === 0 ? 0 : start + 1; // keep the newline that ended the previous statement
      text = text.slice(0, from) + text.slice(end);
    }
  }
  await fs.writeFile(file, text, "utf8");
  return { file: relFile, updated: true };
}

/** Index of the `)` matching the `(` at `open`, skipping strings and comments; -1 when unbalanced. */
function matchParen(text, open) {
  let depth = 0;
  for (let i = open; i < text.length; i++) {
    const c = text[i];
    if (c === '"' || c === "'" || c === "`") {
      for (i++; i < text.length && text[i] !== c; i++) if (text[i] === "\\") i++;
    } else if (c === "/" && text[i + 1] === "/") {
      i = text.indexOf("\n", i);
      if (i === -1) return -1;
    } else if (c === "/" && text[i + 1] === "*") {
      i = text.indexOf("*/", i) + 1;
      if (i === 0) return -1;
    } else if (c === "(" || c === "[" || c === "{") depth++;
    else if (c === ")" || c === "]" || c === "}") {
      depth--;
      if (depth === 0) return c === ")" ? i : -1;
    }
  }
  return -1;
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
