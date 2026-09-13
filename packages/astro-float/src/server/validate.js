import fs from "node:fs/promises";
import path from "node:path";
import { importFromAstro } from "./astro-deps.js";
import { imageFieldPaths, loadZodSchema } from "./schema.js";

/**
 * Save-time validation against the collection's real Zod schema, so a bad
 * value is refused with a field-level message instead of landing on disk and
 * failing in Astro's terminal.
 *
 * The document is checked the way Astro will read it: the frontmatter YAML is
 * parsed by `@astrojs/markdown-remark`'s `parseFrontmatter` (js-yaml, dates
 * become Date objects) and the result goes through `schema.safeParseAsync`.
 * `image()` fields are additionally resolved against the entry's directory,
 * as Astro's own `image()` does.
 *
 * @typedef {{ path: Array<string | number>, message: string }} Issue
 * @typedef {{ schema: "zod" | "inferred" | "none", strict: boolean, issues: Issue[] }} Report
 */

/**
 * @param {{ root: string, server?: import('vite').ViteDevServer, logger?: { warn(msg: string): void } }} ctx
 * @param {string} collectionName
 * @param {string} document  the full Markdown document as it would be written
 * @param {{ entryDir?: string }} [options]
 * @returns {Promise<Report>}
 */
export async function validateDocument(ctx, collectionName, document, { entryDir } = {}) {
  const loaded = await loadZodSchema(ctx, collectionName);
  if (!loaded.loaded) return { schema: await schemaKind(ctx, collectionName, loaded), strict: false, issues: [] };
  if (!loaded.hasSchema || !loaded.schema) return { schema: loaded.hasSchema ? "none" : "inferred", strict: false, issues: [] };

  let data;
  try {
    data = await frontmatterAsAstroReadsIt(ctx.root, document);
  } catch (err) {
    return { schema: "zod", strict: loaded.strict, issues: [{ path: [], message: `frontmatter isn't valid YAML: ${err?.message ?? err}` }] };
  }

  /** @type {Issue[]} */
  const issues = [];
  try {
    const result = await loaded.schema.safeParseAsync(data);
    if (!result.success) {
      for (const issue of result.error?.issues ?? []) {
        issues.push({ path: issue.path ?? [], message: cleanMessage(issue.message) });
      }
    }
  } catch (err) {
    issues.push({ path: [], message: `schema threw: ${err?.message ?? err}` });
  }

  if (entryDir) {
    for (const p of await imageFieldPaths(ctx, collectionName)) {
      if (p.includes("[]")) continue;
      const segments = p.split(".");
      const value = segments.reduce((v, k) => (v && typeof v === "object" ? v[k] : undefined), data);
      if (typeof value !== "string" || !value || /^(?:[a-z][a-z0-9+.-]*:|\/)/i.test(value)) continue;
      if (issues.some((i) => i.path.join(".") === p)) continue;
      try {
        await fs.access(path.resolve(entryDir, value));
      } catch {
        issues.push({ path: segments, message: `Image ${value} does not exist. Is the path correct?` });
      }
    }
  }

  return { schema: "zod", strict: loaded.strict, issues };
}

/** The error a mutation throws when validation fails: 422 with the issues attached. */
export function validationError(issues) {
  return Object.assign(new Error("validation"), { status: 422, issues });
}

/** Parse the frontmatter with Astro's own parser (js-yaml: dates become Dates); our YAML reader when markdown-remark isn't resolvable. */
async function frontmatterAsAstroReadsIt(root, document) {
  let parseFrontmatter = null;
  try {
    ({ parseFrontmatter } = await importFromAstro(root, "@astrojs/markdown-remark"));
  } catch {
    /* not resolvable from this project's astro */
  }
  if (parseFrontmatter) return parseFrontmatter(document, { frontmatter: "remove" }).frontmatter ?? {};
  const { parseDocument } = await import("./content.js");
  return parseDocument(document).frontmatter;
}

/** `**about**: Reference to blog invalid…` → `Reference to blog invalid…` (Astro bolds the path into the message). */
function cleanMessage(message) {
  return String(message ?? "").replace(/^\*\*[^*]*\*\*:\s*/, "");
}

async function schemaKind(ctx, collectionName, loaded) {
  if (loaded.hasSchema) return "none";
  // The module couldn't be loaded: fall back to whether Astro wrote a JSON Schema for it.
  try {
    await fs.access(path.join(ctx.root, ".astro", "collections", `${collectionName}.schema.json`));
    return "none";
  } catch {
    return "inferred";
  }
}
