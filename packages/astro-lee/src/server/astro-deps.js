import { createRequire } from "node:module";
import path from "node:path";
import { pathToFileURL } from "node:url";

/**
 * Import a module from the astro the *project* uses — `@astrojs/markdown-remark`,
 * `astro/zod` — rather than adding them as dependencies of astro-lee, so the
 * versions always agree with what Astro itself runs. Resolution goes project
 * root → astro → the module, which also works in pnpm's isolated layout.
 *
 * @type {Map<string, Promise<any>>}
 */
const cache = new Map();

/**
 * @param {string} root
 * @param {string} specifier
 * @returns {Promise<any>}
 */
export function importFromAstro(root, specifier) {
  const key = `${root}::${specifier}`;
  let pending = cache.get(key);
  if (!pending) {
    pending = load(root, specifier).catch((err) => {
      cache.delete(key);
      throw err;
    });
    cache.set(key, pending);
  }
  return pending;
}

async function load(root, specifier) {
  let astroEntry;
  try {
    astroEntry = createRequire(path.join(root, "package.json")).resolve("astro");
  } catch {
    // The project doesn't list astro directly (unusual): fall back to the copy next to astro-lee.
    astroEntry = import.meta.resolve("astro");
    if (astroEntry.startsWith("file:")) astroEntry = decodeURIComponent(new URL(astroEntry).pathname);
  }
  const file = createRequire(astroEntry).resolve(specifier);
  return import(pathToFileURL(file).href);
}
