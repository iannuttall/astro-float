import { changedLines, originalEntry, readEntry } from "./content";
import { CANVAS, expect, test } from "./float";

const ENTRY = "blog/hello-float/index.md";

test("editing the YAML in the popover and saving writes the frontmatter", async ({ float }) => {
  await float.open("/blog/hello-float/");
  await expect(float.page.locator("article .meta .badge")).toHaveCount(0);

  await float.openPopover();
  const toggle = float.popover.locator(".pop-toggle");
  await toggle.click();
  await expect(toggle).toHaveAttribute("aria-pressed", "true");
  const yaml = float.page.locator(`${CANVAS} textarea.code-yaml`);
  await expect(yaml).toBeVisible();
  const text = await yaml.inputValue();
  expect(text).toContain("draft: false");

  await yaml.fill(text.replace("draft: false", "draft: true"));
  await expect.poll(() => float.state()).toMatchObject({ frontmatterDirty: true });
  const save = float.popover.locator(".pop-actions .btn-primary");
  await expect(save).toBeVisible();
  const [res] = await Promise.all([float.waitForSave(), save.click()]);
  expect(res.status()).toBe(200);
  await float.expectSaved();

  const after = readEntry(ENTRY);
  expect(after).toContain("\ndraft: true\n");
  expect(changedLines(originalEntry(ENTRY), after)).toBe(1);
  // The page re-rendered in place: the Draft badge is there now.
  await expect(float.page.locator("article .meta .badge")).toHaveText("Draft");
});

test("broken YAML is flagged and never written", async ({ float }) => {
  await float.open("/blog/hello-float/");
  await float.openPopover();
  await float.popover.locator(".pop-toggle").click();
  const yaml = float.page.locator(`${CANVAS} textarea.code-yaml`);
  await yaml.fill("title: [unclosed\n");
  await expect(float.popover.locator(".pop-toggle")).toHaveAttribute("data-error", "");
  await expect(float.page.locator(`${CANVAS} .code-error`)).not.toBeEmpty();
  await float.page.keyboard.press("ControlOrMeta+s");
  await float.page.waitForTimeout(500);
  expect(readEntry(ENTRY)).toBe(originalEntry(ENTRY));
});
