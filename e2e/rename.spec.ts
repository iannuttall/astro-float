import fs from "node:fs";
import type { Locator } from "@playwright/test";
import { entryPath, readEntry } from "./content";
import { expect, expectSameBox, test, type Lee } from "./lee";

// A 1×1 transparent PNG.
const PNG = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==";

/** Open the Address row's input: a click for a draft, two on the padlock for a published post (after an error it is still open). */
async function openAddress(lee: Lee): Promise<Locator> {
  await lee.openPopover();
  const row = lee.popover.locator(".address-row");
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
async function rename(lee: Lee, slug: string) {
  const input = await openAddress(lee);
  await input.fill(slug);
  const [res] = await Promise.all([
    lee.page.waitForResponse((r) => r.request().method() === "POST" && r.url().includes("/__lee/api/rename")),
    input.press("Enter"),
  ]);
  return res;
}

/**
 * A failed attempt can leave an entry at its new address, where the next attempt couldn't move it again. Move it back
 * the way Lee does (images and all, the asset map cleaned); restoreContent then puts the text back.
 */
test.afterEach(async ({ lee }) => {
  const moved = [
    { collection: "blog", id: "hello-moved", slug: "hello-lee", file: "blog/hello-moved/index.md", from: "blog/hello-moved", to: "blog/hello-lee" },
    { collection: "notes", id: "to-read", slug: "reading-list", file: "notes/to-read.md", from: "notes/to-read.md", to: "notes/reading-list.md" },
  ];
  for (const entry of moved) {
    if (!fs.existsSync(entryPath(entry.file))) continue;
    const res = await fetch(`${lee.base}/__lee/api/rename`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-lee": "1" },
      body: JSON.stringify({ collection: entry.collection, id: entry.id, slug: entry.slug }),
    }).catch(() => null);
    // The server couldn't: move it back by hand, so the paths Astro already knows exist again.
    if (!res?.ok && !fs.existsSync(entryPath(entry.to))) fs.renameSync(entryPath(entry.from), entryPath(entry.to));
  }
});

test("a published folder entry unlocks in two clicks, moves with its image, and the page follows", async ({ lee }, testInfo) => {
  // A new image name for every attempt: an earlier attempt's image stays next to the entry until the run ends.
  const image = `tiny-move-${testInfo.repeatEachIndex}-${testInfo.retry}.png`;
  const alt = image.replace(/[.]png$/, "").replace(/-/g, " ");
  const srcIn = (folder: string) => new RegExp(`${folder}(/|%2F)${image.replace(".", "[.]")}`);
  await lee.open("/blog/hello-lee/");

  // Give the entry an image first, so there is something next to it to move.
  const target = lee.body.locator(":scope > p").nth(1);
  const box = (await target.boundingBox())!;
  const upload = lee.page.waitForResponse((r) => r.request().method() === "POST" && r.url().includes("/__lee/api/media"));
  await lee.body.evaluate(
    (el, { png, name, x, y }) => {
      const bytes = Uint8Array.from(atob(png), (c) => c.charCodeAt(0));
      const dt = new DataTransfer();
      dt.items.add(new File([bytes], name, { type: "image/png" }));
      el.dispatchEvent(new DragEvent("drop", { dataTransfer: dt, clientX: x, clientY: y, bubbles: true, cancelable: true }));
    },
    { png: PNG, name: image, x: box.x + box.width / 2, y: box.y + box.height / 2 },
  );
  expect((await upload).status()).toBe(201);
  await lee.save();
  await lee.expectSaved();
  expect(readEntry("blog/hello-lee/index.md")).toContain(`![${alt}](./${image})`);

  // Published: the address sits behind a padlock, and the id itself does nothing.
  await lee.openPopover();
  const row = lee.popover.locator(".address-row");
  const text = row.locator(".address");
  const lock = row.locator("button.address-lock");
  await expect(text).toHaveText("hello-lee");
  await expect(lock).toHaveAttribute("data-tip", "Change address");
  await text.click();
  await expect(row.locator("input")).toHaveCount(0);

  // The first click asks, in the padlock's own tooltip; a click elsewhere, or four seconds, and it stops asking.
  await lock.click();
  await expect(lock).toHaveAttribute("data-tip", "Are you sure? Old links will break");
  await expect(lee.page.locator(".lee-tip[data-show]")).toHaveText("Are you sure? Old links will break");
  await lee.popover.locator(".pop-head").click();
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
  await expect(input).toHaveValue("hello-lee");
  expectSameBox(await input.boundingBox(), textBox);
  expect(await input.evaluate((el: HTMLInputElement) => [el.selectionStart, el.selectionEnd])).toEqual([0, "hello-lee".length]);
  await input.fill("Hello Moved!");
  await expect(input).toHaveValue("hello-moved");
  expectSameBox(await row.boundingBox(), rowBox);

  // Escape puts it back, locks it again and keeps the popover open.
  await input.press("Escape");
  await expect(text).toHaveText("hello-lee");
  await expect(lock).toHaveAttribute("data-tip", "Change address");
  await expect(lee.popover).toBeVisible();

  // Not allowed, then taken: a red hairline and the reason in the input's tooltip; no line under the row, nothing moved.
  await (await openAddress(lee)).fill("bad-");
  await input.press("Enter");
  await expect(input).toHaveAttribute("data-invalid", "");
  await expect(input).toHaveAttribute("data-tip", "Can't start or end with a dash");
  const taken = await rename(lee, "on-hairlines");
  expect(taken.status()).toBe(409);
  await expect(input).toHaveAttribute("data-tip", "Already used");
  await expect(input).toHaveAttribute("data-invalid", "");
  expectSameBox(await row.boundingBox(), rowBox);
  expect(fs.existsSync(entryPath("blog/hello-lee/index.md"))).toBe(true);

  // Apply: the folder moves, the page is the new URL, the image still renders from the new folder.
  const res = await rename(lee, "hello-moved");
  expect(res.status()).toBe(200);
  await lee.page.waitForURL("**/blog/hello-moved/");
  await expect.poll(() => lee.state()).toMatchObject({ entry: "blog/hello-moved", editing: true, bodyBound: true, frontmatterDirty: false, bodyDirty: false });
  await expect(lee.page.locator('h1[data-lee-field="title"]')).toHaveText("Hello, Lee");
  const img = lee.body.locator(`img[alt='${alt}']`);
  await expect(img).toHaveAttribute("src", srcIn("hello-moved"));
  await expect.poll(() => img.evaluate((el) => (el as HTMLImageElement).naturalWidth)).toBe(1);

  expect(fs.existsSync(entryPath("blog/hello-lee"))).toBe(false);
  expect(fs.existsSync(entryPath("blog/hello-moved/index.md"))).toBe(true);
  expect(fs.existsSync(entryPath(`blog/hello-moved/${image}`))).toBe(true);

  // The popover follows, locked again: header, Address row, entries list.
  await lee.openPopover();
  await expect(lee.popover.locator(".pop-entry")).toHaveText("blog/hello-moved");
  await expect(lee.popover.locator(".address-row .address")).toHaveText("hello-moved");
  await expect(lee.popover.locator(".address-row button.address-lock")).toHaveAttribute("data-tip", "Change address");
  await lee.popover.locator(".foot-toggle").click();
  await expect(lee.popover.locator('.list-item[aria-current="page"]')).toHaveAttribute("href", "/blog/hello-moved/");

  // And back.
  const back = await rename(lee, "hello-lee");
  expect(back.status()).toBe(200);
  await lee.page.waitForURL("**/blog/hello-lee/");
  await expect.poll(() => lee.state()).toMatchObject({ entry: "blog/hello-lee", editing: true, bodyBound: true });
  expect(fs.existsSync(entryPath("blog/hello-moved"))).toBe(false);
  expect(fs.existsSync(entryPath(`blog/hello-lee/${image}`))).toBe(true);
  await expect(lee.body.locator(`img[alt='${alt}']`)).toHaveAttribute("src", srcIn("hello-lee"));
});

