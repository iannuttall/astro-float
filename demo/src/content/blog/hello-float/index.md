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

What *is* different is the little icon in the Astro dev toolbar at the bottom of the window. Click it and two things happen: a thin vertical rail docks to the edge of the viewport, and **this text becomes editable**. Click anywhere in the article and type.

## Try it

1. Toggle the Float icon in the dev toolbar.
2. Click into this paragraph and change a word. A dark Save button appears at the bottom of the rail.
3. Press ⌘S (or Ctrl+S), or click that button. Or turn on autosave in Settings and forget about it.

Start a new line and type `## ` for a heading, `- ` for a list, `> ` for a quote, or three backticks for code. Tab nests list items. ⌘B and ⌘I do what you expect.

## Why not a CMS?

Because most of the time you just want to fix a typo while looking at the page. A separate admin URL, a login, and a database are a lot of ceremony for that.

The rail is only for the things that can't live in the prose: frontmatter fields, images, other entries in the collection, and a read-only view of the Markdown that is about to hit disk.
