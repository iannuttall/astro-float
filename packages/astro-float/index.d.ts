import type { AstroIntegration } from "astro";

export interface AstroFloatCollectionOptions {
  /** Directory holding the collection's Markdown, relative to the project root. Defaults to `src/content/<name>`. */
  dir?: string;
  /** Route pattern for entries, e.g. `/blog/[id]`. When omitted Float learns it from the pages you visit. */
  route?: string;
}

export interface AstroFloatOptions {
  /** Root content directory, relative to the project root. Defaults to `<srcDir>/content`. */
  contentDir?: string;
  /**
   * Explicit collections. When omitted, every directory under `contentDir` that
   * contains Markdown files is treated as a collection.
   */
  collections?: Record<string, AstroFloatCollectionOptions>;
  /** Answer requests that don't come from localhost (e.g. `astro dev --host`). Off by default. */
  allowRemote?: boolean;
  /** Maximum image upload size in bytes. Default 15 MB. */
  maxUploadBytes?: number;
}

export default function astroFloat(options?: AstroFloatOptions): AstroIntegration;
