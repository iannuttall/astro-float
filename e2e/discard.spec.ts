import { originalEntry, readEntry } from "./content";
import { expect, test } from "./lee";

const ENTRY = "blog/hello-lee/index.md";

test("Discard puts the body, the fields and the status back without writing", async ({ lee }) => {
  await lee.open("/blog/hello-lee/");
  const p = lee.body.locator("p").first();
  const h1 = lee.page.locator('h1[data-lee-field="title"]');
  const bodyHtml = await lee.body.innerHTML();

  await lee.selectWord(p, "special");
  await lee.page.keyboard.type("temporary");
  await h1.click();
  await lee.page.keyboard.press("End");
  await lee.page.keyboard.type(" (draft)");
  await lee.page.keyboard.press("Enter");
  await expect.poll(() => lee.state()).toMatchObject({ bodyDirty: true, frontmatterDirty: true });

  await lee.openPopover();
  const discard = lee.popover.locator(".btn-discard");
  await expect(discard).toBeVisible();
  await discard.click();

  await expect.poll(() => lee.state()).toMatchObject({ bodyDirty: false, frontmatterDirty: false, status: "idle" });
  await expect(lee.pill).toHaveAttribute("data-state", "idle");
  await expect(p).toContainText("Nothing about it is special");
  await expect(h1).toHaveText("Hello, Lee");
  expect(await lee.body.innerHTML()).toBe(bodyHtml);
  await expect(discard).toBeHidden();
  expect(readEntry(ENTRY)).toBe(originalEntry(ENTRY));
});
