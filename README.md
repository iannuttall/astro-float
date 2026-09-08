# astro-float

A proof-of-concept content editor for Astro content collections that lives **on the page**. Click **Edit** in the Astro Dev Toolbar and the rendered entry becomes editable where it sits — title, description, Markdown body. Anything you can edit takes a quiet grey wash when you hover it; that's the whole visual language. Turn Edit off and the page is exactly what your visitors see.

Everything else — the rest of the frontmatter, the collection (open, new entry, new collection), a read-only view of the Markdown about to hit disk, settings — hangs off the Astro bar in one of three interchangeable shells you can flip between in Settings. No `/admin`, no desktop app, no CMS studio, no side textarea, no second always-on bar. Dev-only: the integration adds nothing to production builds.

![Edit off: an ordinary page with the Astro dev toolbar](docs/mode-off.png)

## Preview it

```sh
git clone https://github.com/iannuttall/astro-float
cd astro-float
pnpm install
pnpm dev            # or: pnpm --filter demo exec astro dev
```

Open <http://localhost:4321/blog/hello-float/>, hover the bottom edge to reveal the Astro toolbar, and click the pencil (**Edit**). Hover the title or the article — grey means editable — and type. Click Edit again to leave (unsaved work is saved first).

> Local `astro dev` is the only real preview path — the editor writes to your filesystem. A Vercel/Netlify preview would only show the plain blog, since the integration is stripped from builds.

## Three shells, one switch

The panels are identical; what differs is where they hang. **Settings → Chrome** switches between them (dev-only, remembered in `localStorage`). The demo defaults to **Toolbar**, the quietest.

| | | |
| --- | --- | --- |
| **Toolbar** *(default)* | ![](docs/mode-toolbar.png) | Nothing but the Astro bar. While Edit is on, a small pill popover sits just above it: mode label, entry, Fields · Collection · Source · Settings, and the status dot that becomes **Save** when the page differs from disk. Panels open above the pill and close when you navigate. |
| **Float** | ![](docs/mode-float.png) | A vertical rail at the right edge, **born tucked** — it fades in already half-hidden and never slides out first. Hover (or tap) brings it out; an open panel or unsaved work keeps it out. Astro-style caret tooltips. Panels open beside it. |
| **Sheet** | ![](docs/mode-sheet.png) | A docked, tabbed panel that exists only while Edit is on and leaves when it's off. Always shows a tab (Fields by default), collapsible to a slim edge handle. Left or right. |

<p>
  <img src="docs/mode-float-hover.png" width="120" alt="Float rail brought out by hover">
  <img src="docs/mode-sheet-collapsed.png" width="120" alt="Sheet collapsed to its edge handle">
  <img src="docs/mobile/toolbar.webp" width="160" alt="Toolbar mode on a phone">
  <img src="docs/mobile/float.webp" width="160" alt="Float mode on a phone">
  <img src="docs/mobile/sheet.webp" width="160" alt="Sheet mode on a phone">
</p>

## On the page

| | |
| --- | --- |
| **Grey = editable** | With Edit on, hovering the title, the description, the body or any other bound field paints a soft grey wash (lighter while your caret is inside). Same treatment everywhere; no frames, no dashes. |
| **Type** | The body under `[data-float-body]` is `contenteditable`. Native caret, native undo, native spellcheck. Links don't navigate while editing (⌘-click does). |
| **Title & co.** | Elements marked `data-float-field="title"` (any string frontmatter key printed verbatim) are plain-text editable — Enter finishes. Two-way synced with the Fields panel, saved through the same path. Fields that aren't on the page live in the panel. |
| **Components** | MDX components and raw-HTML blocks are **islands**: no caret goes in, and clicking one shows a small bar — move up / down, drag grip, remove (inline confirm). Their source is written back verbatim wherever they end up. Backspace against an island selects it instead of eating it. |
| **Save** | Status dot → **Save** button the moment the page differs from disk; it stays put while you type. **⌘S / Ctrl+S** anywhere. Optional autosave (800ms after you stop typing). Turning Edit off saves first. |
| **Shortcuts** | At the start of an empty line: `# `…`###### `, `- ` / `* `, `1. `, `> `, ``` ``` ```. **Tab / ⇧Tab** nest lists. **⌘B / ⌘I / ⌘K**. In a code block Enter is a newline, ⇧Enter leaves it. **Esc** leaves the text. |
| **Images** | Drop or paste onto the prose. The file is copied **next to the entry**, appears where you dropped it, and is written as `![alt](./photo.png)`. |
| **Live preview** | While your caret is in the text, a save doesn't touch the DOM. Save from the chrome (caret elsewhere) and Astro re-renders the page in place, no reload. |
| **Moving around** | While Edit is on, same-origin links, back/forward and Float's own create flows are soft navigations — fetch + swap under the chrome, pending edits saved first, no "Leave site?". Edit off: links behave exactly as normal. |

<img src="docs/float-island.png" width="520" alt="A selected MDX component block with its move / drag / remove bar">

### On a phone

Below 640px every shell lives inside a box the size of the **visual viewport** (tracked via `visualViewport`), so the on-screen keyboard shrinks panels instead of hiding their buttons: the popover and its panel sit above the Astro bar, the rail's panel is a sheet pinned top-left beside it, the sheet becomes a bottom sheet. Controls are 16px (no iOS focus-zoom), rail targets 44px, safe-area insets respected. Cancel on a form keeps the list where it was, blurs the field, and — if Safari did zoom — snaps the viewport back. Touch mode (no hover + a touchscreen): the rail's first tap only expands it; tapping the page tucks it.

## Using it in your own Astro project

```js
// astro.config.mjs
import { defineConfig } from "astro/config";
import astroFloat from "astro-float";

