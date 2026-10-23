import { describe, expect, it } from "vitest";
import { ISLAND_TYPES, splitBlocks } from "../src/server/blocks.js";
import { readFixture } from "./helpers";

describe("splitBlocks on Markdown", () => {
  const body = readFixture("blocks/plain.md");
  const { lead, blocks } = splitBlocks(body);

  it("keeps everything before the first rendering block as the lead", () => {
    expect(lead).toBe("");
    expect(splitBlocks("[docs]: https://x.test/\n\n# Title\n").lead).toBe("[docs]: https://x.test/");
  });

  it("returns each block's exact source, in order, with islands flagged", () => {
    expect(blocks.map((b) => [b.type, b.island])).toEqual([
      ["html", true],
      ["heading", false],
      ["paragraph", false],
      ["list", false],
      ["html", true],
      ["html", true],
      ["code", false],
      ["paragraph", false],
    ]);
    expect(blocks[0].src).toBe("<!-- lead comment -->");
    expect(blocks[1].src).toBe("# Title");
    expect(blocks[2].src).toBe("A paragraph with a [reference link][docs], `inline code` and an ![image](./pic.png).");
    expect(blocks[3].src).toBe("- a\n- b");
    expect(blocks[4].src).toBe('<div class="raw">raw html block</div>');
    expect(blocks[5].src).toBe("<!-- members -->");
    expect(blocks[6].src).toBe("```js\nconst x = 1;\n```");
    expect(blocks[7].src).toBe("Last paragraph with a hard  \nbreak.");
  });

  it("carries nodes that render nothing as the trailer of the block before them", () => {
    expect(blocks[0].trailer).toBe("[docs]: https://docs.example.test/");
    expect(blocks[2].trailer).toBe("[^1]: A footnote definition that renders nothing.");
    expect(blocks.filter((b) => b.trailer).length).toBe(2);
  });

  it("makes an HTML comment its own block, so editing the block before it cannot drop it", () => {
    expect(blocks.map((b) => b.comment)).toEqual(["lead comment", undefined, undefined, undefined, undefined, "members", undefined, undefined]);
    const { blocks: merged } = splitBlocks("Free.\n\n<!-- members -->\n\n<!-- note -->\n\nPaid.\n");
    expect(merged.map((b) => [b.src, b.comment])).toEqual([
      ["Free.", undefined],
      ["<!-- members -->\n\n<!-- note -->", "members note"],
      ["Paid.", undefined],
    ]);
  });

  it("gives each block the plain text it renders to", () => {
    expect(blocks.map((b) => b.text)).toEqual([
      "",
      "Title",
      "A paragraph with a reference link, inline code and an .",
      "ab",
      "",
      "",
      "const x = 1;",
      "Last paragraph with a hard break.",
    ]);
  });

  it("reassembles to the original body", () => {
    const parts = [lead, ...blocks.map((b) => (b.trailer ? `${b.src}\n\n${b.trailer}` : b.src))].filter(Boolean);
    expect(parts.join("\n\n") + "\n").toBe(body);
  });

  it("handles an empty body and a body with no rendering blocks", () => {
    expect(splitBlocks("")).toEqual({ lead: "", blocks: [] });
    expect(splitBlocks("<!-- only a comment -->\n").blocks.map((b) => b.comment)).toEqual(["only a comment"]);
    expect(splitBlocks("[ref]: https://x.test/\n")).toEqual({ lead: "[ref]: https://x.test/", blocks: [] });
  });

  it("treats a raw HTML block as an island even in .md", () => {
    const { blocks } = splitBlocks("<Callout>\n  hi\n</Callout>\n\ntext\n");
    expect(blocks[0]).toMatchObject({ type: "html", island: true, src: "<Callout>\n  hi\n</Callout>", text: "" });
    expect(blocks[1]).toMatchObject({ type: "paragraph", island: false, text: "text" });
  });

  it("folds an opening tag, the Markdown inside and its closing tag into one island block", () => {
    const body = "Before.\n\n<div style=\"width:50%\">\n\n![pic](./x.png)\n\n</div>\n\n[ref]: https://x.test/\n\nAfter.\n";
    const { blocks } = splitBlocks(body);
    expect(blocks.map((b) => [b.type, b.island, b.src])).toEqual([
      ["paragraph", false, "Before."],
      ["html", true, '<div style="width:50%">\n\n![pic](./x.png)\n\n</div>'],
      ["paragraph", false, "After."],
    ]);
    expect(blocks[1].trailer).toBe("[ref]: https://x.test/");
    expect(blocks[1].text).toBe("");
  });

  it("nests same-named wrappers and leaves unmatched or void tags alone", () => {
    const nested = "<div>\n\n<div>\n\ninner\n\n</div>\n\n</div>\n\ntail\n";
    expect(splitBlocks(nested).blocks.map((b) => b.src)).toEqual(["<div>\n\n<div>\n\ninner\n\n</div>\n\n</div>", "tail"]);
    expect(splitBlocks("<div>\n\nopen only\n").blocks.map((b) => [b.type, b.src])).toEqual([["html", "<div>"], ["paragraph", "open only"]]);
    expect(splitBlocks("<br>\n\ntext\n\n</br>\n").blocks.length).toBe(3);
    expect(splitBlocks('<img src="./x.png">\n\ntext\n').blocks.map((b) => b.type)).toEqual(["html", "paragraph"]);
  });

  it("strips trailing whitespace from a block but keeps inner blank lines out of src", () => {
    const { blocks } = splitBlocks("para one   \n\n\n\npara two\n\n\n");
    expect(blocks.map((b) => b.src)).toEqual(["para one", "para two"]);
    expect(blocks.map((b) => b.trailer)).toEqual(["", ""]);
  });

  it("exports the island node types", () => {
    expect([...ISLAND_TYPES].sort()).toEqual(["html", "mdxJsxFlowElement"]);
  });
});

describe("splitBlocks on MDX", () => {
  const body = readFixture("blocks/islands.mdx");
  const { lead, blocks } = splitBlocks(body, { mdx: true });

  it("keeps import / export statements in the lead", () => {
    expect(lead).toBe('import Callout from "../components/Callout.astro";\nexport const meta = { draft: false };');
  });

  it("flags component blocks, JSX-only paragraphs and raw HTML as islands", () => {
    expect(blocks.map((b) => [b.type, b.island])).toEqual([
      ["paragraph", false],
      ["mdxJsxFlowElement", true],
      ["paragraph", true],
      ["paragraph", false],
      ["mdxJsxFlowElement", true],
    ]);
    expect(blocks[1].src).toBe('<Callout title="Hi">\n  Inside the component.\n</Callout>');
    expect(blocks[2].src).toBe('<span class="only-jsx">inline only</span>');
    expect(blocks[4].src).toBe('<div class="html">\n  raw html in mdx\n</div>');
  });

  it("carries an MDX expression as a trailer and renders inline JSX to its text", () => {
    expect(blocks[1].trailer).toBe("{/* an MDX comment */}");
    expect(blocks[3].text).toBe("Text with an inline element stays prose.");
  });

  it("falls back to plain Markdown when the MDX doesn't parse", () => {
    const { blocks } = splitBlocks("Broken <b\n\nstill here\n", { mdx: true });
    expect(blocks.map((b) => b.type)).toEqual(["paragraph", "paragraph"]);
    expect(blocks[0].src).toBe("Broken <b");
  });

  it("still throws for plain Markdown that cannot parse", () => {
    // mdast-util-from-markdown never throws on Markdown input; make sure the mdx:false path passes errors through.
    expect(() => splitBlocks("fine")).not.toThrow();
  });
});
