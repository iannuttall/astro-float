import { originalEntry, readEntry } from "./content";
import { expect, test } from "./lee";

const ENTRY = "blog/mdx-islands/index.mdx";

test("an MDX component moves as one block and its source is written back verbatim", async ({ lee }) => {
  await lee.open("/blog/mdx-islands/");
  await expect.poll(() => lee.state()).toMatchObject({ bodyMapped: true, bodyReadOnly: false });
  const island = lee.body.locator(":scope > [data-lee-island]");
  await expect(island).toHaveCount(1);
  await expect(island).toContainText("This is a component");

  await island.click();
  const bar = lee.page.locator(".lee-bar");
  await expect(bar).toBeVisible();
  await bar.locator('button[aria-label="Move up"]').click();
  await expect.poll(() => lee.state()).toMatchObject({ bodyDirty: true });
  // It now sits above the paragraph that used to precede it.
  await expect(lee.body.locator(":scope > *").nth(1)).toHaveAttribute("data-lee-island", "");

  await lee.save();
  await lee.expectSaved();

  const before = originalEntry(ENTRY);
  const para = "Lee treats component blocks as **islands**.";
  const paraStart = before.indexOf(para);
  const paraEnd = before.indexOf("\n\n", paraStart) + 2;
  const callout = before.slice(paraEnd, before.indexOf("</Callout>") + "</Callout>\n\n".length);
  const expected = before.slice(0, paraStart) + callout + before.slice(paraStart, paraEnd) + before.slice(paraEnd + callout.length);
  expect(readEntry(ENTRY)).toBe(expected);
});
