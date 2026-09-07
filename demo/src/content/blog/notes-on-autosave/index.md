---
title: Notes on autosave
description: Saving on every keystroke is easy. Saving without wrecking the page is the part that matters.
pubDate: 2026-08-02
tags:
  - astro
  - dev-tools
draft: true
---

When a Markdown file inside a content collection changes, Astro's content layer re-syncs it and asks the browser to reload. That is exactly right for edits coming from your editor, and exactly wrong for edits coming from a text area *on the page you are reloading*.

Float threads the needle:

1. It writes the file.
2. It waits for Astro to finish syncing (the reload request is the signal).
3. It swallows that one reload and instead fetches the fresh HTML and swaps it in place.

Your scroll position, the editor, and your caret all survive. Edits from anywhere else still reload the page like normal.

## What autosave actually does

With autosave on, the float waits about 700ms after you stop typing and then runs the same save path as ⌘S. With it off, a Save button appears the moment the draft differs from disk.

This post is marked as a draft, so the badge on the index is the frontmatter `draft: true` doing its thing. Flip it in **Fields** and watch it disappear.