test("a flat entry renames its file and the page follows", async ({ lee }) => {
  await lee.open("/notes/reading-list/");
  const res = await rename(lee, "to-read");
  expect(res.status()).toBe(200);
  await lee.page.waitForURL("**/notes/to-read/");
  await expect.poll(() => lee.state()).toMatchObject({ entry: "notes/to-read", editing: true, bodyBound: true });
  await expect(lee.page.locator('h1[data-lee-field="title"]')).toHaveText("Reading list");
  expect(fs.existsSync(entryPath("notes/reading-list.md"))).toBe(false);
  expect(readEntry("notes/to-read.md")).toContain("title: Reading list");

  // Pending edits are saved to the file before it moves.
  const h1 = lee.page.locator('h1[data-lee-field="title"]');
  await h1.click();
  await lee.page.keyboard.press("ControlOrMeta+a");
  await lee.page.keyboard.type("Reading list, moved");
  await lee.page.keyboard.press("Enter");
  await expect.poll(() => lee.state()).toMatchObject({ frontmatterDirty: true });
  const saved = lee.waitForSave();
  const back = await rename(lee, "reading-list");
  expect((await saved).status()).toBe(200);
  expect(back.status()).toBe(200);
  await lee.page.waitForURL("**/notes/reading-list/");
  await expect.poll(() => lee.state()).toMatchObject({ entry: "notes/reading-list", frontmatterDirty: false });
  expect(readEntry("notes/reading-list.md")).toContain("title: Reading list, moved");
  expect(fs.existsSync(entryPath("notes/to-read.md"))).toBe(false);
});

test("a draft's address edits on a click, with no padlock", async ({ lee }) => {
  await lee.open("/blog/notes-on-autosave/");
  await lee.openPopover();
  const row = lee.popover.locator(".address-row");
  await expect(row.locator("button.address-lock")).toHaveCount(0);
  const text = row.locator("button.address");
  await expect(text).toHaveText("notes-on-autosave");
  const textBox = await text.boundingBox();
  await text.click();
  const input = row.locator("input.address-input");
  await expect(input).toBeFocused();
  expectSameBox(await input.boundingBox(), textBox);

  // A click away puts it back.
  await lee.popover.locator(".pop-head").click();
  await expect(row.locator("button.address")).toHaveText("notes-on-autosave");
  await expect(row.locator("input")).toHaveCount(0);
});

test("the form never offers slug or id for editing", async ({ lee }) => {
  await lee.open("/blog/hello-lee/");
  await lee.openPopover();
  await expect(lee.popover.locator('.row[data-key="slug"] input, .row[data-key="id"] input')).toHaveCount(0);
});
