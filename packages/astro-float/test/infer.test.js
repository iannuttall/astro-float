import { describe, expect, it } from "vitest";
import { DATE_LIKE, HAS_TIME, humanize, IMAGE_KEYS, inferField, inferType, TEXT_KEYS, TEXT_MAX } from "../src/shared/infer.js";

describe("humanize", () => {
  it.each([
    ["title", "Title"],
    ["pubDate", "Pub date"],
    ["hero_image", "Hero image"],
    ["og-image", "Og image"],
    ["SEOTitle", "SEO title"],
    ["HTMLParser", "HTML parser"],
    ["updatedAt", "Updated at"],
    ["  spaced__out--key ", "Spaced out key"],
    ["a1b", "A1b"],
  ])("%s → %s", (key, label) => {
    expect(humanize(key)).toBe(label);
  });
});

describe("inferType", () => {
  it.each([
    ["draft", true, "boolean"],
    ["priority", 3, "number"],
    ["pubDate", "2026-09-01", "date"],
    ["updated", "2026-09-01T10:00:00Z", "datetime"],
    ["updated", "2026-09-01 10:00", "datetime"],
    ["cover", "./cover.png", "image"],
    ["file", "photo.JPG", "image"],
    ["heroImage", "anything-at-all", "image"],
    ["cover", "", "string"],
    ["description", "short", "text"],
    ["Summary", "short", "text"],
    ["title", "x".repeat(TEXT_MAX + 1), "text"],
    ["title", "x".repeat(TEXT_MAX), "string"],
    ["title", "two\nlines", "text"],
    ["title", "Hello", "string"],
    ["description", null, "text"],
    ["title", undefined, "string"],
    ["tags", ["a", "b"], "tags"],
    ["tags", [], "tags"],
    ["links", [{ href: "/" }], "array"],
    ["mixed", ["a", 1], "array"],
    ["hero", { src: "x" }, "object"],
  ])("%s: %j → %s", (key, value, type) => {
    expect(inferType(key, value)).toBe(type);
  });

  it("exports the rules it uses", () => {
    expect(TEXT_KEYS.has("excerpt")).toBe(true);
    expect(DATE_LIKE.test("2026-09-01")).toBe(true);
    expect(DATE_LIKE.test("09/01/2026")).toBe(false);
    expect(HAS_TIME.test("2026-09-01T10:00")).toBe(true);
    expect(HAS_TIME.test("2026-09-01")).toBe(false);
    expect(IMAGE_KEYS.test("ogImage")).toBe(true);
    expect(IMAGE_KEYS.test("imageCount")).toBe(false);
  });
});

describe("inferField", () => {
  it("builds a definition that is never required", () => {
    expect(inferField("pubDate", "2026-09-01")).toEqual({ key: "pubDate", label: "Pub date", type: "date", required: false });
  });

  it("recurses into objects", () => {
    expect(inferField("hero", { src: "./a.png", alt: "x", width: 3 })).toEqual({
      key: "hero",
      label: "Hero",
      type: "object",
      required: false,
      fields: [
        { key: "src", label: "Src", type: "image", required: false },
        { key: "alt", label: "Alt", type: "string", required: false },
        { key: "width", label: "Width", type: "number", required: false },
      ],
    });
  });

  it("types an array by its first non-null item, labelled Item", () => {
    expect(inferField("links", [null, { href: "/" }])).toEqual({
      key: "links",
      label: "Links",
      type: "array",
      required: false,
      item: { key: "item", label: "Item", type: "object", required: false, fields: [{ key: "href", label: "Href", type: "string", required: false }] },
    });
    expect(inferField("nums", [1, 2]).item).toEqual({ key: "item", label: "Item", type: "number", required: false });
    expect(inferField("empty", [null]).item).toEqual({ key: "item", label: "Item", type: "json", required: false });
  });
});
