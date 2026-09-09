---
title: On hairlines
description: A short note about borders, restraint, and why 1px still matters.
pubDate: 2026-08-18
tags:
  - design
draft: false
---

Most interface chrome can be replaced by a single 1px line at eight percent opacity. Not because the line is beautiful, but because it is quiet.

> Good tools disappear. The best ones leave a faint edge so you know where they were.

A few rules this demo's editor follows:

- one accent color, and it is almost black
- shadows that only show up when something floats
- monospace for anything that is really a file path or an id
- no gradients, no glows, no rounded-corner inflation

## Cool grays

Warm grays read as paper; cool grays read as instruments. For a developer tool that sits on top of *your* site, instrument is the right register — it should never compete with the content.

Here is a code block, mostly so there is something with a dark background on the page:

```ts
const line = "rgba(17, 19, 24, 0.09)";
const shadow = "0 12px 32px -12px rgba(16, 18, 24, 0.18)";
```
