import { originalEntry, readEntry } from "./content";
import { expect, test } from "./float";

const ENTRY = "blog/mdx-islands/index.mdx";

test("an MDX component moves as one block and its source is written back verbatim", async ({ float }) => {
  await float.open("/blog/mdx-islands/");
  await expect.poll(() => float.state()).toMatchObject({ bodyMapped: true, bodyReadOnly: false });
  const island = float.body.locator(":scope > [data-float-island]");
  await expect(island).toHaveCount(1);
  await expect(island).toContainText("This is a component");

  await island.click();
  const bar = float.page.locator(".astro-float-bar");
  await expect(bar).toBeVisible();
  await bar.locator('button[aria-label="Move up"]').click();
  await expect.poll(() => float.state()).toMatchObject({ bodyDirty: true });
  // It now sits above the paragraph that used to precede it.
  await expect(float.body.locator(":scope > *").nth(1)).toHaveAttribute("data-float-island", "");

  await float.save();
  await float.expectSaved();

  const before = originalEntry(ENTRY);
  const para = "Float treats component blocks as **islands**.";
  const paraStart = before.indexOf(para);
  const paraEnd = before.indexOf("\n\n", paraStart) + 2;
  const callout = before.slice(paraEnd, before.indexOf("</Callout>") + "</Callout>\n\n".length);
  const expected = before.slice(0, paraStart) + callout + before.slice(paraStart, paraEnd) + before.slice(paraEnd + callout.length);
  expect(readEntry(ENTRY)).toBe(expected);
});
