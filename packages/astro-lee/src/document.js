// The pure halves of Lee's server for hosted editors: split a body into the
// blocks the visual editor lines up with, and read or write a document's
// frontmatter keeping unchanged keys byte for byte.
export { splitBlocks } from "./server/blocks.js";
export { parseDocument, serializeDocument } from "./shared/document.js";
