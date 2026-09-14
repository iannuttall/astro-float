// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { splitBlocks } from "../src/server/blocks.js";
import { blockToMarkdown, isBlockElement, type SerializeContext } from "../src/toolbar/html-to-md";
import { containerFrom, fixtureFiles, readFixture, renderMarkdown } from "./helpers";

const identity: SerializeContext = { imageSrc: (src) => src };

function serializeAll(container: HTMLElement, ctx: SerializeContext = identity): string {
  return Array.from(container.childNodes)
    .map((node) => blockToMarkdown(node, ctx))
    .filter(Boolean)
    .join("\n\n");
}

/** Render, then flag raw-HTML blocks as islands the way the editor does from the server's split. */
async function roundTrip(md: string): Promise<string> {
  const container = containerFrom(await renderMarkdown(md));
  const { blocks } = splitBlocks(md);
  if (blocks.length === container.childNodes.length) {
    blocks.forEach((b, i) => {
      if (b.island) (container.childNodes[i] as HTMLElement).setAttribute("data-float-island", "");
    });
  }
  return serializeAll(container);
}

describe("Markdown → Astro HTML → Markdown", () => {
  it.each(fixtureFiles("roundtrip", ".md"))("%s round-trips byte for byte", async (_name, md) => {
    expect(await roundTrip(md)).toBe(md.trimEnd());
  });

  it("normalizes styles that don't survive (setext, + bullets, autolinks, `*` emphasis)", async () => {
    const md = ["Setext", "======", "", "+ plus bullet", "+ another", "", "<https://example.test/>", "", "_underscore emphasis_ and __underscore strong__", "", "```", "no language", "```"].join("\n");
    expect(await roundTrip(md)).toBe(
      ["# Setext", "- plus bullet\n- another", "[https://example.test/](https://example.test/)", "*underscore emphasis* and **underscore strong**", "```\nno language\n```"].join("\n\n"),
    );
  });
});

describe("islands and raw HTML", () => {
  it("writes islands verbatim, minus Float's editing attributes, with media paths mapped", () => {
    const ctx: SerializeContext = { imageSrc: (src) => src.replace("/@fs/Users/me/site/public", "") };
    const out = Array.from(containerFrom(readFixture("html/islands.html")).children).map((el) => blockToMarkdown(el, ctx));
    expect(out).toEqual([
      '<blockquote class="twitter-tweet"><a href="https://twitter.com/astro/status/1">Post by @astro</a></blockquote>',
      '<video controls="" src="/media/blog/post/clip.mp4"></video>',
      '<figure class="embed"><iframe src="https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ" title="YouTube video" width="560" height="315" allowfullscreen="" loading="lazy"></iframe></figure>',
    ]);
  });

  it("never turns an island's blockquote into `>` syntax", () => {
    const el = containerFrom('<blockquote data-float-island="">quote</blockquote>').firstElementChild!;
    expect(blockToMarkdown(el, identity)).toBe("<blockquote>quote</blockquote>");
    const plain = containerFrom("<blockquote><p>quote</p></blockquote>").firstElementChild!;
    expect(blockToMarkdown(plain, identity)).toBe("> quote");
  });

  it("passes unknown elements through as HTML", () => {
    const el = containerFrom('<custom-thing data-x="1"><b>hi</b></custom-thing>').firstElementChild!;
    expect(blockToMarkdown(el, identity)).toBe('<custom-thing data-x="1"><b>hi</b></custom-thing>');
  });
});

