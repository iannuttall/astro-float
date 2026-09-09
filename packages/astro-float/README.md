# astro-float

Minimal on-page content editor for Astro content collections. Click **Edit** in the Astro Dev Toolbar: the rendered entry — title, description, Markdown body — is editable in place with a grey hover wash, and a sidebar holds only what isn't on the page (remaining fields, collection, Save). Writes go straight back to the `.md`/`.mdx` on disk during `astro dev`. Adds nothing to production builds.

```js
// astro.config.mjs
import astroFloat from "astro-float";

export default defineConfig({
  integrations: [astroFloat()],
});
```

See the [repository README](../../README.md) for the full walkthrough, options and design notes.
