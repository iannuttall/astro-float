import type { Collection } from "./api";

const ROUTES_KEY = "astro-float:routes";

export interface DetectedEntry {
  collection: string;
  id: string;
  via: "attribute" | "url";
}

/**
 * Work out which collection entry the current page renders.
 *
 * 1. An explicit binding wins: `<article data-float-entry="blog:hello-world">`.
 * 2. Otherwise match the tail of the URL path against every entry id
 *    (`/blog/2024/hello/` tries `blog/2024/hello`, `2024/hello`, `hello`).
 */
export function detectEntry(collections: Collection[]): DetectedEntry | null {
  const bound = document.querySelector<HTMLElement>("[data-float-entry]")?.dataset.floatEntry;
  if (bound) {
    const i = bound.indexOf(":");
    if (i > 0) {
      const collection = bound.slice(0, i);
      const id = bound.slice(i + 1);
      if (collections.some((c) => c.name === collection && c.entries.some((e) => e.id === id))) {
        learnRoute(collection, id);
        return { collection, id, via: "attribute" };
      }
    }
  }

  const segments = location.pathname.split("/").filter(Boolean).map(safeDecode);
  for (let k = 1; k <= segments.length; k++) {
    const candidate = segments.slice(segments.length - k).join("/");
    const hits = collections.filter((c) => c.entries.some((e) => e.id === candidate));
    if (hits.length === 1) {
      learnRoute(hits[0].name, candidate);
      return { collection: hits[0].name, id: candidate, via: "url" };
    }
  }
  return null;
}

function safeDecode(s: string) {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
}

function loadRoutes(): Record<string, string> {
  try {
    return JSON.parse(localStorage.getItem(ROUTES_KEY) ?? "{}");
  } catch {
    return {};
  }
}

/** Remember `/blog/[id]/` style patterns from pages we've seen, so lists and "new entry" can link. */
function learnRoute(collection: string, id: string) {
  const path = location.pathname;
  const encoded = id.split("/").map(encodeURIComponent).join("/");
  for (const needle of [id, encoded]) {
    const idx = path.lastIndexOf(needle);
    if (idx === -1) continue;
    const after = path.slice(idx + needle.length);
    if (after !== "" && after !== "/") continue;
    const pattern = `${path.slice(0, idx)}[id]${after}`;
    const routes = loadRoutes();
    if (routes[collection] !== pattern) {
      routes[collection] = pattern;
      localStorage.setItem(ROUTES_KEY, JSON.stringify(routes));
    }
    return;
  }
}

/** Configured route → learned route → `/collection/id/` guess. */
export function routeFor(collection: Collection, id: string): { href: string; guessed: boolean } {
  const pattern = collection.route ?? loadRoutes()[collection.name];
  const encoded = id.split("/").map(encodeURIComponent).join("/");
  if (pattern) {
    const href = pattern.replace(/\[\.{0,3}[^\]]+\]/, encoded);
    return { href: href.startsWith("/") ? href : `/${href}`, guessed: false };
  }
  return { href: `/${encodeURIComponent(collection.name)}/${encoded}/`, guessed: true };
}

/** Elements that belong to dev tooling, not the page: never swapped out. */
const KEEP_SELECTOR =
  "astro-dev-toolbar, [data-astro-float-host], .astro-float-region, .astro-float-bubble, .astro-float-bar, .astro-float-frame, .astro-float-dropline";

/**
 * Render a page in place: fetch its HTML from the dev server and swap
 * everything except dev-tooling elements (the Astro toolbar and Float itself).
 * With no URL it re-renders the current page — scroll position, the editor
 * and its focus all survive. With a URL it's a soft navigation.
 */
export async function swapPage(href: string = location.href): Promise<void> {
  const res = await fetch(href, { headers: { accept: "text/html" }, cache: "no-store" });
  if (!res.ok) throw new Error(`page fetch failed (${res.status})`);
  const contentType = res.headers.get("content-type") ?? "";
  if (!contentType.includes("text/html")) throw new Error("not an HTML page");
  const html = await res.text();
  const next = new DOMParser().parseFromString(html, "text/html");

  document.title = next.title;

  const keep = new Set(Array.from(document.body.querySelectorAll(`:scope > :is(${KEEP_SELECTOR})`)));
  for (const node of Array.from(document.body.childNodes)) {
    if (!keep.has(node as Element)) node.remove();
  }
  for (const attr of Array.from(document.body.attributes)) document.body.removeAttribute(attr.name);
  for (const attr of Array.from(next.body.attributes)) document.body.setAttribute(attr.name, attr.value);

  const anchor = document.body.firstChild;
  const incoming = Array.from(next.body.childNodes).filter((n) => !(n instanceof Element && n.matches(KEEP_SELECTOR)));
  for (const node of incoming) {
    document.body.insertBefore(document.adoptNode(node), anchor);
  }

  // Dev styles are inlined per component in <head>; merge any new ones in.
  const haveStyles = new Set(
    Array.from(document.head.querySelectorAll("style, link[rel=stylesheet]")).map((s) => s.outerHTML),
  );
  for (const style of Array.from(next.head.querySelectorAll("style, link[rel=stylesheet]"))) {
    if (!haveStyles.has(style.outerHTML)) document.head.appendChild(document.adoptNode(style));
  }
}
