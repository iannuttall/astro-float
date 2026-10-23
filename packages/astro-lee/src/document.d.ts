export interface Block {
  type: string;
  island: boolean;
  text: string;
  src: string;
  trailer: string;
  /** Set on a block that is only an HTML comment (`<!-- members -->` → "members"). */
  comment?: string;
}

/** Split a Markdown body into the blocks the visual editor lines up with. */
export function splitBlocks(body: string, options?: { mdx?: boolean }): { lead: string; blocks: Block[] };

/** Split a Markdown document into frontmatter data + body. */
export function parseDocument(raw: string): { frontmatter: Record<string, unknown>; body: string; hadFrontmatter: boolean };

/** Write a document back; unchanged keys keep their source text from `previous`. */
export function serializeDocument(frontmatter: Record<string, unknown>, body: string, previous?: string): string;

export interface RenderedBlock {
  type: string;
  island: boolean;
  html: string;
}

/** Render a body block by block with the project's Markdown pipeline (the Markdown tab's live preview). Islands come back as `html: ""`. */
export function renderBlocks(body: string, renderMarkdown: (markdown: string) => Promise<string>, options?: { mdx?: boolean }): Promise<RenderedBlock[]>;

import type { FieldDef } from "./toolbar/schema";

/** Top-level tags and repeated short-text fields with `values` (suggestions): what the entries already use, most used first. */
export function withFieldValues(fields: FieldDef[], frontmatters: Array<Record<string, unknown>>): FieldDef[];
