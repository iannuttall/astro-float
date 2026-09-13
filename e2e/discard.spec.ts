import { originalEntry, readEntry } from "./content";
import { expect, test } from "./float";

const ENTRY = "blog/hello-float/index.md";

test("Discard puts the body, the fields and the status back without writing", async ({ float }) => {
  await float.open("/blog/hello-float/");
  const p = float.body.locator("p").first();
  const h1 = float.page.locator('h1[data-float-field="title"]');
  const bodyHtml = await float.body.innerHTML();

  await float.selectWord(p, "special");
  await float.page.keyboard.type("temporary");
  await h1.click();
  await float.page.keyboard.press("End");
  await float.page.keyboard.type(" (draft)");
  await float.page.keyboard.press("Enter");
  await expect.poll(() => float.state()).toMatchObject({ bodyDirty: true, frontmatterDirty: true });

  await float.openPopover();
  const discard = float.popover.locator(".btn-discard");
  await expect(discard).toBeVisible();
  await discard.click();

  await expect.poll(() => float.state()).toMatchObject({ bodyDirty: false, frontmatterDirty: false, status: "idle" });
  await expect(float.pill).toHaveAttribute("data-state", "idle");
  await expect(p).toContainText("Nothing about it is special");
  await expect(h1).toHaveText("Hello, Float");
  expect(await float.body.innerHTML()).toBe(bodyHtml);
  await expect(discard).toBeHidden();
  expect(readEntry(ENTRY)).toBe(originalEntry(ENTRY));
});
