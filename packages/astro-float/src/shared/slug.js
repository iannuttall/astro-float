/**
 * One rule for an entry's address segment, shared by the server (`content.js`
 * rename / create) and the toolbar (the Address row): lowercase letters,
 * digits and single dashes, never at either end.
 *
 * Plain JS with JSDoc types; `slug.d.ts` next to it carries the declarations.
 */

const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/** `true` when `value` is a valid address segment. */
export function isValidSlug(value) {
  return typeof value === "string" && value.length <= 200 && SLUG_RE.test(value);
}

/**
 * Why a segment isn't valid, in the words the popover shows — or `null` when it is.
 * @param {unknown} value
 * @returns {string | null}
 */
export function slugError(value) {
  if (typeof value !== "string" || !value.length) return "Give it an address";
  if (/[A-Z]/.test(value)) return "Lowercase only";
  if (/[^a-z0-9-]/.test(value)) return "Only letters, numbers and dashes";
  if (/^-|-$/.test(value)) return "Can't start or end with a dash";
  if (/--/.test(value)) return "One dash at a time";
  if (value.length > 200) return "Too long";
  return null;
}
