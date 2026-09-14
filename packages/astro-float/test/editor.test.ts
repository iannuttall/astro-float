// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { splitBlocks } from "../src/server/blocks.js";
import { PageEditor } from "../src/toolbar/editor";
import { containerFrom, readFixture, renderMarkdown } from "./helpers";

const ABS_DIR = "/Users/me/site/src/content/blog/post";
const hooks = { onChange() {}, onFiles() {} };

/** Bind a fresh editor to Astro's render of `body`, exactly as the page does. */
async function bound(body: string, mdx = false) {
  const source = splitBlocks(body, { mdx });
  const html = await renderMarkdown(body);
  const container = containerFrom(html);
  const editor = new PageEditor(hooks);
  editor.bind(container, source, ABS_DIR);
  return { editor, container, source };
}

const ISLAND = '<div class="raw">an <b>island</b></div>';
const LIST = "* star bullet\n* another star";
const BODY = ["<!-- lead -->", "", "# A *title*", "", "Paragraph one with a [ref link][docs] and `code`.", "", "[docs]: https://docs.example.test/", "", LIST, "", ISLAND, "", "Last paragraph.", ""].join("\n");

describe("PageEditor round trip", () => {
  it("maps every rendered block to its source and writes the body back byte for byte", async () => {
    const { editor } = await bound(BODY);
    expect(editor.mapped).toBe(true);
    expect(editor.isDirty()).toBe(false);
    expect(editor.toMarkdown()).toBe(BODY);
  });

  it("re-serializes only the block that was edited", async () => {
    const { editor, container } = await bound(BODY);
    container.querySelector("h1")!.append(" edited");
    expect(editor.isDirty()).toBe(true);
    const out = editor.toMarkdown();
    expect(out).toBe(BODY.replace("# A *title*", "# A *title* edited"));
    // The untouched list keeps its `*` markers: it was never re-serialized.
    expect(out).toContain(LIST);
  });

  // Known gap: a block's trailer (a link definition, a comment, a footnote) is dropped when that block is edited.
  it.fails("keeps a block's trailer when the block itself is edited", async () => {
    const { editor, container } = await bound(BODY);
    const p = container.querySelector("p")!;
    p.firstChild!.textContent = "Paragraph ONE with a ";
    expect(editor.toMarkdown()).toBe(BODY.replace("Paragraph one with a [ref link][docs] and `code`.", "Paragraph ONE with a [ref link](https://docs.example.test/) and `code`."));
  });

  it("restores the baseline DOM on discard", async () => {
    const { editor, container } = await bound(BODY);
    const before = container.innerHTML;
    container.querySelector("h1")!.textContent = "Changed";
    expect(editor.isDirty()).toBe(true);
    editor.restoreBaseline();
    expect(editor.isDirty()).toBe(false);
    expect(container.innerHTML).toBe(before);
  });

  it("moves an island's source verbatim when its DOM node moves", async () => {
    const { editor, container } = await bound(BODY);
    const island = container.querySelector("[data-float-island]") as HTMLElement;
    expect(island.tagName).toBe("DIV");
    expect(island.contentEditable).toBe("false");
    container.querySelector("ul")!.before(island);
    expect(editor.toMarkdown()).toBe(BODY.replace(`${LIST}\n\n${ISLAND}`, `${ISLAND}\n\n${LIST}`));
  });

  it("drops a removed block and appends a typed one", async () => {
    const { editor, container } = await bound(BODY);
    container.querySelector("ul")!.remove();
    const p = document.createElement("p");
    p.textContent = "Typed at the end.";
    container.appendChild(p);
    expect(editor.toMarkdown()).toBe(BODY.replace(`${LIST}\n\n`, "") + "\nTyped at the end.\n");
  });

  it("ignores blank paragraphs (the caret's parking spots) and strips Astro's dev annotations first", async () => {
    const source = splitBlocks(BODY);
    const container = containerFrom(await renderMarkdown(BODY));
    container.querySelector("h1")!.setAttribute("data-astro-source-file", "x.astro");
    container.querySelector("h1")!.setAttribute("data-astro-source-loc", "1:1");
    const editor = new PageEditor(hooks);
    editor.bind(container, source, ABS_DIR);
    expect(container.querySelector("[data-astro-source-file], [data-astro-source-loc]")).toBeNull();
    container.appendChild(document.createElement("p"));
    const parking = document.createElement("p");
    parking.appendChild(document.createElement("br"));
    container.appendChild(parking);
    expect(editor.isDirty()).toBe(false);
    expect(editor.toMarkdown()).toBe(BODY);
  });

  it("maps Vite's /@fs and Astro's /_image URLs back to paths relative to the entry", () => {
    const container = containerFrom(readFixture("html/images.html"));
    const editor = new PageEditor(hooks);
    editor.bind(container, { lead: "", blocks: [] }, ABS_DIR + "/");
    expect(editor.mapped).toBe(false);
    expect(editor.toMarkdown()).toBe(
      [
        "![a photo](./photo.png)",
        "![diagram](./sub/diagram.jpg)",
        "![outside the entry](/Users/me/site/src/assets/shared.png)",
        '![remote](https://cdn.example.test/remote.png "A title")',
        "Inline ![\\[icon\\]](./icon.svg) in a sentence.",
        "![Caption wins](./fig.png)",
      ].join("\n\n") + "\n",
    );
  });

  it("inserts a raw-HTML island whose source is written verbatim", async () => {
    const { editor, container } = await bound("Only paragraph.\n");
    editor.insertHtmlBlock('<video controls src="/media/blog/post/clip.mp4"></video>', null, '<video controls src="/@fs/Users/me/site/public/media/blog/post/clip.mp4"></video>');
    const island = container.querySelector("video")!;
    expect(island.hasAttribute("data-float-island")).toBe(true);
    expect(editor.toMarkdown()).toBe('Only paragraph.\n\n<video controls src="/media/blog/post/clip.mp4"></video>\n');
  });

  it("treats a rendered image paragraph and a sized-image wrapper as image blocks, and writes the wrapper back verbatim", async () => {
    const body = "Before.\n\n![pic](./x.png)\n\n<div style=\"width:50%;margin-left:auto;margin-right:auto\">\n\n![sized](./y.png)\n\n</div>\n\nAfter.\n";
    const { editor, container } = await bound(body);
    expect(editor.mapped).toBe(true);
    const blocks = Array.from(container.children) as HTMLElement[];
    expect(blocks.map((b) => [b.tagName, b.hasAttribute("data-float-image"), b.hasAttribute("data-float-key")])).toEqual([
      ["P", false, false],
      ["P", true, false],
      ["DIV", true, false],
      ["P", false, false],
    ]);
    expect(blocks[2].contentEditable).toBe("false");
    expect(editor.isDirty()).toBe(false);
    expect(editor.toMarkdown()).toBe(body);
    // Moving the wrapper moves its source; alt text typed on the picture re-serializes just that block.
    blocks[0].before(blocks[2]);
    expect(editor.toMarkdown()).toBe("<div style=\"width:50%;margin-left:auto;margin-right:auto\">\n\n![sized](./y.png)\n\n</div>\n\nBefore.\n\n![pic](./x.png)\n\nAfter.\n");
    blocks[1].querySelector("img")!.alt = "renamed";
    expect(editor.toMarkdown()).toContain("![renamed](./x.png)");
  });

  it("takes every image mark off the DOM on unbind", async () => {
    const body = "![pic](./x.png)\n\n<div style=\"width:25%\">\n\n![sized](./y.png)\n\n</div>\n";
    const container = containerFrom(await renderMarkdown(body));
    const before = container.innerHTML;
    const editor = new PageEditor(hooks);
    editor.bind(container, splitBlocks(body), ABS_DIR);
    expect(container.querySelectorAll("[data-float-image]").length).toBe(2);
    editor.attach();
    editor.unbind();
    expect(container.querySelector("[data-float-image], [data-float-island], [contenteditable], [draggable]")).toBeNull();
    expect(container.innerHTML).toBe(before);
  });

  it("sizes a picture and puts it back: the wrapper is written, and 100% brings back the original bytes and a clean state", async () => {
    const body = "Before.\n\n![pic](./x.png)\n\nAfter.\n";
    const { editor, container } = await bound(body);
    const picture = container.querySelector<HTMLElement>("[data-float-image]")!;
    editor.setImageLayout(picture, { size: 50, align: "center" });
    const wrapper = container.querySelector<HTMLElement>(":scope > div[data-float-image]")!;
    expect(picture.hasAttribute("data-float-image")).toBe(false);
    expect(editor.toMarkdown()).toBe('Before.\n\n<div style="width:50%;margin-left:auto;margin-right:auto">\n\n![pic](./x.png)\n\n</div>\n\nAfter.\n');
    editor.setImageAlt(wrapper, "a [bracketed] pic");
    expect(editor.toMarkdown()).toContain("\n\n![a \\[bracketed\\] pic](./x.png)\n\n</div>");
    editor.setImageAlt(wrapper, "pic");
    editor.setImageLayout(wrapper, { size: 100 });
    expect(container.querySelector(":scope > div")).toBeNull();
    expect(editor.isDirty()).toBe(false);
    expect(editor.toMarkdown()).toBe(body);
  });

  it("makes a paragraph that became a lone picture an image block once the caret has left it", async () => {
    const { editor, container } = await bound("Look: ![pic](./x.png)\n\nNext.\n");
    document.body.appendChild(container);
    editor.attach();
    const [p, next] = Array.from(container.querySelectorAll("p"));
    const caret = (node: Node, offset: number) => {
      const range = document.createRange();
      range.setStart(node, offset);
      document.getSelection()!.removeAllRanges();
      document.getSelection()!.addRange(range);
    };
    caret(p, 0);
    p.firstChild!.remove(); // "Look: " deleted, the caret still in the paragraph
    await new Promise((r) => setTimeout(r));
    expect(p.hasAttribute("data-float-image")).toBe(false);
    caret(next.firstChild!, 0);
    next.append("!");
    await new Promise((r) => setTimeout(r));
    expect(p.hasAttribute("data-float-image")).toBe(true);
    expect(p.contentEditable).toBe("false");
    editor.unbind();
    container.remove();
  });

  it("treats MDX components as islands and lines them up with the source", async () => {
    const body = 'import C from "./C.astro";\n\nBefore.\n\n<C title="x">\n  inner\n</C>\n\nAfter.\n';
    const source = splitBlocks(body, { mdx: true });
    // What Astro renders a component to is arbitrary HTML; a custom element stands in for it here.
    const container = containerFrom("<p>Before.</p><my-callout><p>inner</p></my-callout><p>After.</p>");
    const editor = new PageEditor(hooks);
    editor.bind(container, source, ABS_DIR);
    expect(editor.mapped).toBe(true);
    expect(editor.toMarkdown()).toBe(body);
    const island = container.querySelector("my-callout") as HTMLElement;
    container.firstElementChild!.before(island);
    expect(editor.toMarkdown()).toBe('import C from "./C.astro";\n\n<C title="x">\n  inner\n</C>\n\nBefore.\n\nAfter.\n');
  });
});