describe("DOM the browser produced while editing", () => {
  const blocks = () => Array.from(containerFrom(readFixture("html/edited.html")).children);

  it("collapses whitespace, NBSPs and a trailing <br>", () => {
    expect(blockToMarkdown(blocks()[0], identity)).toBe("Typed with nbsp and runs of spaces");
  });

  it("maps <b>/<i> to ** and *, and drops <span>/<u> wrappers", () => {
    expect(blockToMarkdown(blocks()[1], identity)).toBe("Chrome bold **here** and italic *there*, plus a span and underline.");
  });

  it("turns smart quotes back into straight ones", () => {
    expect(blockToMarkdown(blocks()[2], identity)).toBe("Smart 'quotes' and \"double quotes\" go straight.");
  });

  it("reads <br> and <div> inside <pre> as newlines", () => {
    expect(blockToMarkdown(blocks()[3], identity)).toBe("```ts\nline one\nline two\nline three\nline four\n```");
  });

  it("splits a <div> with mixed inline and block children into paragraphs", () => {
    expect(blockToMarkdown(blocks()[4], identity)).toBe("A div\n\nwith a paragraph\n\nand trailing text");
  });

  it("handles inline edge cases", () => {
    const one = (html: string) => blockToMarkdown(containerFrom(html).firstChild!, identity);
    expect(one("<h2>Multi\n   line</h2>")).toBe("## Multi line");
    expect(one("<h2>   </h2>")).toBe("");
    expect(one('<p><a href="https://x.test/"></a></p>')).toBe("<https://x.test/>");
    expect(one("<p><a>no href</a></p>")).toBe("no href");
    expect(one("<p>a<strong> spaced </strong>b</p>")).toBe("a **spaced** b");
    expect(one("<p><strong>   </strong>x</p>")).toBe("x");
    expect(one('<ol start="5"><li>five</li><li>six</li></ol>')).toBe("5. five\n6. six");
    expect(one("<p>stray</p>")).toBe("stray");
    expect(one("loose text node")).toBe("loose text node");
    expect(one("<hr>")).toBe("---");
    expect(one("<table></table>")).toBe("<table></table>");
    expect(one('<p><img src="a.png" alt="x [y]" title="t"></p>')).toBe('![x \\[y\\]](a.png "t")');
    expect(one("<p>Line<br>break</p>")).toBe("Line  \nbreak");
  });

  it("isBlockElement knows the block tags", () => {
    expect(isBlockElement(document.createElement("p"))).toBe(true);
    expect(isBlockElement(document.createElement("table"))).toBe(true);
    expect(isBlockElement(document.createElement("span"))).toBe(false);
    expect(isBlockElement(document.createTextNode("x"))).toBe(false);
  });
});

describe("image blocks", () => {
  const one = (html: string, ctx: SerializeContext = identity) => blockToMarkdown(containerFrom(html).firstChild!, ctx);
  const decorated = 'contenteditable="false" draggable="true" data-float-island="" data-float-image=""';

  it("writes a plain image paragraph as Markdown even when the editor marked it atomic", () => {
    expect(one(`<p ${decorated}><img src="./x.png" alt="a picture"></p>`)).toBe("![a picture](./x.png)");
    expect(one(`<p ${decorated}><a href="https://x.test/"><img src="./x.png" alt="linked"></a></p>`)).toBe("[![linked](./x.png)](https://x.test/)");
  });

  it("writes a sized / aligned image as its wrapper around the Markdown image, minus Float's attributes", () => {
    const html = `<div style="width:50%;margin-left:auto;margin-right:auto" ${decorated}>\n<p><img src="./x.png" alt="a picture"></p>\n</div>`;
    expect(one(html)).toBe('<div style="width:50%;margin-left:auto;margin-right:auto">\n\n![a picture](./x.png)\n\n</div>');
  });

  it("keeps the wrapper's own attributes and maps the image src back through the context", () => {
    const ctx: SerializeContext = { imageSrc: (src) => src.replace(/^\/@fs\/site\/post\//, "./") };
    const html = '<div class="wide" style="width:75%" data-x="1"><p><img src="/@fs/site/post/sub/y.jpg" alt="y [z]"></p></div>';
    expect(one(html, ctx)).toBe('<div class="wide" style="width:75%" data-x="1">\n\n![y \\[z\\]](./sub/y.jpg)\n\n</div>');
  });

  it("keeps a link and a title on a sized picture", () => {
    const html = '<div style="width:25%"><p><a href="https://x.test/"><img src="./x.png" alt="linked" title="A title"></a></p></div>';
    expect(one(html)).toBe('<div style="width:25%">\n\n[![linked](./x.png "A title")](https://x.test/)\n\n</div>');
  });

  it("does not mistake other divs for image blocks", () => {
    expect(one('<div data-float-island=""><p><img src="a.png" alt="a"></p><p>text</p></div>')).toBe('<div><p><img src="a.png" alt="a"></p><p>text</p></div>');
    expect(one('<div data-float-island=""><p>caption <img src="a.png" alt="a"></p></div>')).toBe('<div><p>caption <img src="a.png" alt="a"></p></div>');
    expect(one('<div><p><img src="a.png" alt="a"><img src="b.png" alt="b"></p></div>')).toBe("![a](a.png)![b](b.png)");
  });

  it("round-trips the wrapper through Astro's renderer", async () => {
    const md = '<div style="width:50%;margin-left:auto;margin-right:auto">\n\n![a picture](./x.png)\n\n</div>';
    expect(await roundTrip(md)).toBe(md);
  });
});
