import fs from "node:fs";
import { entryPath, readEntry } from "./content";
import { expect, test, type Float } from "./float";

// A 1×1 transparent PNG.
const PNG = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==";

/** Open the Address row's input, type a slug, press Enter, and wait for the rename to answer. */
async function rename(float: Float, slug: string) {
  await float.openPopover();
  const row = float.popover.locator(".address-row");
  const input = row.locator("input.address-input");
  if (!(await input.count())) await row.locator("button.address").click(); // else: still editing after an error
  await expect(input).toBeFocused();
  await input.fill(slug);
  const [res] = await Promise.all([
    float.page.waitForResponse((r) => r.request().method() === "POST" && r.url().includes("/__float/api/rename")),
    input.press("Enter"),
  ]);
  return res;
}

test("a folder entry moves with its image, the page follows, and the rename can be undone", async ({ float }) => {
  await float.open("/blog/hello-float/");

  // Give the entry an image first, so there is something next to it to move.
  const target = float.body.locator(":scope > p").nth(1);
  const box = (await target.boundingBox())!;
  const upload = float.page.waitForResponse((r) => r.request().method() === "POST" && r.url().includes("/__float/api/media"));
  await float.body.evaluate(
    (el, { png, x, y }) => {
      const bytes = Uint8Array.from(atob(png), (c) => c.charCodeAt(0));
      const dt = new DataTransfer();
      dt.items.add(new File([bytes], "tiny-move.png", { type: "image/png" }));
      el.dispatchEvent(new DragEvent("drop", { dataTransfer: dt, clientX: x, clientY: y, bubbles: true, cancelable: true }));
    },
    { png: PNG, x: box.x + box.width / 2, y: box.y + box.height / 2 },
  );
  expect((await upload).status()).toBe(201);
  await float.save();
  await float.expectSaved();
  expect(readEntry("blog/hello-float/index.md")).toContain("![tiny move](./tiny-move.png)");

  // The row shows the id; editing shows the path it would give and the published-post line.
  await float.openPopover();
  const row = float.popover.locator(".address-row");
  await expect(row.locator("button.address")).toHaveText("hello-float");
  await row.locator("button.address").click();
  const input = row.locator("input.address-input");
  await expect(input).toHaveValue("hello-float");
  await expect(row.locator(".address-note")).toBeHidden();
  await input.fill("Hello Moved!");
  await expect(input).toHaveValue("hello-moved");
  await expect(row.locator(".address-path")).toHaveText("src/content/blog/hello-moved/");
  await expect(row.locator(".address-note")).toHaveText(/breaks existing links unless you add a redirect/);

  // Escape puts it back and keeps the popover open.
  await input.press("Escape");
  await expect(row.locator("button.address")).toHaveText("hello-float");
  await expect(float.popover).toBeVisible();

  // Taken: said under the row, nothing moved.
  const taken = await rename(float, "on-hairlines");
  expect(taken.status()).toBe(409);
  await expect(row.locator(".form-error")).toHaveText('"on-hairlines" is taken');
  expect(fs.existsSync(entryPath("blog/hello-float/index.md"))).toBe(true);

  // Apply: the folder moves, the page is the new URL, the image still renders from the new folder.
  const res = await rename(float, "hello-moved");
  expect(res.status()).toBe(200);
  await float.page.waitForURL("**/blog/hello-moved/");
  await expect.poll(() => float.state()).toMatchObject({ entry: "blog/hello-moved", editing: true, bodyBound: true, frontmatterDirty: false, bodyDirty: false });
  await expect(float.page.locator('h1[data-float-field="title"]')).toHaveText("Hello, Float");
  const img = float.body.locator("img[alt='tiny move']");
  await expect(img).toHaveAttribute("src", /hello-moved(\/|%2F)tiny-move\.png/);
  await expect.poll(() => img.evaluate((el) => (el as HTMLImageElement).naturalWidth)).toBe(1);

  expect(fs.existsSync(entryPath("blog/hello-float"))).toBe(false);
  expect(fs.existsSync(entryPath("blog/hello-moved/index.md"))).toBe(true);
  expect(fs.existsSync(entryPath("blog/hello-moved/tiny-move.png"))).toBe(true);

  // The popover follows: header, Address row, entries list.
  await float.openPopover();
  await expect(float.popover.locator(".pop-entry")).toHaveText("blog/hello-moved");
  await expect(float.popover.locator(".address-row button.address")).toHaveText("hello-moved");
  await float.popover.locator(".foot-toggle").click();
  await expect(float.popover.locator('.list-item[aria-current="page"]')).toHaveAttribute("href", "/blog/hello-moved/");

  // And back.
  const back = await rename(float, "hello-float");
  expect(back.status()).toBe(200);
  await float.page.waitForURL("**/blog/hello-float/");
  await expect.poll(() => float.state()).toMatchObject({ entry: "blog/hello-float", editing: true, bodyBound: true });
  expect(fs.existsSync(entryPath("blog/hello-moved"))).toBe(false);
  expect(fs.existsSync(entryPath("blog/hello-float/tiny-move.png"))).toBe(true);
  await expect(float.body.locator("img[alt='tiny move']")).toHaveAttribute("src", /hello-float(\/|%2F)tiny-move\.png/);
});

test("a flat entry renames its file and the page follows", async ({ float }) => {
  await float.open("/notes/reading-list/");
  await float.openPopover();
  const row = float.popover.locator(".address-row");
  await row.locator("button.address").click();
  const input = row.locator("input.address-input");
  await input.fill("to-read");
  await expect(row.locator(".address-path")).toHaveText("src/content/notes/to-read.md");

  const res = await rename(float, "to-read");
  expect(res.status()).toBe(200);
  await float.page.waitForURL("**/notes/to-read/");
  await expect.poll(() => float.state()).toMatchObject({ entry: "notes/to-read", editing: true, bodyBound: true });
  await expect(float.page.locator('h1[data-float-field="title"]')).toHaveText("Reading list");
  expect(fs.existsSync(entryPath("notes/reading-list.md"))).toBe(false);
  expect(readEntry("notes/to-read.md")).toContain("title: Reading list");

  // Pending edits are saved to the file before it moves.
  const h1 = float.page.locator('h1[data-float-field="title"]');
  await h1.click();
  await float.page.keyboard.press("ControlOrMeta+a");
  await float.page.keyboard.type("Reading list, moved");
  await float.page.keyboard.press("Enter");
  await expect.poll(() => float.state()).toMatchObject({ frontmatterDirty: true });
  const saved = float.waitForSave();
  const back = await rename(float, "reading-list");
  expect((await saved).status()).toBe(200);
  expect(back.status()).toBe(200);
  await float.page.waitForURL("**/notes/reading-list/");
  await expect.poll(() => float.state()).toMatchObject({ entry: "notes/reading-list", frontmatterDirty: false });
  expect(readEntry("notes/reading-list.md")).toContain("title: Reading list, moved");
  expect(fs.existsSync(entryPath("notes/to-read.md"))).toBe(false);
});

test("the form never offers slug or id for editing", async ({ float }) => {
  await float.open("/blog/hello-float/");
  await float.openPopover();
  await expect(float.popover.locator('.row[data-key="slug"] input, .row[data-key="id"] input')).toHaveCount(0);
});
