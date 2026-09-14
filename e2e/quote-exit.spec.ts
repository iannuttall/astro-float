import { originalEntry, readEntry } from "./content";
import { expect, test } from "./float";

const ENTRY = "blog/hello-float/index.md";

test("Enter twice leaves a quote: the file gets the quote, then a normal paragraph", async ({ float }) => {
  await float.open("/blog/hello-float/");
  const quotes = float.body.locator(":scope > blockquote");
  const before = await quotes.count();

  await float.caretAtEnd(float.body.locator(":scope > p").last());
  await float.page.keyboard.press("Enter");
  await float.page.keyboard.type("> Quoted line");
  await expect(quotes).toHaveCount(before + 1);
  await float.page.keyboard.press("Enter");
  await float.page.keyboard.press("Enter");
  await float.page.keyboard.type("After the quote");
  // The typed words sit in a paragraph after the quote, not in it.
  await expect(quotes.last()).toHaveText("Quoted line");
  await expect(float.body.locator(":scope > p").last()).toHaveText("After the quote");

  await float.save();
  await float.expectSaved();
  expect(readEntry(ENTRY)).toBe(`${originalEntry(ENTRY)}\n> Quoted line\n\nAfter the quote\n`);
});
