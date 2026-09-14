import { expect, test } from "./float";

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

test("turning Edit off leaves the page exactly as it was", async ({ float }) => {
  await float.open("/blog/hello-float/", { edit: false });
  const before = await pageDom(float.page);
  expect(before.body).not.toContain("data-float");

  await float.toggleEdit();
  await expect(float.pill).toBeVisible();
  await expect.poll(() => float.state()).toMatchObject({ editing: true, bodyBound: true });
  // Use the editor a little: caret in the body, hover the title, open and close the popover.
  await float.body.locator("p").first().click();
  await float.page.locator('h1[data-float-field="title"]').hover();
  await float.openPopover();
  await float.closePopover();
  expect((await pageDom(float.page)).body).toContain("data-float-editing");

  await float.toggleEdit();
  await expect.poll(() => float.state()).toMatchObject({ editing: false });
  await expect(float.pill).toHaveCount(0);

  const after = await pageDom(float.page);
  expect(after.bodyAttrs).toEqual(before.bodyAttrs);
  expect(after.htmlAttrs).toEqual(before.htmlAttrs);
  expect(after.headStyles).toEqual(before.headStyles);
  expect(after.body).toBe(before.body);
});
