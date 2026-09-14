import type { AstroIntegration } from "astro";

export interface LeeCollectionOptions {
  /** Directory holding the collection's Markdown, relative to the project root. Defaults to `src/content/<name>`. */
  dir?: string;
  /** Route pattern for entries, e.g. `/blog/[id]`. When omitted Lee learns it from the pages you visit. */
  route?: string;
}

export interface LeeOptions {
  /** Root content directory, relative to the project root. Defaults to `<srcDir>/content`. */
  contentDir?: string;
  /**
   * Explicit collections. When omitted, every directory under `contentDir` that
   * contains Markdown files is treated as a collection.
   */
  collections?: Record<string, LeeCollectionOptions>;
  /** Answer requests that don't come from localhost (e.g. `astro dev --host`). Off by default. */
  allowRemote?: boolean;
  /** Maximum image upload size in bytes. Default 15 MB. */
  maxUploadBytes?: number;
  /** Maximum video upload size in bytes. Default 200 MB. Videos are saved under `public/media/`. */
  maxVideoBytes?: number;
}

export default function lee(options?: LeeOptions): AstroIntegration;
