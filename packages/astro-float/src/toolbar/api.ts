export const API_BASE = "/__float/api";

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

export interface MediaItem {
  name: string;
  src: string;
  url: string;
}

export class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers);
  headers.set("x-astro-float", "1");
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
    const message =
      data && typeof data === "object" && "error" in data ? String((data as { error: unknown }).error) : res.statusText;
    throw new ApiError(res.status, message || `HTTP ${res.status}`);
  }
  return data as T;
}

export const api = {
  collections: () => request<{ collections: Collection[] }>("/collections").then((r) => r.collections),

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

  createCollection: (payload: { name: string; title: string }) =>
    request<{
      collection: string;
      id: string;
      file: string;
      dir: string;
      synced: boolean;
      config: { file: string; updated: boolean; created?: boolean; note?: string };
    }>("/collections", { method: "POST", body: JSON.stringify(payload) }),

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
