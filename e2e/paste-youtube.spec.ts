import { originalEntry, readEntry } from "./content";
import { expect, test } from "./lee";

const ENTRY = "blog/hello-lee/index.md";
const URL = "https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=1m30s";
const EMBED =
  '<figure class="embed"><iframe src="https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ?start=90" title="YouTube video" width="560" height="315" ' +
  'allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share" allowfullscreen loading="lazy"></iframe></figure>';

async function paste(lee: import("./lee").Lee, text: string) {
  await lee.body.evaluate((el, text) => {
    const dt = new DataTransfer();
    dt.setData("text/plain", text);
    el.dispatchEvent(new ClipboardEvent("paste", { clipboardData: dt, bubbles: true, cancelable: true }));
  }, text);
}

test("a YouTube link pasted on an empty line becomes an embed island", async ({ lee }) => {
  await lee.open("/blog/hello-lee/");
  const last = lee.body.locator(":scope > p").last();
  await lee.caretAtEnd(last);
  await lee.page.keyboard.press("Enter");
  await paste(lee, URL);

  const island = lee.body.locator("figure.embed[data-lee-island]");
  await expect(island).toHaveCount(1);
  await expect(island.locator("iframe")).toHaveAttribute("src", "https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ?start=90");
  await expect(island).toHaveAttribute("contenteditable", "false");
  await expect.poll(() => lee.state()).toMatchObject({ bodyDirty: true });

  await lee.save();
  await lee.expectSaved();
  const after = readEntry(ENTRY);
  expect(after).toBe(originalEntry(ENTRY) + "\n" + EMBED + "\n");
});

test("the same link inside a sentence stays text", async ({ lee }) => {
  await lee.open("/blog/hello-lee/");
  const last = lee.body.locator(":scope > p").last();
  await lee.caretAtEnd(last);
  await lee.page.keyboard.type(" See ");
  await paste(lee, "https://youtu.be/dQw4w9WgXcQ");
  await expect(lee.body.locator("iframe")).toHaveCount(0);
  await expect(last).toContainText("See https://youtu.be/dQw4w9WgXcQ");
});
