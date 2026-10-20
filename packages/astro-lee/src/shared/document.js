// Reading and writing a Markdown document's frontmatter, with no file system:
// shared by the dev server (content.js) and anything that keeps entries
// somewhere else, such as a hosted editor that commits through an API.
import { parse as parseYaml, parseDocument as parseYamlDocument, stringify as stringifyYaml } from "yaml";

export const FRONTMATTER_RE = /^(?:\uFEFF)?---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/;

/** Split a Markdown document into frontmatter data + body. */
export function parseDocument(raw) {
  const match = raw.match(FRONTMATTER_RE);
  if (!match) return { frontmatter: {}, body: raw, hadFrontmatter: false };
  let data = parseYaml(match[1], { schema: "core" });
  if (data === null || typeof data !== "object" || Array.isArray(data)) data = {};
  const body = raw.slice(match[0].length).replace(/^(\r?\n)+/, "");
  return { frontmatter: data, body, hadFrontmatter: true };
}

/**
 * Serialize frontmatter + body back to a Markdown document.
 * Body is kept byte-for-byte. Given the document as it is on disk
 * (`previous`), every top-level key whose value didn't change keeps its
 * source text exactly (quoting, flow style, comments); only changed and new
 * keys go through the YAML stringifier. Without it, all of the frontmatter is
 * re-emitted (key order preserved, quoting normalized).
 */
export function serializeDocument(frontmatter, body, previous) {
  const keys = Object.keys(frontmatter ?? {});
  const yaml = keys.length ? ((previous && keepUnchangedYaml(frontmatter, previous)) ?? stringifyYaml(frontmatter, { lineWidth: 0 })) : "";
  const cleanBody = body.replace(/^\r?\n+/, "");
  const trailing = cleanBody.endsWith("\n") ? "" : "\n";
  return `---\n${yaml}---\n\n${cleanBody}${trailing}`;
}

/**
 * The frontmatter YAML for `frontmatter`, splicing the source text of each
 * unchanged top-level key out of `previous`. Null when `previous` has no
 * frontmatter map to splice from.
 */
function keepUnchangedYaml(frontmatter, previous) {
  const match = previous.match(FRONTMATTER_RE);
  if (!match) return null;
  const source = match[1];
  const doc = parseYamlDocument(source, { schema: "core" });
  const items = doc.contents?.items;
  if (doc.errors.length || !Array.isArray(items) || !items.length || items.some((item) => !item.key?.range)) return null;
  const old = doc.toJS();
  const emit = (key) => stringifyYaml({ [key]: frontmatter[key] }, { lineWidth: 0 });
  let out = source.slice(0, items[0].key.range[0]);
  items.forEach((item, i) => {
    const key = String(item.key.value);
    if (!(key in frontmatter)) return;
    if (!sameValue(old[key], frontmatter[key])) return void (out += emit(key));
    const slice = source.slice(item.key.range[0], i + 1 < items.length ? items[i + 1].key.range[0] : source.length);
    out += slice.endsWith("\n") ? slice : `${slice}\n`;
  });
  for (const key of Object.keys(frontmatter)) if (!(key in old)) out += emit(key);
  return out;
}

function sameValue(a, b) {
  if (a === b) return true;
  if (typeof a !== "object" || typeof b !== "object" || a === null || b === null) return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  const ka = Object.keys(a);
  return ka.length === Object.keys(b).length && ka.every((k) => Object.hasOwn(b, k) && sameValue(a[k], b[k]));
}
