# astro-float

Minimal floating content editor for Astro content collections. Lives in the Astro Dev Toolbar; edits Markdown bodies, frontmatter and colocated images on disk during `astro dev`. Adds nothing to production builds.

```js
// astro.config.mjs
import astroFloat from "astro-float";

export default defineConfig({
  integrations: [astroFloat()],
});
```

See the [repository README](../../README.md) for the full walkthrough, options and design notes.
