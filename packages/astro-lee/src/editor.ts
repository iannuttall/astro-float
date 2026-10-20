/**
 * Lee's editing engine without the dev toolbar, for a page that hosts it
 * itself: the on-page visual editor and the Markdown source editor. Pair it
 * with `astro-lee/document` on the server for the block map and frontmatter.
 */
export { PageEditor, ensurePageStyle, type BodySource, type PageEditorHooks, type SaveSnapshot, type SourceBlock } from "./toolbar/editor";
export { SourceEditor, type SourceEditorHooks } from "./toolbar/source";
