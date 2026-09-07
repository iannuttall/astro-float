---
title: Notes on autosave
description: Saving on every keystroke is easy. Saving without wrecking the page is the part that matters.
pubDate: 2026-08-02
tags:
  - astro
  - dev-tools
draft: true
---

When a Markdown file inside a content collection changes, Astro's content layer re-syncs it and asks the browser to reload. That is exactly right for edits coming from your editor, and exactly wrong for edits you are typing *into the page that would reload*.

Float threads the needle:

1. It writes the file.
2. It waits for Astro to finish syncing (the reload request is the signal).
3. It swallows that one reload. If your caret is in the text, the page you are looking at simply stays; if you saved from the rail, it fetches the fresh HTML and swaps it in place.

Your scroll position and your caret survive. Edits from anywhere else still reload the page like normal.

## What autosave actually does

With autosave on, the float waits about 800ms after you stop typing and then runs the same save path as ⌘S. With it off, a Save button appears at the bottom of the rail the moment the page differs from disk.

## What actually gets written

Only the paragraphs you touched are re-serialized from HTML back to Markdown. Every other block goes back to disk byte-for-byte, so a one-word fix is a one-line diff in git.

This post is marked as a draft, so the badge on the index is the frontmatter `draft: true` doing its thing. Flip it in **Fields** and watch it disappear.
