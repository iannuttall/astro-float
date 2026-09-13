import { changedLines, originalEntry, readEntry } from "./content";
import { expect, test } from "./float";

const ENTRY = "blog/hello-float/index.md";

test("fixing a typo and pressing ⌘S changes exactly one line on disk", async ({ float }) => {
  await float.open("/blog/hello-float/");
  const p = float.body.locator("p").first();
  await expect(p).toContainText("Nothing about it is special");

  await float.selectWord(p, "special");
  await float.page.keyboard.type("ordinary");
  await expect(p).toContainText("Nothing about it is ordinary");
  await expect.poll(() => float.state()).toMatchObject({ bodyDirty: true, frontmatterDirty: false });
  await expect(float.pill).toHaveAttribute("data-state", "dirty");

  const res = await float.save();
  expect(res.status()).toBe(200);
  await float.expectSaved();

  const before = originalEntry(ENTRY);
  const after = readEntry(ENTRY);
  expect(changedLines(before, after)).toBe(1);
  expect(after).toContain("Nothing about it is ordinary — it is a normal Astro content collection entry.");
  expect(after.split("\n")[0]).toBe("---");
  // Frontmatter is untouched byte for byte.
  expect(after.slice(0, after.indexOf("\n---\n", 4))).toBe(before.slice(0, before.indexOf("\n---\n", 4)));
});
