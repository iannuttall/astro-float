import { changedLines, originalEntry, readEntry } from "./content";
import { expect, test } from "./float";

const ENTRY = "blog/hello-float/index.md";
const ORIGINAL_TITLE = "Hello, Float";

test.describe("frontmatter edited where it sits on the page", () => {
  test("title", async ({ float }) => {
    await float.open("/blog/hello-float/");
    const h1 = float.page.locator('h1[data-float-field="title"]');
    await expect(h1).toHaveText(ORIGINAL_TITLE);
    await h1.click();
    await float.page.keyboard.press("ControlOrMeta+a");
    await float.page.keyboard.type("Hello, Tests");
    await float.page.keyboard.press("Enter"); // Enter finishes the field
    await expect.poll(() => float.state()).toMatchObject({ frontmatterDirty: true, bodyDirty: false });

    await float.save();
    await float.expectSaved();
    const after = readEntry(ENTRY);
    expect(after).toContain("\ntitle: Hello, Tests\n");
    expect(changedLines(originalEntry(ENTRY), after)).toBe(1);
    await expect(h1).toHaveText("Hello, Tests");
    await expect(float.page).toHaveTitle(/Hello, Tests/);
  });

  test("description", async ({ float }) => {
    await float.open("/blog/hello-float/");
    const lede = float.page.locator('[data-float-field="description"]');
    await lede.click();
    await float.page.keyboard.press("ControlOrMeta+a");
    await float.page.keyboard.type("A one-line description: with a colon.");
    await float.page.keyboard.press("Enter");

    await float.save();
    await float.expectSaved();
    const after = readEntry(ENTRY);
    expect(after).toContain('\ndescription: "A one-line description: with a colon."\n');
    expect(changedLines(originalEntry(ENTRY), after)).toBe(1);
  });

  test("date, through the calendar", async ({ float }) => {
    await float.open("/blog/hello-float/");
    const time = float.page.locator('time[data-float-field="pubDate"]');
    await expect(time).toHaveText("September 1, 2026");
    await time.click();
    const picker = float.page.locator(".astro-float-datepicker");
    await expect(picker).toBeVisible();
    await picker.locator('[data-iso="2026-09-15"]').click();
    await expect(picker).toBeHidden();
    await expect(time).toHaveText("September 15, 2026");
    await expect.poll(() => float.state()).toMatchObject({ frontmatterDirty: true });

    await float.save();
    await float.expectSaved();
    const after = readEntry(ENTRY);
    expect(after).toContain("\npubDate: 2026-09-15\n");
    expect(changedLines(originalEntry(ENTRY), after)).toBe(1);
    await expect(time).toHaveText("September 15, 2026");
  });

  test("tags, with the inline + chip", async ({ float }) => {
    await float.open("/blog/hello-float/");
    const chips = float.page.locator("[data-float-chip]");
    await expect(chips).toHaveText(["#astro", "#editing"]);
    const add = float.page.locator("[data-float-add]");
    await add.click();
    await float.page.keyboard.type("tests");
    await float.page.keyboard.press("Enter");
    await expect(chips).toHaveText(["#astro", "#editing", "#tests"]);
    await expect(add).toHaveText("+");

    await float.save();
    await float.expectSaved();
    const after = readEntry(ENTRY);
    expect(after).toContain("tags:\n  - astro\n  - editing\n  - tests\n");
    expect(after.split("\n").length).toBe(originalEntry(ENTRY).split("\n").length + 1);
    await expect(chips).toHaveText(["#astro", "#editing", "#tests"]);
  });
});
