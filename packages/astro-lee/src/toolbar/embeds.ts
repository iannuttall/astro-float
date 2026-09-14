/**
 * Rich media for the body editor, zero configuration:
 *
 * - Which dropped / pasted files Lee accepts (images, videos) and what each
 *   one becomes in the Markdown: `![alt](./photo.png)` for an image, a raw
 *   `<video>` block for a video (Markdown allows raw HTML; the client keeps
 *   the block as an island so it moves and removes as one piece).
 * - Which pasted URLs turn into an embed when they land on an empty line:
 *   YouTube, Vimeo, X / Twitter, and a direct link to a video file.
 *
 * Everything here is pure: no DOM, no network.
 */

export type MediaKind = "image" | "video";

const IMAGE_EXT = /\.(png|jpe?g|gif|webp|avif|svg)$/i;
const VIDEO_EXT = /\.(mp4|webm|mov|m4v)$/i;

/** What a file is to Lee, by MIME type or extension. `null` = not accepted. */
export function mediaKind(name: string, type = ""): MediaKind | null {
  if (type.startsWith("image/") || IMAGE_EXT.test(name)) return "image";
  if (type.startsWith("video/") || VIDEO_EXT.test(name)) return "video";
  return null;
}

export function isMediaFile(file: File): boolean {
  return mediaKind(file.name, file.type) !== null;
}

/** Alt text from a file name: `sunset-over-bay.jpg` → `sunset over bay`. */
export function altFromName(name: string): string {
  return name.replace(/\.[^.]+$/, "").replace(/[-_]+/g, " ");
}

/** The Markdown for an uploaded file, given what the server saved it as. */
export function mediaMarkdown(item: { name: string; src: string }): string {
  if (mediaKind(item.name) === "video") return videoHtml(item.src);
  return `![${altFromName(item.name).replace(/[\[\]]/g, "\\$&")}](${item.src})`;
}

export function videoHtml(src: string): string {
  return `<video controls src="${escapeAttr(src)}"></video>`;
}

export interface Embed {
  kind: "youtube" | "vimeo" | "tweet" | "video";
  /**
   * One raw-HTML block. Always a single element, so it lines up with one DOM
   * node. Third-party embeds sit in a `<figure class="embed">`: the wrapper is
   * what the editor selects (an iframe eats clicks), what survives a widget
   * script rewriting its inside, and what a site can style.
   */
  html: string;
}

/**
 * Turn a pasted URL into an embed block, or `null` when it isn't one we know.
 * Only a lone URL qualifies (no surrounding text).
 */
export function embedFor(text: string): Embed | null {
  const raw = text.trim();
  if (!raw || /\s/.test(raw)) return null;
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return null;
  const host = url.hostname.replace(/^www\.|^m\./, "").toLowerCase();

  const youtube = youtubeId(url, host);
  if (youtube) {
    const start = youtubeStart(url);
    const src = `https://www.youtube-nocookie.com/embed/${youtube}${start ? `?start=${start}` : ""}`;
    return {
      kind: "youtube",
      html:
        `<figure class="embed"><iframe src="${src}" title="YouTube video" width="560" height="315" ` +
        `allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share" ` +
        `allowfullscreen loading="lazy"></iframe></figure>`,
    };
  }

  const vimeo = vimeoId(url, host);
  if (vimeo) {
    return {
      kind: "vimeo",
      html:
        `<figure class="embed"><iframe src="https://player.vimeo.com/video/${vimeo}" title="Vimeo video" width="640" height="360" ` +
        `allow="autoplay; fullscreen; picture-in-picture" allowfullscreen loading="lazy"></iframe></figure>`,
    };
  }

  const tweet = tweetUrl(url, host);
  if (tweet) {
    // Link text is not the URL: in MDX the children are Markdown and GFM would autolink it again.
    // Twitter's own embed markup, in the same wrapper as the other embeds so the
    // block stays one element when widgets.js swaps the blockquote for the card.
    return {
      kind: "tweet",
      html:
        `<figure class="embed"><blockquote class="twitter-tweet"><a href="${escapeAttr(tweet.url)}">${escapeText(tweet.label)}</a></blockquote>` +
        `<script async src="https://platform.twitter.com/widgets.js" charset="utf-8"></script></figure>`,
    };
  }

  if (VIDEO_EXT.test(url.pathname)) return { kind: "video", html: videoHtml(url.href) };

  return null;
}

function youtubeId(url: URL, host: string): string | null {
  const ID = /^[A-Za-z0-9_-]{11}$/;
  if (host === "youtu.be") {
    const id = url.pathname.slice(1).split("/")[0];
    return ID.test(id) ? id : null;
  }
  if (host !== "youtube.com" && host !== "youtube-nocookie.com") return null;
  if (url.pathname === "/watch") {
    const id = url.searchParams.get("v") ?? "";
    return ID.test(id) ? id : null;
  }
  const m = url.pathname.match(/^\/(?:embed|shorts|live|v)\/([A-Za-z0-9_-]{11})(?:[/?]|$)/);
  return m ? m[1] : null;
}

/** `t=90`, `t=90s`, `t=1m30s`, `start=90` → seconds. */
function youtubeStart(url: URL): number {
  const t = url.searchParams.get("t") ?? url.searchParams.get("start") ?? "";
  if (/^\d+s?$/.test(t)) return parseInt(t, 10);
  const m = t.match(/^(?:(\d+)h)?(?:(\d+)m)?(?:(\d+)s)?$/);
  if (!m || !t) return 0;
  return (parseInt(m[1] ?? "0", 10) * 3600) + (parseInt(m[2] ?? "0", 10) * 60) + parseInt(m[3] ?? "0", 10);
}

function vimeoId(url: URL, host: string): string | null {
  if (host === "player.vimeo.com") {
    const m = url.pathname.match(/^\/video\/(\d+)/);
    return m ? m[1] : null;
  }
  if (host !== "vimeo.com") return null;
  const m = url.pathname.match(/^\/(?:[a-z]+\/[^/]+\/)?(\d+)(?:[/?]|$)/i);
  return m ? m[1] : null;
}

function tweetUrl(url: URL, host: string): { url: string; label: string } | null {
  if (host !== "twitter.com" && host !== "x.com" && host !== "mobile.twitter.com") return null;
  const m = url.pathname.match(/^\/([A-Za-z0-9_]{1,15})\/status(?:es)?\/(\d+)/);
  return m ? { url: `https://twitter.com/${m[1]}/status/${m[2]}`, label: `Post by @${m[1]}` } : null;
}

function escapeAttr(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");
}

function escapeText(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
