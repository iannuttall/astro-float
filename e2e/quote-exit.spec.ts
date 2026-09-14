import { originalEntry, readEntry } from "./content";
import { expect, test } from "./lee";

const ENTRY = "blog/hello-lee/index.md";

test("Enter twice leaves a quote: the file gets the quote, then a normal paragraph", async ({ lee }) => {
  await lee.open("/blog/hello-lee/");
  const quotes = lee.body.locator(":scope > blockquote");
  const before = await quotes.count();

  await lee.caretAtEnd(lee.body.locator(":scope > p").last());
  await lee.page.keyboard.press("Enter");
  await lee.page.keyboard.type("> Quoted line");
  await expect(quotes).toHaveCount(before + 1);
  await lee.page.keyboard.press("Enter");
  await lee.page.keyboard.press("Enter");
  await lee.page.keyboard.type("After the quote");
  // The typed words sit in a paragraph after the quote, not in it.
  await expect(quotes.last()).toHaveText("Quoted line");
  await expect(lee.body.locator(":scope > p").last()).toHaveText("After the quote");

  await lee.save();
  await lee.expectSaved();
  expect(readEntry(ENTRY)).toBe(`${originalEntry(ENTRY)}\n> Quoted line\n\nAfter the quote\n`);
});
