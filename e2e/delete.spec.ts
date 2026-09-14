import fs from "node:fs";
import path from "node:path";
import { CONTENT_DIR, DEMO, entryPath, waitForContentSync } from "./content";
import { expect, test } from "./float";

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

test("Delete post asks once in place, removes the entry and moves the page on", async ({ float }) => {
  // A throwaway post, last in the blog's list: the blog has no /blog/ listing, so the page lands on the entry before it.
  const created = await float.page.request.post(`${float.base}/__float/api/entries`, {
    headers: { "x-astro-float": "1" },
    data: { collection: "blog", slug: "temporary-post", title: "Temporary post" },
  });
  expect(created.status()).toBe(201);
  await waitForPage(`${float.base}/blog/temporary-post/`);
  await float.open("/blog/temporary-post/");
  await float.openPopover();

  const row = float.popover.locator(".delete-row");
  const button = row.getByRole("button", { name: "Delete post" });
  const question = row.locator(".confirm-text");

  // Esc, a click elsewhere in the popover, and Enter on the focused Cancel all put the button back.
  await button.click();
  await expect(question).toHaveText("Delete “Temporary post”? This removes its folder.");
  await expect(row.getByRole("button", { name: "Cancel" })).toBeFocused();
  await float.page.keyboard.press("Escape");
  await expect(button).toBeVisible();
  await expect(float.popover).toBeVisible();

  await button.click();
  await float.popover.locator(".pop-head").click();
  await expect(button).toBeVisible();

  await button.click();
  await float.page.keyboard.press("Enter");
  await expect(button).toBeVisible();
  expect(fs.existsSync(entryPath("blog/temporary-post/index.md"))).toBe(true);

  // Tab to Delete, Enter: the folder goes and the page follows.
  await button.click();
  await float.page.keyboard.press("Tab");
  await expect(row.getByRole("button", { name: "Delete", exact: true })).toBeFocused();
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

test("Delete collection removes the folder and its config, then goes home", async ({ float }) => {
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
    const remove = float.popover.getByRole("button", { name: "Delete collection" });
    await expect(remove).toBeHidden();
    await float.popover.locator(".foot-toggle").click();
    await remove.click();
    const confirm = float.popover.locator(".foot-body .confirm");
    await expect(confirm.locator(".confirm-text")).toHaveText("Delete scratch and its 1 entry? This removes the folder and its config.");

    const [res] = await Promise.all([
      float.page.waitForResponse((r) => r.request().method() === "DELETE" && r.url().includes("/__float/api/collection?")),
      confirm.getByRole("button", { name: "Delete", exact: true }).click(),
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
