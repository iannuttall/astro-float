export interface Block {
  type: string;
  island: boolean;
  text: string;
  src: string;
  trailer: string;
}

/** Split a Markdown body into the blocks the visual editor lines up with. */
export function splitBlocks(body: string, options?: { mdx?: boolean }): { lead: string; blocks: Block[] };

/** Split a Markdown document into frontmatter data + body. */
export function parseDocument(raw: string): { frontmatter: Record<string, unknown>; body: string; hadFrontmatter: boolean };

/** Write a document back; unchanged keys keep their source text from `previous`. */
export function serializeDocument(frontmatter: Record<string, unknown>, body: string, previous?: string): string;
