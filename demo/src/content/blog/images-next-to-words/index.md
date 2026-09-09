---
title: Images next to words
description: Colocated assets, relative paths, and letting Astro do the optimising.
pubDate: 2026-07-14
tags:
  - images
draft: false
---

Every post in this demo is a folder with an `index.md` inside. That makes the folder a natural home for the post's images.

When you drop an image onto this article, Float copies the file into this folder, shows it right here in the prose, and writes a plain relative Markdown link when you save:

```md
![diagram](./diagram.png)
```

Astro resolves that path at build time and runs the image through its normal asset pipeline, so you get responsive `width`/`height` attributes and hashed filenames in production for free.

## Try it

Drag any PNG or JPEG from your desktop onto this text. The file lands in `src/content/blog/images-next-to-words/` and the picture appears where you dropped it. Pasting an image from the clipboard works too.
