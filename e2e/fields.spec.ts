import { changedLines, originalEntry, readEntry } from "./content";
import { expect, test } from "./lee";

const ENTRY = "blog/hello-lee/index.md";
const ORIGINAL_TITLE = "Hello, Lee";

test.describe("frontmatter edited where it sits on the page", () => {
  test("title", async ({ lee }) => {
    await lee.open("/blog/hello-lee/");
    const h1 = lee.page.locator('h1[data-lee-field="title"]');
    await expect(h1).toHaveText(ORIGINAL_TITLE);
    await h1.click();
    await lee.page.keyboard.press("ControlOrMeta+a");
    await lee.page.keyboard.type("Hello, Tests");
    await lee.page.keyboard.press("Enter"); // Enter finishes the field
    await expect.poll(() => lee.state()).toMatchObject({ frontmatterDirty: true, bodyDirty: false });

    await lee.save();
    await lee.expectSaved();
    const after = readEntry(ENTRY);
    expect(after).toContain("\ntitle: Hello, Tests\n");
    expect(changedLines(originalEntry(ENTRY), after)).toBe(1);
    await expect(h1).toHaveText("Hello, Tests");
    await expect(lee.page).toHaveTitle(/Hello, Tests/);
  });

  test("description", async ({ lee }) => {
    await lee.open("/blog/hello-lee/");
    const lede = lee.page.locator('[data-lee-field="description"]');
    await lede.click();
    await lee.page.keyboard.press("ControlOrMeta+a");
    await lee.page.keyboard.type("A one-line description: with a colon.");
    await lee.page.keyboard.press("Enter");

    await lee.save();
    await lee.expectSaved();
    const after = readEntry(ENTRY);
    expect(after).toContain('\ndescription: "A one-line description: with a colon."\n');
    expect(changedLines(originalEntry(ENTRY), after)).toBe(1);
  });

  test("date, through the calendar", async ({ lee }) => {
    await lee.open("/blog/hello-lee/");
    const time = lee.page.locator('time[data-lee-field="pubDate"]');
    await expect(time).toHaveText("September 1, 2026");
    await time.click();
    const picker = lee.page.locator(".lee-datepicker");
    await expect(picker).toBeVisible();
    await picker.locator('[data-iso="2026-09-15"]').click();
    await expect(picker).toBeHidden();
    await expect(time).toHaveText("September 15, 2026");
    await expect.poll(() => lee.state()).toMatchObject({ frontmatterDirty: true });

    await lee.save();
    await lee.expectSaved();
    const after = readEntry(ENTRY);
    expect(after).toContain("\npubDate: 2026-09-15\n");
    expect(changedLines(originalEntry(ENTRY), after)).toBe(1);
    await expect(time).toHaveText("September 15, 2026");
  });

  test("tags, with the inline + chip", async ({ lee }) => {
    await lee.open("/blog/hello-lee/");
    const chips = lee.page.locator("[data-lee-chip]");
    await expect(chips).toHaveText(["#astro", "#editing"]);
    const add = lee.page.locator("[data-lee-add]");
    await add.click();
    await lee.page.keyboard.type("tests");
    await lee.page.keyboard.press("Enter");
    await expect(chips).toHaveText(["#astro", "#editing", "#tests"]);
    await expect(add).toHaveText("+");

    await lee.save();
    await lee.expectSaved();
    const after = readEntry(ENTRY);
    expect(after).toContain("tags:\n  - astro\n  - editing\n  - tests\n");
    expect(after.split("\n").length).toBe(originalEntry(ENTRY).split("\n").length + 1);
    await expect(chips).toHaveText(["#astro", "#editing", "#tests"]);
  });
});
