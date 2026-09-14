import { expect, test } from "./lee";

/** The page's own DOM, minus the toolbar and the dev-only annotations Astro strips on its own schedule. */
async function pageDom(page: import("@playwright/test").Page) {
  return page.evaluate(() => {
    const body = document.body.cloneNode(true) as HTMLElement;
    body.querySelector("astro-dev-toolbar")?.remove();
    for (const el of Array.from(body.querySelectorAll("*"))) {
      for (const attr of Array.from(el.attributes)) if (attr.name.startsWith("data-astro-source-")) el.removeAttribute(attr.name);
    }
    return {
      body: body.innerHTML,
      bodyAttrs: Array.from(document.body.attributes).map((a) => `${a.name}=${a.value}`),
      htmlAttrs: Array.from(document.documentElement.attributes).map((a) => `${a.name}=${a.value}`),
      headStyles: Array.from(document.head.querySelectorAll("style")).map((s) => s.id).filter(Boolean),
    };
  });
}

test("turning Edit off leaves the page exactly as it was", async ({ lee }) => {
  await lee.open("/blog/hello-lee/", { edit: false });
  // Astro's own toolbar apps settle right after load.
  await lee.page.waitForTimeout(500);
  const before = await pageDom(lee.page);
  expect(before.body).not.toContain("data-lee");

  await lee.toggleEdit();
  await expect(lee.pill).toBeVisible();
  await expect.poll(() => lee.state()).toMatchObject({ editing: true, bodyBound: true });
  // Use the editor a little: caret in the body, hover the title, open and close the popover.
  await lee.body.locator("p").first().click();
  await lee.page.locator('h1[data-lee-field="title"]').hover();
  await lee.openPopover();
  await lee.closePopover();
  expect((await pageDom(lee.page)).body).toContain("data-lee-editing");

  await lee.toggleEdit();
  await expect.poll(() => lee.state()).toMatchObject({ editing: false });
  await expect(lee.pill).toHaveCount(0);

  const after = await pageDom(lee.page);
  expect(after.bodyAttrs).toEqual(before.bodyAttrs);
  expect(after.htmlAttrs).toEqual(before.htmlAttrs);
  expect(after.headStyles).toEqual(before.headStyles);
  expect(after.body).toBe(before.body);
});
