import { changedLines, originalEntry, readEntry } from "./content";
import { CANVAS, expect, test } from "./lee";

const ENTRY = "blog/hello-lee/index.md";

test("editing the YAML in the popover and saving writes the frontmatter", async ({ lee }) => {
  await lee.open("/blog/hello-lee/");
  await expect(lee.page.locator("article .meta .badge")).toHaveCount(0);

  await lee.openPopover();
  const toggle = lee.popover.locator(".pop-toggle");
  await toggle.click();
  await expect(toggle).toHaveAttribute("aria-pressed", "true");
  const yaml = lee.page.locator(`${CANVAS} textarea.code-yaml`);
  await expect(yaml).toBeVisible();
  const text = await yaml.inputValue();
  expect(text).toContain("draft: false");

  await yaml.fill(text.replace("draft: false", "draft: true"));
  await expect.poll(() => lee.state()).toMatchObject({ frontmatterDirty: true });
  const save = lee.popover.locator(".pop-actions .btn-primary");
  await expect(save).toBeVisible();
  const [res] = await Promise.all([lee.waitForSave(), save.click()]);
  expect(res.status()).toBe(200);
  await lee.expectSaved();

  const after = readEntry(ENTRY);
  expect(after).toContain("\ndraft: true\n");
  expect(changedLines(originalEntry(ENTRY), after)).toBe(1);
  // The page re-rendered in place: the Draft badge is there now.
  await expect(lee.page.locator("article .meta .badge")).toHaveText("Draft");
});

test("broken YAML is flagged and never written", async ({ lee }) => {
  await lee.open("/blog/hello-lee/");
  await lee.openPopover();
  await lee.popover.locator(".pop-toggle").click();
  const yaml = lee.page.locator(`${CANVAS} textarea.code-yaml`);
  await yaml.fill("title: [unclosed\n");
  await expect(lee.popover.locator(".pop-toggle")).toHaveAttribute("data-error", "");
  await expect(lee.page.locator(`${CANVAS} .code-error`)).not.toBeEmpty();
  await lee.page.keyboard.press("ControlOrMeta+s");
  expect(readEntry(ENTRY)).toBe(originalEntry(ENTRY));
});
