import fs from "node:fs";
import { entryPath, readEntry } from "./content";
import { expect, test } from "./float";

test("New entry creates the file and navigates to it", async ({ float }) => {
  await float.open("/blog/hello-float/");
  await float.openPopover();
  await float.popover.locator('button[data-tip="New entry in blog"]').click();
  const card = float.popover.locator(".card");
  await expect(card).toBeVisible();
  const title = card.locator("input.input");
  await title.fill("A Fresh Entry");
  await expect(card.locator(".mono")).toHaveText("src/content/blog/a-fresh-entry/");

  const [res] = await Promise.all([
    float.page.waitForResponse((r) => r.request().method() === "POST" && r.url().includes("/__float/api/entries")),
    title.press("Enter"),
  ]);
  expect(res.status()).toBe(201);

  await float.page.waitForURL("**/blog/a-fresh-entry/");
  await expect.poll(() => float.state()).toMatchObject({ entry: "blog/a-fresh-entry", editing: true, bodyBound: true });
  await expect(float.page.locator('h1[data-float-field="title"]')).toHaveText("A Fresh Entry");
  await expect(float.body).toContainText("Start writing…");

  expect(fs.existsSync(entryPath("blog/a-fresh-entry/index.md"))).toBe(true);
  const raw = readEntry("blog/a-fresh-entry/index.md");
  expect(raw).toMatch(/^---\ntitle: A Fresh Entry\ndescription: ""\npubDate: \d{4}-\d{2}-\d{2}\ntags: \[\]\ndraft: false\n---\n\nStart writing…\n$/);
});
