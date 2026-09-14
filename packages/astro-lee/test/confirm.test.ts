import { describe, expect, it } from "vitest";
import { nounFor } from "../src/toolbar/panel/confirm";

describe("nounFor", () => {
  it("names one entry of a collection when the plural is plain", () => {
    expect(nounFor("blog")).toBe("post");
    expect(nounFor("posts")).toBe("post");
    expect(nounFor("notes")).toBe("note");
    expect(nounFor("docs")).toBe("doc");
    expect(nounFor("recipes")).toBe("recipe");
    expect(nounFor("photos")).toBe("photo");
    expect(nounFor("blog-posts")).toBe("blog post");
  });

  it("says entry when the singular isn't obvious", () => {
    for (const name of ["til", "news", "stories", "boxes", "matches", "releases", "status", "glass", "changelog"]) expect(nounFor(name), name).toBe("entry");
  });
});
