# astro-float

Minimal on-page content editor for Astro content collections. Click **Edit** in the Astro Dev Toolbar and the rendered entry — title, description, Markdown body — is editable in place with a grey hover wash; the rest (fields, collection, source, settings) hangs off the bar as a popover, a tucked rail or a docked sheet, your pick. Writes go straight back to the `.md`/`.mdx` on disk during `astro dev`. Adds nothing to production builds.

```js
// astro.config.mjs
import astroFloat from "astro-float";

export default defineConfig({
  integrations: [astroFloat()],
});
```

See the [repository README](../../README.md) for the full walkthrough, options and design notes.