export default defineConfig({
  integrations: [astroFloat()],
});
```

Then mark what's editable:

```astro
---
const { Content } = await render(post);
---
<article data-float-entry={`blog:${post.id}`}>
  <h1 data-float-field="title">{post.data.title}</h1>
  <p data-float-field="description">{post.data.description}</p>
  <div class="prose" data-float-body>
    <Content />
  </div>
</article>
```

- `data-float-body` — required for on-page body editing. It must wrap **only** the rendered body, because its children are what gets written back as Markdown.
- `data-float-field="title"` — optional, on any element that prints a string frontmatter value verbatim. Skipped automatically if the rendered text doesn't match the value (formatted dates etc.).
- `data-float-entry="collection:id"` — optional. Without it Float matches the URL tail against entry ids.

Zero config otherwise: every directory under `src/content/` that holds Markdown is a collection. Options, all optional:

```js
astroFloat({
  contentDir: "src/content",            // where collections live
  collections: {                         // pin dirs/routes instead of discovering them
    blog: { dir: "src/content/blog", route: "/blog/[id]" },
  },
  allowRemote: false,                    // answer non-localhost requests (astro dev --host, tunnels)
  maxUploadBytes: 15 * 1024 * 1024,
});
```

### New collections and routes

"New collection" writes a `defineCollection()` with a glob loader and a starter schema (`title`, `description`, `pubDate`, `tags`, `draft`) into `src/content.config.ts` (or creates the file), and adds the key to `export const collections`. It's a text edit that only touches shapes it recognises; if it can't find `export const collections = { … }` it says so and leaves the file alone. Astro picks the change up without a restart.

A collection also needs pages. The demo ships generic `src/pages/[collection]/index.astro` and `src/pages/[collection]/[id].astro` routes that render any collection without a dedicated page, so `/til/first-entry/` works the moment it's created.

## How it works

- **Dev toolbar app.** `addDevToolbarApp()` registers "Edit" (only when `command === "dev"`). All chrome renders into the app's canvas, so Astro hides it when the app is off. Edit state persists across reloads in `sessionStorage`; `beforeTogglingOff` saves pending work first.
- **Block-level round trip.** The server parses the body with `mdast-util-from-markdown` (+ GFM, + MDX for `.mdx`) and returns each top-level block's exact source slice. The client lines those up with the body's top-level DOM children. On save it aligns the current DOM against that snapshot (LCS on outerHTML): unchanged blocks emit their **original Markdown byte-for-byte**; only edited or new blocks go through the HTML→Markdown serializer.
- **Islands.** `mdxJsxFlowElement`, raw `html` blocks and inline-JSX-only paragraphs are flagged by the server. On the client they get `contenteditable="false"`, a stable key, and are matched by that key (not by HTML) when serializing, so moving one just moves its source slice. Imports/exports and `{expressions}` are carried as non-rendering lead/trailers. An `.mdx` whose blocks don't line up is body-read-only (frontmatter still saves).
- **HTML→Markdown** (`src/toolbar/html-to-md.ts`) covers what remark-rehype + Shiki emit: ATX headings, paragraphs, tight/loose/nested lists, task lists, links + titles, images (Vite `/@fs/…` and Astro `/_image?href=…` URLs mapped back to `./relative`), inline code, fenced code with language, blockquotes, rules, GFM tables with alignment, strong / em / strike, hard breaks. Unknown elements pass through as raw HTML.
- **API.** `astro:server:setup` mounts `/__float/api/*`: collections, read/write entry, create entry, create collection, upload media. Localhost-only (host + socket address), same-origin, custom header on mutations, paths confined to the collection dir, image extension allowlist. Saves carry the file hash as loaded; a 409 gives you Reload / Overwrite.
- **No reload on save.** Astro's content layer full-reloads after a content change. `sync-gate.js` swallows that reload for a few seconds after a Float write and uses it as the "synced" signal, so save/create responses return once the store has the new content. Caret in the body → DOM left alone; otherwise fetch + swap everything but the toolbar. IDE edits still reload as normal.

## Known round-trip limits (v0)

Only blocks you edit are re-serialized, so these only bite inside a paragraph you actually touched:

- **Markdown style is normalized**: `*emphasis*`, `**strong**`, `-` bullets, `1.` numbering, ATX `#` headings, fenced code. Setext headings, `+`/`*` bullets, reference-style links and autolinks in an edited block come back as the inline/ATX forms.
- **Smartypants**: Astro renders `'`/`"` as `’`/`“”`; edited blocks write straight quotes back (renders the same).
- **Raw HTML** that renders to more than one element, **footnotes**, or remark plugins that add wrappers break block alignment → whole-body re-serialize for `.md` (Settings/Source say so), body-read-only for `.mdx`.
- **MDX**: component blocks are islands (move / remove only). Inline components inside a paragraph aren't islands — that paragraph is treated as text and would be rewritten with the component's rendered HTML if you edit it. Only tested with `.astro` components in the demo.
- **Escaping** is conservative: `* _ [ ] < \`` and line-leading `# - + > 1.` are escaped; `&` and single `~` are not.
- Programmatic conversions (typing `## ` etc.) aren't in the browser's undo stack. Native typing undo works.

## Intentionally out of scope for v0

- **Component picker** — browse the project's components and insert one from the chrome (the "agents build the component, Float inserts it" flow). Islands are the groundwork; the catalog/insert UI is the next pass.
- Zod schema awareness for Fields (types are inferred from values); the starter schema for new collections is fixed
- Inline formatting toolbar / link popover (⌘B / ⌘I / ⌘K + Markdown shortcuts only)
- Deleting / renaming entries or collections, git operations
- JSON/YAML data collections, remote loaders, live-loader / `<ClientRouter />` pages
- Auth, multi-user, anything outside `astro dev`

## Repo layout

```
packages/astro-float/   the integration (what you'd publish to npm)
  src/index.js            Astro integration: Dev Toolbar app + dev API
  src/server/api.js       /__float/api/* endpoints (localhost-only JSON)
  src/server/blocks.js    Markdown/MDX → top-level source blocks (mdast, with offsets, islands flagged)
  src/server/collections.js  create a collection: dir, content.config.ts wiring, seed entry
  src/server/content.js   frontmatter parse/serialize, collection discovery, entries, uploads
  src/server/sync-gate.js swallow Astro's post-save reload, signal "content synced"
  src/toolbar/app.ts      defineToolbarApp(): the Edit toggle
  src/toolbar/float.ts    edit-mode lifecycle, the three shells, panels, soft navigation
  src/toolbar/editor.ts   on-page contenteditable controller, block alignment, islands, grey wash
  src/toolbar/fields.ts   on-page frontmatter fields (title, description, …)
  src/toolbar/html-to-md.ts  HTML → Markdown for edited blocks
  src/toolbar/styles.ts   Astro-toolbar palette; popover / rail / sheet layouts; mobile
demo/                   a minimal Astro 5 blog (+ one .mdx post) + generic [collection] routes
docs/                   screenshots (docs/mobile/ for the phone set)
```

## Notes

- Astro prints `[glob-loader] Duplicate id … found` after every content save. That's Astro's own watcher log for changed files, not a Float bug.
- Astro's audit app strips `data-astro-source-*` attributes shortly after load; Float strips them first so component-rendered blocks don't look edited.
- If you delete an image that a post referenced, Astro's `.astro/` asset cache can 500 the page until you restart `astro dev`.
- Tested against Astro 5.18 / Vite 6 / Chrome (desktop + iPhone emulation). Real iOS Safari's `contenteditable` and keyboard behaviour are untested here; HTML5 drag of islands doesn't exist on touch (use ▲/▼).
- Prefs (chrome mode, dock side, autosave) live in `localStorage` under `astro-float:prefs`. Which panel is open is never persisted. `astro-float:pointer` = `coarse` | `fine` forces touch/mouse mode.
