// @ts-check
import mdx from "@astrojs/mdx";
import { defineConfig } from "astro/config";
import astroFloat from "astro-float";

export default defineConfig({
  site: "https://astro-float.example",
  integrations: [
    mdx(),
    // Dev-only. Zero config: every folder under src/content with Markdown in it
    // shows up as a collection. Routes are learned from the pages you visit;
    // pass `collections: { blog: { route: "/blog/[id]" } }` to pin them.
    astroFloat(),
  ],
});
