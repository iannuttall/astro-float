// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { applyImageLayout, imageBlockOf, imageLayoutOf, imageStyle } from "../src/toolbar/image-block";
import { containerFrom } from "./helpers";

const block = (html: string) => imageBlockOf(containerFrom(html).firstElementChild!)!;

describe("image blocks", () => {
  it("recognises a lone image paragraph (linked or not) and a wrapper around one", () => {
    expect(block('<p><img src="a.png" alt="a"></p>').wrapper).toBeNull();
    expect(block('<p><a href="/x"><img src="a.png" alt="a"></a></p>').img.alt).toBe("a");
    expect(block('<div style="width:50%"><p><img src="a.png" alt="a"></p></div>').wrapper?.tagName).toBe("DIV");
    expect(block('<div style="width:50%">\n<p><img src="a.png" alt="a"></p>\n</div>').paragraph.tagName).toBe("P");
    for (const html of ['<p>text <img src="a.png"></p>', '<p><img src="a.png"><img src="b.png"></p>', '<div><p><img src="a.png"></p><p>x</p></div>', "<figure><img src=\"a.png\"></figure>", "<p>only text</p>"]) {
      expect(imageBlockOf(containerFrom(html).firstElementChild!)).toBeNull();
    }
  });

  it("reads width and alignment from the wrapper's style", () => {
    expect(imageLayoutOf(block('<p><img src="a.png"></p>'))).toEqual({ size: 100, align: "left" });
    expect(imageLayoutOf(block('<div style="width:50%"><p><img src="a.png"></p></div>'))).toEqual({ size: 50, align: "left" });
    expect(imageLayoutOf(block('<div style="width:75%;margin-left:auto;margin-right:auto"><p><img src="a.png"></p></div>'))).toEqual({ size: 75, align: "center" });
    expect(imageLayoutOf(block('<div style="width: 25%; margin-left: auto"><p><img src="a.png"></p></div>'))).toEqual({ size: 25, align: "right" });
  });

  it("writes one fixed style per layout and keeps a site's other declarations", () => {
    expect(imageStyle({ size: 50, align: "left" })).toBe("width:50%");
    expect(imageStyle({ size: 50, align: "center" })).toBe("width:50%;margin-left:auto;margin-right:auto");
    expect(imageStyle({ size: 50, align: "right" })).toBe("width:50%;margin-left:auto");
    expect(imageStyle({ size: 25, align: "center" }, "border:1px solid red; width:50%; margin-left:auto")).toBe("border:1px solid red;width:25%;margin-left:auto;margin-right:auto");
    expect(imageStyle({ size: 100, align: "center" }, "width:50%;margin-left:auto")).toBe("");
    expect(imageStyle(null, "border: 1px solid red; width: 50%")).toBe("border:1px solid red");
  });

  it("wraps, restyles and unwraps in the DOM exactly as Astro renders the Markdown", () => {
    const container = containerFrom('<p><img src="a.png" alt="a"></p>');
    const p = container.firstElementChild as HTMLElement;
    const wrapper = applyImageLayout(imageBlockOf(p)!, { size: 50, align: "center" });
    expect(wrapper.tagName).toBe("DIV");
    expect(container.innerHTML).toBe('<div style="width:50%;margin-left:auto;margin-right:auto">\n<p><img src="a.png" alt="a"></p>\n</div>');
    expect(applyImageLayout(imageBlockOf(wrapper)!, { size: 75, align: "right" })).toBe(wrapper);
    expect(wrapper.getAttribute("style")).toBe("width:75%;margin-left:auto");
    expect(applyImageLayout(imageBlockOf(wrapper)!, { size: 100, align: "left" })).toBe(p);
    expect(container.innerHTML).toBe('<p><img src="a.png" alt="a"></p>');
  });

  it("never takes away a wrapper the site wrote, only Lee's declarations on it", () => {
    const styled = containerFrom('<div style="border:1px solid red;width:50%"><p><img src="a.png" alt="a"></p></div>');
    const div = styled.firstElementChild as HTMLElement;
    expect(applyImageLayout(imageBlockOf(div)!, { size: 100, align: "left" })).toBe(div);
    expect(styled.innerHTML).toBe('<div style="border:1px solid red"><p><img src="a.png" alt="a"></p></div>');

    const classed = containerFrom('<div class="hero" style="width:50%"><p><img src="a.png" alt="a"></p></div>');
    applyImageLayout(imageBlockOf(classed.firstElementChild!)!, { size: 100, align: "left" });
    expect(classed.innerHTML).toBe('<div class="hero"><p><img src="a.png" alt="a"></p></div>');

    // The editor's own marks don't make a wrapper the site's.
    const marked = containerFrom('<div style="width:25%" data-lee-island="" data-lee-image="" contenteditable="false" draggable="true"><p><img src="a.png" alt="a"></p></div>');
    expect(applyImageLayout(imageBlockOf(marked.firstElementChild!)!, { size: 100, align: "left" }).tagName).toBe("P");
  });
});
