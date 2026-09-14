import type { CollectionSchema } from "./schema";

export const API_BASE = "/__lee/api";

export interface EntrySummary {
  id: string;
  title: string;
  file: string;
  folder: boolean;
}

export interface Collection {
  name: string;
  dir: string;
  route?: string;
  entries: EntrySummary[];
}

export type Frontmatter = Record<string, unknown>;

export interface SourceBlock {
  type: string;
  src: string;
  trailer: string;
  /** MDX component / raw HTML: atomic on the page, source always written back verbatim. */
  island?: boolean;
}

export interface EntryDoc {
  collection: string;
  id: string;
  file: string;
  folder: boolean;
  mdx: boolean;
  /** Absolute directory of the entry file (dev only; used to relativize image URLs). */
  absDir: string;
  frontmatter: Frontmatter;
  body: string;
  lead: string;
  blocks: SourceBlock[];
  hash: string;
  /** The collection's schema (`source: "zod"` from content.config.ts, `"inferred"` from values); null only if it couldn't be read. */
  schema: CollectionSchema | null;
}

export interface SaveResult {
  file: string;
  hash: string;
  changed: boolean;
  synced: boolean;
  body: string;
  lead: string;
  blocks: SourceBlock[];
}

/** What a rename came back with: the entry's new id, file and page (and hash, when links in the text had to follow). */
export interface RenameResult {
  collection: string;
  id: string;
  file: string;
  route: string;
  hash: string;
  changed: boolean;
  synced: boolean;
}

/** One top-level block of a body, rendered by Astro's Markdown pipeline. Islands come back with `html: ""`. */
export interface RenderedBlock {
  type: string;
  island: boolean;
  html: string;
}

export interface MediaItem {
  name: string;
  src: string;
  url: string;
}

/** One thing the collection's schema rejected: `path` names the field (a Zod path, or "body"). */
export interface ValidationIssue {
  path: string | Array<string | number>;
  message: string;
}

export class ApiError extends Error {
  status: number;
  /** A 422 `{ error: "validation", issues }` carries what was wrong, field by field. */
  issues?: ValidationIssue[];
  constructor(status: number, message: string, issues?: ValidationIssue[]) {
    super(message);
    this.status = status;
    if (issues?.length) this.issues = issues;
  }
}

/** The dev server saw a content file change (an editor, git…). Fields are whatever it could tell. */
export interface FileChange {
  collection?: string;
  id?: string;
  file?: string;
  hash?: string;
}

/** `{ collection, id, hash }` of an entry file that changed on disk — an outside edit, or a Lee save from another tab (see `api.onFileChanged`). Compare `hash` with the doc you hold: equal means it was your own save. */
/** What the server sends: the same shape, every field present. */
export type FileChanged = Required<Pick<FileChange, "collection" | "id" | "hash">>;

/** What the CLI's `doctor` and the popover read: the schema behind a collection and what it thinks of an entry. */
export interface Diagnosis {
  schema: "zod" | "inferred" | "none";
  strict: boolean;
  issues: ValidationIssue[];
}

interface ViteHot {
  on(event: string, cb: (data: unknown) => void): void;
  off?(event: string, cb: (data: unknown) => void): void;
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers);
  headers.set("x-lee", "1");
  if (init.body && typeof init.body === "string") headers.set("content-type", "application/json");

  let res: Response;
  try {
    res = await fetch(API_BASE + path, { ...init, headers, cache: "no-store" });
  } catch {
    throw new ApiError(0, "dev server unreachable");
  }

  const text = await res.text();
  let data: unknown = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    /* non-JSON error page */
  }
  if (!res.ok) {
    const body = data && typeof data === "object" ? (data as { error?: unknown; issues?: unknown }) : null;
    const message = body && "error" in body ? String(body.error) : res.statusText;
    const issues = Array.isArray(body?.issues)
      ? (body!.issues as unknown[]).filter((i): i is ValidationIssue => !!i && typeof i === "object" && "message" in i)
      : undefined;
    throw new ApiError(res.status, message || `HTTP ${res.status}`, issues);
  }
  return data as T;
}

/**
 * Content changed on disk outside Lee: the server tells Vite's HMR channel.
 * Nothing to subscribe to (no HMR, older server) means the callback never fires.
 */
export function onFileChanged(cb: (change: FileChange) => void): () => void {
  const hot = (import.meta as unknown as { hot?: { on(event: string, cb: (data: FileChange) => void): void; off?(event: string, cb: (data: FileChange) => void): void } }).hot;
  if (!hot?.on) return () => {};
  hot.on("astro-lee:file-changed", cb);
  return () => hot.off?.("astro-lee:file-changed", cb);
}

