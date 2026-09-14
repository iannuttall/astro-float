import { changedLines, originalEntry, readEntry } from "./content";
import { expect, test } from "./lee";

const ENTRY = "blog/hello-lee/index.md";

test("fixing a typo and pressing ⌘S changes exactly one line on disk", async ({ lee }) => {
  await lee.open("/blog/hello-lee/");
  const p = lee.body.locator("p").first();
  await expect(p).toContainText("Nothing about it is special");

  await lee.selectWord(p, "special");
  await lee.page.keyboard.type("ordinary");
  await expect(p).toContainText("Nothing about it is ordinary");
  await expect.poll(() => lee.state()).toMatchObject({ bodyDirty: true, frontmatterDirty: false });
  await expect(lee.pill).toHaveAttribute("data-state", "dirty");

  const res = await lee.save();
  expect(res.status()).toBe(200);
  await lee.expectSaved();

  const before = originalEntry(ENTRY);
  const after = readEntry(ENTRY);
  expect(changedLines(before, after)).toBe(1);
  expect(after).toContain("Nothing about it is ordinary — it is a normal Astro content collection entry.");
  expect(after.split("\n")[0]).toBe("---");
  // Frontmatter is untouched byte for byte.
  expect(after.slice(0, after.indexOf("\n---\n", 4))).toBe(before.slice(0, before.indexOf("\n---\n", 4)));
});
