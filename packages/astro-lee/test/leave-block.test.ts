// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { splitBlocks } from "../src/server/blocks.js";
import { PageEditor } from "../src/toolbar/editor";
import { containerFrom, renderMarkdown } from "./helpers";

const hooks = { onChange() {}, onFiles() {} };
let teardown: Array<() => void> = [];
afterEach(() => {
  for (const fn of teardown) fn();
  teardown = [];
});

/** Astro's render of `body`, bound and attached as the page does it, in the document so a caret can live in it. */
async function editing(body: string) {
  const container = containerFrom(await renderMarkdown(body));
  document.body.appendChild(container);
  const editor = new PageEditor(hooks);
  editor.bind(container, splitBlocks(body), "/site/src/content/blog/post");
  editor.attach();
  teardown.push(() => {
    editor.unbind();
    container.remove();
  });
  return { editor, container };
}

function caret(node: Node, offset: number) {
  const range = document.createRange();
  range.setStart(node, offset);
  document.getSelection()!.removeAllRanges();
  document.getSelection()!.addRange(range);
}

/** Press a key in the body; true when the editor handled it (the browser's own behaviour was prevented). */
function press(container: HTMLElement, key: string): boolean {
  return !container.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true }));
}

function emptyLine(): HTMLParagraphElement {
  const p = document.createElement("p");
  p.appendChild(document.createElement("br"));
  return p;
}

function lastText(el: Element): Text {
  const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
  let last: Text | null = null;
  for (let n = walker.nextNode(); n; n = walker.nextNode()) if (n.textContent!.trim()) last = n as Text;
  return last!;
}

const caretAt = () => document.getSelection()!.getRangeAt(0).startContainer;
const tags = (container: HTMLElement) => Array.from(container.children).map((c) => c.tagName);

describe("leaving a quote", () => {
  it("Enter on the empty last line leaves the quote for a paragraph right after it; nothing else changes", async () => {
    const body = "Before.\n\n> Quoted line\n";
    const { editor, container } = await editing(body);
    const quote = container.querySelector("blockquote")!;
    const line = emptyLine();
    quote.appendChild(line); // what the browser's Enter at the end of the quoted line makes
    caret(line, 0);
    expect(press(container, "Enter")).toBe(true);
    expect(quote.querySelectorAll("p")).toHaveLength(1);
    expect(quote.nextElementSibling!.outerHTML).toBe("<p><br></p>");
    expect(caretAt()).toBe(quote.nextElementSibling);
    expect(editor.toMarkdown()).toBe(body);
    expect(editor.isDirty()).toBe(false);
  });

  it("Enter on an empty line in the middle splits the quote around the new paragraph", async () => {
    const { editor, container } = await editing("> One\n>\n> Two\n");
    const line = emptyLine();
    container.querySelector("blockquote p")!.after(line);
    caret(line, 0);
    expect(press(container, "Enter")).toBe(true);
    expect(tags(container)).toEqual(["BLOCKQUOTE", "P", "BLOCKQUOTE"]);
    expect(caretAt()).toBe(container.children[1]);
    expect(editor.toMarkdown()).toBe("> One\n\n> Two\n");
  });

  it("a quote left empty goes, and an empty quote never writes a lone >", async () => {
    const { editor, container } = await editing("Before.\n");
    const quote = document.createElement("blockquote");
    const line = emptyLine();
    quote.appendChild(line); // the `> ` shortcut's quote before anything is typed
    container.appendChild(quote);
    expect(editor.toMarkdown()).toBe("Before.\n");
    caret(line, 0);
    expect(press(container, "Enter")).toBe(true);
    expect(container.querySelector("blockquote")).toBeNull();
    expect(container.lastElementChild!.outerHTML).toBe("<p><br></p>");
    expect(editor.toMarkdown()).toBe("Before.\n");
  });

  it("Enter on a line with text stays the browser's", async () => {
    const { container } = await editing("> Quoted line\n");
    const text = lastText(container.querySelector("blockquote")!);
    caret(text, text.length);
    expect(press(container, "Enter")).toBe(false);
  });

  it("Backspace at the very start of the first line takes that line out; the rest stays quoted", async () => {
    const { editor, container } = await editing("Before.\n\n> One\n>\n> Two\n");
    caret(container.querySelector("blockquote p")!.firstChild!, 0);
    expect(press(container, "Backspace")).toBe(true);
    expect(tags(container)).toEqual(["P", "P", "BLOCKQUOTE"]);
    expect(editor.toMarkdown()).toBe("Before.\n\nOne\n\n> Two\n");
  });

  it("Backspace anywhere else in a quote stays the browser's", async () => {
    const { container } = await editing("> One\n>\n> Two\n");
    const [one, two] = Array.from(container.querySelectorAll("blockquote p"));
    caret(one.firstChild!, 1);
    expect(press(container, "Backspace")).toBe(false);
    caret(two.firstChild!, 0);
    expect(press(container, "Backspace")).toBe(false);
  });
});

describe("leaving a block that ends the body", () => {
  it("↓ or → at the very end of a quote, a code block or a list opens a paragraph after it", async () => {
    const cases: Array<[string, string, string]> = [
      ["Intro.\n\n> Last quote\n", "blockquote", "ArrowDown"],
      ["Intro.\n\n```js\nlet a = 1;\n```\n", "pre", "ArrowRight"],
      ["Intro.\n\n- one\n- two\n", "ul", "ArrowDown"],
    ];
    for (const [body, selector, key] of cases) {
      const { editor, container } = await editing(body);
      const text = lastText(container.querySelector(selector)!);
      caret(text, text.length);
      expect(press(container, key)).toBe(true);
      expect(container.lastElementChild!.outerHTML).toBe("<p><br></p>");
      expect(container.lastElementChild!.previousElementSibling!.matches(selector)).toBe(true);
      expect(caretAt()).toBe(container.lastElementChild);
      expect(editor.toMarkdown()).toBe(body);
    }
  });

  it("leaves ↓ and → to the browser before the end, or when another block follows", async () => {
    const { container } = await editing("Intro.\n\n> Last quote\n");
    caret(lastText(container.querySelector("blockquote")!), 2);
    expect(press(container, "ArrowRight")).toBe(false);
    const { container: followed } = await editing("> Quote\n\nAfter.\n");
    const text = lastText(followed.querySelector("blockquote")!);
    caret(text, text.length);
    expect(press(followed, "ArrowDown")).toBe(false);
  });
});
