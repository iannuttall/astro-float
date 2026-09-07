# astro-float

Minimal on-page content editor for Astro content collections. In `astro dev` the rendered Markdown body is editable in place and a thin rail (a vertical sibling of the Astro dev toolbar) handles frontmatter, collections and entries; everything writes back to the `.md` on disk. Adds nothing to production builds.

```js
// astro.config.mjs
import astroFloat from "astro-float";

export default defineConfig({
  integrations: [astroFloat()],
});
```

See the [repository README](../../README.md) for the full walkthrough, options and design notes.
