# astro-float

Minimal on-page content editor for Astro content collections. Toggle it from the Astro Dev Toolbar; the rendered Markdown body becomes editable in place, a thin rail handles frontmatter, images and other entries, and everything writes back to the `.md` on disk during `astro dev`. Adds nothing to production builds.

```js
// astro.config.mjs
import astroFloat from "astro-float";

export default defineConfig({
  integrations: [astroFloat()],
});
```

See the [repository README](../../README.md) for the full walkthrough, options and design notes.
