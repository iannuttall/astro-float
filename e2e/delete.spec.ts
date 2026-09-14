import fs from "node:fs";
import path from "node:path";
import { CONTENT_DIR, DEMO, entryPath, syncContent } from "./content";
import { expect, expectSameBox, test } from "./lee";

const CONFIG = path.join(DEMO, "src", "content.config.ts");

test("Delete post turns into Confirm in its own place, and the second click deletes", async ({ lee }) => {
  // A throwaway post, last in the blog's list: the blog has no /blog/ listing, so the page lands on the entry before it.
  const created = await lee.page.request.post(`${lee.base}/__lee/api/entries`, {
    headers: { "x-lee": "1" },
    data: { collection: "blog", slug: "temporary-post", title: "Temporary post" },
  });
  expect(created.status()).toBe(201);
  await lee.open("/blog/temporary-post/");
  await lee.openPopover();

  const row = lee.popover.locator(".pop-delete .delete-row");
  const button = row.locator("button");
  await expect(button).toHaveCount(1);
  await expect(button).toHaveText("Delete post");
  // In view first: a click scrolls to what it clicks, and that would move the box.
  await button.scrollIntoViewIfNeeded();
  const idle = await button.boundingBox();
  const rowBox = await row.boundingBox();

  // The first click turns the same button into a red Confirm, in exactly its box; nothing else appears.
  await button.click();
  await expect(button).toHaveText("Confirm");
  await expect(button).toHaveAttribute("data-confirming", "");
  await expect(row).toHaveText("Confirm");
  expectSameBox(await button.boundingBox(), idle);
  expectSameBox(await row.boundingBox(), rowBox);

  // Esc and a click elsewhere in the popover turn it back, and the popover stays open.
  await lee.page.keyboard.press("Escape");
  await expect(button).toHaveText("Delete post");
  await expect(lee.popover).toBeVisible();
  await button.click();
  await lee.popover.locator(".pop-head").click();
  await expect(button).toHaveText("Delete post");

  // Five seconds turn it back too, with the pointer and the focus still on it.
  await button.click();
  await expect(button).toHaveText("Confirm");
  await lee.page.waitForTimeout(5_500);
  await expect(button).toHaveText("Delete post");
  await expect(button).not.toHaveAttribute("data-confirming", "");
  expectSameBox(await button.boundingBox(), idle);

  // A double click is only the first click.
  await button.dblclick();
  await expect(button).toHaveText("Confirm");
  await lee.page.keyboard.press("Escape");
  await expect(button).toHaveText("Delete post");
  expect(fs.existsSync(entryPath("blog/temporary-post/index.md"))).toBe(true);

  // From the keyboard: Enter arms it, Enter on the focused Confirm deletes; the folder goes and the page follows.
  await button.focus();
  await lee.page.keyboard.press("Enter");
  await expect(button).toHaveText("Confirm");
  await expect(button).toBeFocused();
  const [res] = await Promise.all([
    lee.page.waitForResponse((r) => r.request().method() === "DELETE" && r.url().includes("/__lee/api/entry?")),
    lee.page.keyboard.press("Enter"),
  ]);
  expect(res.status()).toBe(200);
  expect(await res.json()).toMatchObject({ id: "temporary-post", removed: ["src/content/blog/temporary-post"] });
  expect(fs.existsSync(entryPath("blog/temporary-post"))).toBe(false);

  await lee.page.waitForURL("**/blog/on-hairlines/");
  await expect.poll(() => lee.state()).toMatchObject({ entry: "blog/on-hairlines", editing: true });
  await expect(lee.pill.locator(".pill-word")).toHaveText("Deleted");
  await expect(lee.pill).toHaveAttribute("data-state", "saved");
  await expect.poll(async () => (await lee.state()).status, { timeout: 8_000 }).toBe("idle");
});

test("Delete collection works the same way: the folder and its config go, then home", async ({ lee }) => {
  const config = fs.readFileSync(CONFIG, "utf8");
  try {
    const created = await lee.page.request.post(`${lee.base}/__lee/api/collections`, {
      headers: { "x-lee": "1" },
      data: { name: "scratch", title: "First scratch" },
    });
    expect(created.status()).toBe(201);
    expect(fs.readFileSync(CONFIG, "utf8")).toContain("const scratch = defineCollection(");
    await lee.open("/scratch/first-scratch/");
    await lee.openPopover();

    // Only there with the entries open.
    const line = lee.popover.locator(".foot-body .delete-row");
    const remove = line.locator("button");
    await expect(line).toBeHidden();
    await lee.popover.locator(".foot-toggle").click();
    await expect(remove).toHaveText("Delete collection");
    await remove.scrollIntoViewIfNeeded();
    const idle = await remove.boundingBox();
    await remove.click();
    await expect(remove).toHaveText("Confirm");
    await expect(line).toHaveText("Confirm");
    expectSameBox(await remove.boundingBox(), idle);

    const [res] = await Promise.all([
      lee.page.waitForResponse((r) => r.request().method() === "DELETE" && r.url().includes("/__lee/api/collection?")),
      remove.click(),
    ]);
    expect(res.status()).toBe(200);
    expect(await res.json()).toMatchObject({ collection: "scratch", entries: 1, config: { updated: true } });

    await lee.page.waitForURL(`${lee.base}/`);
    await expect.poll(() => lee.state()).toMatchObject({ editing: true, entry: null });
    await expect(lee.pill.locator(".pill-word")).toHaveText("Deleted");
    expect(fs.existsSync(path.join(CONTENT_DIR, "scratch"))).toBe(false);
    expect(fs.readFileSync(CONFIG, "utf8")).toBe(config);
  } finally {
    if (fs.readFileSync(CONFIG, "utf8") !== config) {
      fs.writeFileSync(CONFIG, config);
      await syncContent(lee.base);
    }
  }
});
