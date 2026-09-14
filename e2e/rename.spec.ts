import fs from "node:fs";
import type { Locator } from "@playwright/test";
import { entryPath, readEntry } from "./content";
import { expect, expectSameBox, test, type Float } from "./float";

// A 1×1 transparent PNG.
const PNG = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==";

/** Open the Address row's input: a click for a draft, two on the padlock for a published post (after an error it is still open). */
async function openAddress(float: Float): Promise<Locator> {
  await float.openPopover();
  const row = float.popover.locator(".address-row");
  const input = row.locator("input.address-input");
  if (!(await input.count())) {
    const lock = row.locator("button.address-lock");
    if (await lock.count()) {
      await lock.click();
      await expect(lock).toHaveAttribute("data-tip", "Are you sure? Old links will break");
      await lock.click();
    } else {
      await row.locator("button.address").click();
    }
  }
  await expect(input).toBeFocused();
  return input;
}

/** Type a slug into the Address row, press Enter, and wait for the rename to answer. */
async function rename(float: Float, slug: string) {
  const input = await openAddress(float);
  await input.fill(slug);
  const [res] = await Promise.all([
    float.page.waitForResponse((r) => r.request().method() === "POST" && r.url().includes("/__float/api/rename")),
    input.press("Enter"),
  ]);
  return res;
}

test("a published folder entry unlocks in two clicks, moves with its image, and the page follows", async ({ float }) => {
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

  // Published: the address sits behind a padlock, and the id itself does nothing.
  await float.openPopover();
  const row = float.popover.locator(".address-row");
  const text = row.locator(".address");
  const lock = row.locator("button.address-lock");
  await expect(text).toHaveText("hello-float");
  await expect(lock).toHaveAttribute("data-tip", "Change address");
  await text.click();
  await expect(row.locator("input")).toHaveCount(0);

  // The first click asks, in the padlock's own tooltip; a click elsewhere, or four seconds, and it stops asking.
  await lock.click();
  await expect(lock).toHaveAttribute("data-tip", "Are you sure? Old links will break");
  await expect(float.page.locator(".astro-float-tip[data-show]")).toHaveText("Are you sure? Old links will break");
  await float.popover.locator(".pop-head").click();
  await expect(lock).toHaveAttribute("data-tip", "Change address");
  await lock.click();
  await expect(lock).toHaveAttribute("data-tip", "Are you sure? Old links will break");
  await expect(lock).toHaveAttribute("data-tip", "Change address", { timeout: 6_000 });

  // The second click opens it: an input in the id's own box, all selected; typing moves nothing around it.
  const rowBox = await row.boundingBox();
  const textBox = await text.boundingBox();
  await lock.click();
  await lock.click();
  const input = row.locator("input.address-input");
  await expect(input).toBeFocused();
  await expect(input).toHaveValue("hello-float");
  expectSameBox(await input.boundingBox(), textBox);
  expect(await input.evaluate((el: HTMLInputElement) => [el.selectionStart, el.selectionEnd])).toEqual([0, "hello-float".length]);
  await input.fill("Hello Moved!");
  await expect(input).toHaveValue("hello-moved");
  expectSameBox(await row.boundingBox(), rowBox);

  // Escape puts it back, locks it again and keeps the popover open.
  await input.press("Escape");
  await expect(text).toHaveText("hello-float");
  await expect(lock).toHaveAttribute("data-tip", "Change address");
  await expect(float.popover).toBeVisible();

  // Not allowed, then taken: a red hairline and the reason in the input's tooltip; no line under the row, nothing moved.
  await (await openAddress(float)).fill("bad-");
  await input.press("Enter");
  await expect(input).toHaveAttribute("data-invalid", "");
  await expect(input).toHaveAttribute("data-tip", "Can't start or end with a dash");
  const taken = await rename(float, "on-hairlines");
  expect(taken.status()).toBe(409);
  await expect(input).toHaveAttribute("data-tip", "Already used");
  await expect(input).toHaveAttribute("data-invalid", "");
  expectSameBox(await row.boundingBox(), rowBox);
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

  // The popover follows, locked again: header, Address row, entries list.
  await float.openPopover();
  await expect(float.popover.locator(".pop-entry")).toHaveText("blog/hello-moved");
  await expect(float.popover.locator(".address-row .address")).toHaveText("hello-moved");
  await expect(float.popover.locator(".address-row button.address-lock")).toHaveAttribute("data-tip", "Change address");
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

test("a draft's address edits on a click, with no padlock", async ({ float }) => {
  await float.open("/blog/notes-on-autosave/");
  await float.openPopover();
  const row = float.popover.locator(".address-row");
  await expect(row.locator("button.address-lock")).toHaveCount(0);
  const text = row.locator("button.address");
  await expect(text).toHaveText("notes-on-autosave");
  const textBox = await text.boundingBox();
  await text.click();
  const input = row.locator("input.address-input");
  await expect(input).toBeFocused();
  expectSameBox(await input.boundingBox(), textBox);

  // A click away puts it back.
  await float.popover.locator(".pop-head").click();
  await expect(row.locator("button.address")).toHaveText("notes-on-autosave");
  await expect(row.locator("input")).toHaveCount(0);
});

test("the form never offers slug or id for editing", async ({ float }) => {
  await float.open("/blog/hello-float/");
  await float.openPopover();
  await expect(float.popover.locator('.row[data-key="slug"] input, .row[data-key="id"] input')).toHaveCount(0);
});
