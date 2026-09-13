// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { altFromName, embedFor, isMediaFile, mediaKind, mediaMarkdown, videoHtml } from "../src/toolbar/embeds";

describe("media files", () => {
  it("classifies by MIME type or extension", () => {
    expect(mediaKind("photo.png")).toBe("image");
    expect(mediaKind("PHOTO.JPEG")).toBe("image");
    expect(mediaKind("blob", "image/webp")).toBe("image");
    expect(mediaKind("clip.mp4")).toBe("video");
    expect(mediaKind("clip.MOV")).toBe("video");
    expect(mediaKind("blob", "video/webm")).toBe("video");
    expect(mediaKind("notes.txt")).toBeNull();
    expect(mediaKind("archive.zip", "application/zip")).toBeNull();
    expect(isMediaFile(new File([""], "a.gif", { type: "image/gif" }))).toBe(true);
    expect(isMediaFile(new File([""], "a.pdf", { type: "application/pdf" }))).toBe(false);
  });

  it("derives alt text from the file name", () => {
    expect(altFromName("sunset-over_the-bay.jpg")).toBe("sunset over the bay");
    expect(altFromName("IMG_0001.HEIC.png")).toBe("IMG 0001.HEIC");
  });

  it("writes an image as Markdown and a video as a raw <video> island", () => {
    expect(mediaMarkdown({ name: "my-photo.png", src: "./my-photo.png" })).toBe("![my photo](./my-photo.png)");
    expect(mediaMarkdown({ name: "a[b].png", src: "./a-b.png" })).toBe("![a\\[b\\]](./a-b.png)");
    expect(mediaMarkdown({ name: "clip.webm", src: "/media/blog/post/clip.webm" })).toBe('<video controls src="/media/blog/post/clip.webm"></video>');
    expect(videoHtml('/a"b&c<d.mp4')).toBe('<video controls src="/a&quot;b&amp;c&lt;d.mp4"></video>');
  });
});

describe("embedFor", () => {
  const yt = (id: string, start?: number) => `https://www.youtube-nocookie.com/embed/${id}${start ? `?start=${start}` : ""}`;

  it("recognizes every YouTube URL shape", () => {
    for (const url of [
      "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
      "https://youtube.com/watch?v=dQw4w9WgXcQ&list=PL123",
      "https://m.youtube.com/watch?v=dQw4w9WgXcQ",
      "https://youtu.be/dQw4w9WgXcQ",
      "https://youtu.be/dQw4w9WgXcQ?si=abc",
      "https://www.youtube.com/shorts/dQw4w9WgXcQ",
      "https://www.youtube.com/embed/dQw4w9WgXcQ",
      "https://www.youtube.com/live/dQw4w9WgXcQ?feature=share",
      "https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ",
    ]) {
      const embed = embedFor(url);
      expect(embed?.kind, url).toBe("youtube");
      expect(embed?.html, url).toContain(`src="${yt("dQw4w9WgXcQ")}"`);
      expect(embed?.html, url).toMatch(/^<figure class="embed"><iframe [^>]*><\/iframe><\/figure>$/);
    }
  });

  it("keeps a YouTube start time in every notation", () => {
    expect(embedFor("https://youtu.be/dQw4w9WgXcQ?t=90")?.html).toContain(yt("dQw4w9WgXcQ", 90));
    expect(embedFor("https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=90s")?.html).toContain(yt("dQw4w9WgXcQ", 90));
    expect(embedFor("https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=1m30s")?.html).toContain(yt("dQw4w9WgXcQ", 90));
    expect(embedFor("https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=1h2m3s")?.html).toContain(yt("dQw4w9WgXcQ", 3723));
    expect(embedFor("https://www.youtube.com/watch?v=dQw4w9WgXcQ&start=42")?.html).toContain(yt("dQw4w9WgXcQ", 42));
    expect(embedFor("https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=junk")?.html).toContain(`src="${yt("dQw4w9WgXcQ")}"`);
  });

  it("rejects YouTube URLs without a valid id", () => {
    expect(embedFor("https://www.youtube.com/watch?v=short")).toBeNull();
    expect(embedFor("https://www.youtube.com/channel/UC123")).toBeNull();
    expect(embedFor("https://youtu.be/")).toBeNull();
  });

  it("recognizes Vimeo", () => {
    for (const url of ["https://vimeo.com/123456789", "https://vimeo.com/123456789?share=copy", "https://player.vimeo.com/video/123456789", "https://vimeo.com/channels/staffpicks/123456789"]) {
      const embed = embedFor(url);
      expect(embed?.kind, url).toBe("vimeo");
      expect(embed?.html, url).toContain('src="https://player.vimeo.com/video/123456789"');
    }
    expect(embedFor("https://vimeo.com/about")).toBeNull();
  });

  it("recognizes X / Twitter posts and normalizes the link", () => {
    for (const url of ["https://twitter.com/astrodotbuild/status/1234567890", "https://x.com/astrodotbuild/status/1234567890?s=20", "https://mobile.twitter.com/astrodotbuild/statuses/1234567890"]) {
      const embed = embedFor(url);
      expect(embed?.kind, url).toBe("tweet");
      expect(embed?.html, url).toBe(
        '<figure class="embed"><blockquote class="twitter-tweet"><a href="https://twitter.com/astrodotbuild/status/1234567890">Post by @astrodotbuild</a></blockquote>' +
          '<script async src="https://platform.twitter.com/widgets.js" charset="utf-8"></script></figure>',
      );
    }
    expect(embedFor("https://x.com/astrodotbuild")).toBeNull();
    expect(embedFor("https://x.com/i/web")).toBeNull();
  });

  it("turns a direct video link into a <video>", () => {
    expect(embedFor("https://cdn.example.test/clip.mp4?v=2")).toEqual({ kind: "video", html: '<video controls src="https://cdn.example.test/clip.mp4?v=2"></video>' });
    expect(embedFor("https://cdn.example.test/clip.webm")?.kind).toBe("video");
    expect(embedFor("https://cdn.example.test/clip.mp3")).toBeNull();
  });

  it("only takes a lone http(s) URL", () => {
    expect(embedFor("")).toBeNull();
    expect(embedFor("  https://youtu.be/dQw4w9WgXcQ  ")?.kind).toBe("youtube");
    expect(embedFor("see https://youtu.be/dQw4w9WgXcQ")).toBeNull();
    expect(embedFor("https://youtu.be/dQw4w9WgXcQ and more")).toBeNull();
    expect(embedFor("ftp://youtu.be/dQw4w9WgXcQ")).toBeNull();
    expect(embedFor("not a url")).toBeNull();
    expect(embedFor("https://example.test/page")).toBeNull();
  });
});
