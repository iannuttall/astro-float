import fs from "node:fs";
import { entryPath, originalEntry, readEntry } from "./content";
import { expect, test } from "./float";

const ENTRY = "blog/hello-float/index.md";
// A 1×1 transparent PNG.
const PNG = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==";

test("an image dropped on the prose is copied next to the entry and written as a relative link", async ({ float }) => {
  await float.open("/blog/hello-float/");
  const target = float.body.locator(":scope > p").nth(1);
  const box = (await target.boundingBox())!;

  // There is no file input for the body: dispatch the drop a person's drag would end with.
  const upload = float.page.waitForResponse((r) => r.request().method() === "POST" && r.url().includes("/__float/api/media"));
  await float.body.evaluate(
    (el, { png, x, y }) => {
      const bytes = Uint8Array.from(atob(png), (c) => c.charCodeAt(0));
      const dt = new DataTransfer();
      dt.items.add(new File([bytes], "tiny-drop.png", { type: "image/png" }));
      el.dispatchEvent(new DragEvent("drop", { dataTransfer: dt, clientX: x, clientY: y, bubbles: true, cancelable: true }));
    },
    { png: PNG, x: box.x + box.width / 2, y: box.y + box.height / 2 },
  );
  expect((await upload).status()).toBe(201);

  const img = float.body.locator("img[alt='tiny drop']");
  await expect(img).toHaveCount(1);
  await expect(img).toHaveAttribute("src", /\/@fs\/.*\/blog\/hello-float\/tiny-drop\.png$/);
  expect(fs.existsSync(entryPath("blog/hello-float/tiny-drop.png"))).toBe(true);
  // It landed right after the paragraph it was dropped on.
  await expect(float.body.locator(":scope > p").nth(2).locator("img")).toHaveCount(1);

  await float.save();
  await float.expectSaved();
  const after = readEntry(ENTRY);
  expect(after).toContain("\n![tiny drop](./tiny-drop.png)\n");
  const before = originalEntry(ENTRY);
  expect(after.replace("![tiny drop](./tiny-drop.png)\n\n", "")).toBe(before);
});
