import { expect, test as base, type Locator, type Page, type Response } from "@playwright/test";
import { restoreContent } from "./content";

/** The Edit app's canvas inside Astro's toolbar; Playwright's CSS pierces both shadow roots. */
export const CANVAS = 'astro-dev-toolbar astro-dev-toolbar-app-canvas[data-app-id="astro-float"]';

export interface FloatState {
  editing: boolean;
  status: string;
  sourceMode: boolean;
  frontmatterDirty: boolean;
  bodyDirty: boolean;
  bodyBound: boolean;
  bodyMapped: boolean;
  bodyReadOnly: boolean;
  bodyDiff: string | null;
  onPageFields: string[];
  entry: string | null;
}

/** Drives the on-page editor the way a person would, plus a few read-only peeks at its state. */
export class Float {
  readonly base = process.env.FLOAT_BASE_URL!;
  readonly pill: Locator;
  readonly popover: Locator;
  readonly body: Locator;

  constructor(readonly page: Page) {
    this.pill = page.locator(`${CANVAS} .pill`);
    this.popover = page.locator(`${CANVAS} .popover`);
    this.body = page.locator("[data-float-body]");
  }

  /** Open a page with Edit already on (the toolbar restores it from sessionStorage) and wait until the entry is bound. */
  async open(pathname: string, { edit = true } = {}) {
    if (edit) await this.page.addInitScript(() => sessionStorage.setItem("astro-float:edit", "1"));
    await this.page.goto(this.base + pathname);
    await this.page.locator("astro-dev-toolbar").waitFor({ state: "attached" });
    if (edit) {
      await expect(this.pill).toBeVisible();
      await expect.poll(() => this.state()).toMatchObject({ editing: true, bodyBound: true });
    }
  }

  state(): Promise<FloatState> {
    return this.page.evaluate((sel) => {
      const tb = document.querySelector("astro-dev-toolbar");
      const canvas = tb?.shadowRoot?.querySelector(sel) as (HTMLElement & { __astroFloat?: { state(): FloatState } }) | null;
      return canvas?.__astroFloat?.state() ?? ({ editing: false } as FloatState);
    }, 'astro-dev-toolbar-app-canvas[data-app-id="astro-float"]');
  }

  /** Click the Edit icon in Astro's toolbar (it is hidden until the bar is hovered, so click it from script). */
  async toggleEdit() {
    await this.page.evaluate(() => {
      const tb = document.querySelector("astro-dev-toolbar");
      (tb?.shadowRoot?.querySelector('button[data-app-id="astro-float"]') as HTMLElement).click();
    });
  }

  async openPopover() {
    if ((await this.pill.getAttribute("aria-expanded")) !== "true") await this.pill.click();
    await expect(this.popover).toBeVisible();
  }

  async closePopover() {
    if ((await this.pill.getAttribute("aria-expanded")) === "true") await this.page.keyboard.press("Escape");
    await expect(this.popover).toBeHidden();
  }

  /** Put the caret at the end of `locator`'s text (inside the editable body). */
  async caretAtEnd(locator: Locator) {
    await locator.evaluate((el) => {
      const host = el.closest<HTMLElement>("[contenteditable]");
      host?.focus();
      const range = document.createRange();
      range.selectNodeContents(el);
      range.collapse(false);
      const sel = document.getSelection()!;
      sel.removeAllRanges();
      sel.addRange(range);
    });
  }

  /** Select one word inside `locator` so typing replaces it. */
  async selectWord(locator: Locator, word: string) {
    const found = await locator.evaluate((el, word) => {
      const host = el.closest<HTMLElement>("[contenteditable]");
      host?.focus();
      const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
      for (let node = walker.nextNode(); node; node = walker.nextNode()) {
        const i = node.textContent!.indexOf(word);
        if (i < 0) continue;
        const range = document.createRange();
        range.setStart(node, i);
        range.setEnd(node, i + word.length);
        const sel = document.getSelection()!;
        sel.removeAllRanges();
        sel.addRange(range);
        return true;
      }
      return false;
    }, word);
    expect(found, `"${word}" is on the page`).toBe(true);
  }

  /** ⌘S / Ctrl+S, and the PUT it triggers. */
  async save(): Promise<Response> {
    const [res] = await Promise.all([this.waitForSave(), this.page.keyboard.press("ControlOrMeta+s")]);
    return res;
  }

  waitForSave(): Promise<Response> {
    return this.page.waitForResponse((r) => r.request().method() === "PUT" && r.url().includes("/__float/api/entry"));
  }

  /** The pill went green: the write landed and nothing is dirty. */
  async expectSaved() {
    await expect.poll(() => this.state()).toMatchObject({ status: "saved", frontmatterDirty: false, bodyDirty: false });
  }
}

export const test = base.extend<{ float: Float }>({
  float: async ({ page }, use) => {
    const float = new Float(page);
    await use(float);
    await page.close();
    await restoreContent(float.base);
  },
});

export { expect };
