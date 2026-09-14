import fs from "node:fs";
import path from "node:path";
import { CONTENT_DIR, DEMO, entryPath, waitForContentSync } from "./content";
import { expect, expectSameBox, test } from "./float";

const CONFIG = path.join(DEMO, "src", "content.config.ts");

/** Poll until the dev server answers `url` with a page (an entry or a collection Astro has only just been told about). */
async function waitForPage(url: string) {
  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) {
    try {
      if ((await fetch(url, { headers: { accept: "text/html" } })).ok) return;
    } catch {
      /* server busy */
    }
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error(`${url} did not answer`);
}

test("Delete post turns into Confirm in its own place, and the second click deletes", async ({ float }) => {
  // A throwaway post, last in the blog's list: the blog has no /blog/ listing, so the page lands on the entry before it.
  const created = await float.page.request.post(`${float.base}/__float/api/entries`, {
    headers: { "x-astro-float": "1" },
    data: { collection: "blog", slug: "temporary-post", title: "Temporary post" },
  });
  expect(created.status()).toBe(201);
  await waitForPage(`${float.base}/blog/temporary-post/`);
  await float.open("/blog/temporary-post/");
  await float.openPopover();

  const row = float.popover.locator(".pop-delete .delete-row");
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
  await float.page.keyboard.press("Escape");
  await expect(button).toHaveText("Delete post");
  await expect(float.popover).toBeVisible();
  await button.click();
  await float.popover.locator(".pop-head").click();
  await expect(button).toHaveText("Delete post");

  // Five seconds turn it back too, with the pointer and the focus still on it.
  await button.click();
  await expect(button).toHaveText("Confirm");
  await float.page.waitForTimeout(5_500);
  await expect(button).toHaveText("Delete post");
  await expect(button).not.toHaveAttribute("data-confirming", "");
  expectSameBox(await button.boundingBox(), idle);

  // A double click is only the first click.
  await button.dblclick();
  await expect(button).toHaveText("Confirm");
  await float.page.keyboard.press("Escape");
  await expect(button).toHaveText("Delete post");
  expect(fs.existsSync(entryPath("blog/temporary-post/index.md"))).toBe(true);

  // From the keyboard: Enter arms it, Enter on the focused Confirm deletes; the folder goes and the page follows.
  await button.focus();
  await float.page.keyboard.press("Enter");
  await expect(button).toHaveText("Confirm");
  await expect(button).toBeFocused();
  const [res] = await Promise.all([
    float.page.waitForResponse((r) => r.request().method() === "DELETE" && r.url().includes("/__float/api/entry?")),
    float.page.keyboard.press("Enter"),
  ]);
  expect(res.status()).toBe(200);
  expect(await res.json()).toMatchObject({ id: "temporary-post", removed: ["src/content/blog/temporary-post"] });
  expect(fs.existsSync(entryPath("blog/temporary-post"))).toBe(false);

  await float.page.waitForURL("**/blog/on-hairlines/");
  await expect.poll(() => float.state()).toMatchObject({ entry: "blog/on-hairlines", editing: true });
  await expect(float.pill.locator(".pill-word")).toHaveText("Deleted");
  await expect(float.pill).toHaveAttribute("data-state", "saved");
  await expect.poll(async () => (await float.state()).status, { timeout: 8_000 }).toBe("idle");
});

test("Delete collection works the same way: the folder and its config go, then home", async ({ float }) => {
  const config = fs.readFileSync(CONFIG, "utf8");
  try {
    const created = await float.page.request.post(`${float.base}/__float/api/collections`, {
      headers: { "x-astro-float": "1" },
      data: { name: "scratch", title: "First scratch" },
    });
    expect(created.status()).toBe(201);
    expect(fs.readFileSync(CONFIG, "utf8")).toContain("const scratch = defineCollection(");
    await waitForPage(`${float.base}/scratch/first-scratch/`);
    await float.open("/scratch/first-scratch/");
    await float.openPopover();

    // Only there with the entries open.
    const line = float.popover.locator(".foot-body .delete-row");
    const remove = line.locator("button");
    await expect(line).toBeHidden();
    await float.popover.locator(".foot-toggle").click();
    await expect(remove).toHaveText("Delete collection");
    await remove.scrollIntoViewIfNeeded();
    const idle = await remove.boundingBox();
    await remove.click();
    await expect(remove).toHaveText("Confirm");
    await expect(line).toHaveText("Confirm");
    expectSameBox(await remove.boundingBox(), idle);

    const [res] = await Promise.all([
      float.page.waitForResponse((r) => r.request().method() === "DELETE" && r.url().includes("/__float/api/collection?")),
      remove.click(),
    ]);
    expect(res.status()).toBe(200);
    expect(await res.json()).toMatchObject({ collection: "scratch", entries: 1, config: { updated: true } });

    await float.page.waitForURL(`${float.base}/`);
    await expect.poll(() => float.state()).toMatchObject({ editing: true, entry: null });
    await expect(float.pill.locator(".pill-word")).toHaveText("Deleted");
    expect(fs.existsSync(path.join(CONTENT_DIR, "scratch"))).toBe(false);
    expect(fs.readFileSync(CONFIG, "utf8")).toBe(config);
  } finally {
    if (fs.readFileSync(CONFIG, "utf8") !== config) {
      const synced = waitForContentSync(float.base, 8_000).catch(() => {});
      fs.writeFileSync(CONFIG, config);
      await synced;
    }
  }
});
