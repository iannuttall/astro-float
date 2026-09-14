import fs from "node:fs";
import { entryPath, originalEntry, readEntry } from "./content";
import { expect, test } from "./lee";

const ENTRY = "blog/hello-lee/index.md";

test("a save against a file changed on disk gets a 409, and Overwrite wins", async ({ lee }) => {
  await lee.open("/blog/hello-lee/");
  const p = lee.body.locator("p").first();
  await lee.selectWord(p, "special");
  await lee.page.keyboard.type("contested");

  // Meanwhile someone edits the description in their IDE.
  const outside = originalEntry(ENTRY).replace("description: What this demo is, and how to poke at it.", "description: Edited outside Lee.");
  fs.writeFileSync(entryPath(ENTRY), outside);
  await expect.poll(() => lee.state()).toMatchObject({ staleOnDisk: true });

  const res = await lee.save();
  expect(res.status()).toBe(409);
  await expect.poll(() => lee.state()).toMatchObject({ status: "conflict", bodyDirty: true });
  await expect(lee.pill).toHaveAttribute("data-state", "conflict");
  expect(readEntry(ENTRY)).toBe(outside);

  await lee.openPopover();
  await expect(lee.popover.getByRole("button", { name: "Reload" })).toBeVisible();
  const overwrite = lee.popover.getByRole("button", { name: "Overwrite" });
  const [forced] = await Promise.all([lee.waitForSave(), overwrite.click()]);
  expect(forced.status()).toBe(200);
  await lee.expectSaved();

  const after = readEntry(ENTRY);
  expect(after).toContain("Nothing about it is contested");
  expect(after).toContain("description: What this demo is, and how to poke at it.");
  expect(after).not.toContain("Edited outside Lee");
});
