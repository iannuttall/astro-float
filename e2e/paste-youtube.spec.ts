import { originalEntry, readEntry } from "./content";
import { expect, test } from "./float";

const ENTRY = "blog/hello-float/index.md";
const URL = "https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=1m30s";
const EMBED =
  '<figure class="embed"><iframe src="https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ?start=90" title="YouTube video" width="560" height="315" ' +
  'allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share" allowfullscreen loading="lazy"></iframe></figure>';

async function paste(float: import("./float").Float, text: string) {
  await float.body.evaluate((el, text) => {
    const dt = new DataTransfer();
    dt.setData("text/plain", text);
    el.dispatchEvent(new ClipboardEvent("paste", { clipboardData: dt, bubbles: true, cancelable: true }));
  }, text);
}

test("a YouTube link pasted on an empty line becomes an embed island", async ({ float }) => {
  await float.open("/blog/hello-float/");
  const last = float.body.locator(":scope > p").last();
  await float.caretAtEnd(last);
  await float.page.keyboard.press("Enter");
  await paste(float, URL);

  const island = float.body.locator("figure.embed[data-float-island]");
  await expect(island).toHaveCount(1);
  await expect(island.locator("iframe")).toHaveAttribute("src", "https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ?start=90");
  await expect(island).toHaveAttribute("contenteditable", "false");
  await expect.poll(() => float.state()).toMatchObject({ bodyDirty: true });

  await float.save();
  await float.expectSaved();
  const after = readEntry(ENTRY);
  expect(after).toBe(originalEntry(ENTRY) + "\n" + EMBED + "\n");
});

test("the same link inside a sentence stays text", async ({ float }) => {
  await float.open("/blog/hello-float/");
  const last = float.body.locator(":scope > p").last();
  await float.caretAtEnd(last);
  await float.page.keyboard.type(" See ");
  await paste(float, "https://youtu.be/dQw4w9WgXcQ");
  await expect(float.body.locator("iframe")).toHaveCount(0);
  await expect(last).toContainText("See https://youtu.be/dQw4w9WgXcQ");
});
