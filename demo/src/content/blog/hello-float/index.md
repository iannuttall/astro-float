---
title: Hello, Float
description: What this demo is, and how to poke at it.
pubDate: 2026-09-01
tags:
  - astro
  - editing
draft: false
---

This page is a Markdown file at `src/content/blog/hello-float/index.md`. Nothing about it is special — it is a normal Astro content collection entry.

What *is* different is the pencil in the Astro dev toolbar at the bottom of the window. Click it and two things happen: a sidebar docks to the right, and **this page becomes editable**. Hover the title, the description or this text — anything that turns grey takes a caret.

## Try it

1. Click the pencil in the dev toolbar.
2. Click into this paragraph and change a word. **Save** appears at the top of the sidebar.
3. Press ⌘S (or Ctrl+S), or click Save. Or turn on autosave in Settings and forget about it.

Select a word for bold, italic or a link. Start a new line and type `## ` for a heading, `- ` for a list, `> ` for a quote, or three backticks for code. Tab nests list items. The small control above a region copies its Markdown, or opens it as Markdown right here on the page.

## Why not a CMS?

Because most of the time you just want to fix a typo while looking at the page. A separate admin URL, a login, and a database are a lot of ceremony for that.

The sidebar only holds what isn't already on the page: the remaining frontmatter, the other entries, and Save.