export const api = {
  collections: () => request<{ collections: Collection[] }>("/collections").then((r) => r.collections),

  /** Field definitions for a collection, derived from its Zod schema (see `toolbar/schema.ts`). */
  schema: (collection: string) => request<CollectionSchema>(`/schema?collection=${encodeURIComponent(collection)}`),

  entry: (collection: string, id: string) =>
    request<EntryDoc>(`/entry?collection=${encodeURIComponent(collection)}&id=${encodeURIComponent(id)}`),

  save: (payload: {
    collection: string;
    id: string;
    frontmatter: Frontmatter;
    body: string;
    baseHash: string;
    force?: boolean;
  }) => request<SaveResult>("/entry", { method: "PUT", body: JSON.stringify(payload) }),

  create: (payload: { collection: string; slug: string; title: string }) =>
    request<{ collection: string; id: string; file: string; synced: boolean }>("/entries", {
      method: "POST",
      body: JSON.stringify(payload),
    }),

  /** Change the last segment of an entry's id: the folder or file moves (with its media); 409 when the address is taken. */
  rename: (payload: { collection: string; id: string; slug: string; baseHash: string }) =>
    request<RenameResult>("/rename", { method: "POST", body: JSON.stringify(payload) }),

  /** Delete an entry: its file (or its folder, images and all) and its videos under public/media. */
  deleteEntry: (collection: string, id: string) =>
    request<{ collection: string; id: string; file: string; removed: string[]; synced: boolean }>(
      `/entry?collection=${encodeURIComponent(collection)}&id=${encodeURIComponent(id)}`,
      { method: "DELETE" },
    ),

  createCollection: (payload: { name: string; title: string }) =>
    request<{
      collection: string;
      id: string;
      file: string;
      dir: string;
      synced: boolean;
      config: { file: string; updated: boolean; created?: boolean; note?: string };
    }>("/collections", { method: "POST", body: JSON.stringify(payload) }),

  /** Delete a collection: its folder, its public/media folder, and its defineCollection() and key in the content config when that shape is recognised (`config.note` says when it wasn't). */
  deleteCollection: (name: string) =>
    request<{
      collection: string;
      entries: number;
      removed: string[];
      synced: boolean;
      config: { file: string | null; updated: boolean; note?: string };
    }>(`/collection?name=${encodeURIComponent(name)}`, { method: "DELETE" }),

  /**
   * Tell the server an edit session is on or off. While one is on, an outside
   * change to an entry file doesn't reload the page (which would drop the
   * draft); it arrives as `onFileChanged` instead. Any API call keeps the
   * session alive for another 60 s; `app.ts` also refreshes it on a timer.
   */
  session: (editing: boolean) =>
    request<{ editing: boolean }>("/session", { method: "POST", body: JSON.stringify({ editing }) }),

  /** The schema's verdict on the entry as it is on disk (a 422's `issues`, without saving). */
  diagnose: (collection: string, id: string) =>
    request<Diagnosis>(`/diagnose?collection=${encodeURIComponent(collection)}&id=${encodeURIComponent(id)}`),

  /**
   * Called when an entry file changes on disk (your editor, git, another tab's
   * Lee save), after Astro has re-synced it. Rides Vite's HMR socket, so it
   * needs the dev server's client; returns an unsubscribe. Does nothing (and
   * returns a no-op) when HMR isn't available.
   */
  onFileChanged: (cb: (change: FileChanged) => void): (() => void) => {
    const hot = (import.meta as ImportMeta & { hot?: ViteHot }).hot;
    if (!hot) return () => {};
    const handler = (data: unknown) => {
      if (data && typeof data === "object" && "collection" in data && "id" in data) cb(data as FileChanged);
    };
    hot.on("astro-lee:file-changed", handler);
    return () => hot.off?.("astro-lee:file-changed", handler);
  },

  /** Render a draft body block by block (same split as `EntryDoc.blocks`); called while typing in the Markdown tab. */
  render: (payload: { collection: string; id: string; body: string }) =>
    request<{ blocks: RenderedBlock[] }>("/render", { method: "POST", body: JSON.stringify(payload) }),

  media: (collection: string, id: string) =>
    request<{ media: MediaItem[] }>(
      `/media?collection=${encodeURIComponent(collection)}&id=${encodeURIComponent(id)}`,
    ).then((r) => r.media),

  upload: (collection: string, id: string, file: File) =>
    request<MediaItem & { file: string }>(
      `/media?collection=${encodeURIComponent(collection)}&id=${encodeURIComponent(id)}&name=${encodeURIComponent(file.name)}`,
      { method: "POST", body: file, headers: { "content-type": file.type || "application/octet-stream" } },
    ),
};
