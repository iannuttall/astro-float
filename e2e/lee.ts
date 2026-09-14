import { expect, test as base, type Locator, type Page, type Response } from "@playwright/test";
import { restoreContent } from "./content";

/** The Edit app's canvas inside Astro's toolbar; Playwright's CSS pierces both shadow roots. */
export const CANVAS = 'astro-dev-toolbar astro-dev-toolbar-app-canvas[data-app-id="astro-lee"]';

export interface LeeState {
  editing: boolean;
  status: string;
  sourceMode: boolean;
  frontmatterDirty: boolean;
  bodyDirty: boolean;
  bodyBound: boolean;
  bodyMapped: boolean;
  bodyReadOnly: boolean;
  bodyDiff: string | null;
  staleOnDisk: boolean;
  keepMine: boolean;
  onPageFields: string[];
  entry: string | null;
}

/** Drives the on-page editor the way a person would, plus a few read-only peeks at its state. */
export class Lee {
  readonly base = process.env.LEE_BASE_URL!;
  readonly pill: Locator;
  readonly popover: Locator;
  readonly body: Locator;

  constructor(readonly page: Page) {
    this.pill = page.locator(`${CANVAS} .pill`);
    this.popover = page.locator(`${CANVAS} .popover`);
    this.body = page.locator("[data-lee-body]");
  }

  /** Open a page with Edit already on (the toolbar restores it from sessionStorage) and wait until the entry is bound. */
  async open(pathname: string, { edit = true } = {}) {
    if (edit) await this.page.addInitScript(() => sessionStorage.setItem("astro-lee:edit", "1"));
    await this.page.goto(this.base + pathname);
    await this.page.locator("astro-dev-toolbar").waitFor({ state: "attached" });
    if (edit) {
      await expect(this.pill).toBeVisible();
      await expect.poll(() => this.state()).toMatchObject({ editing: true, bodyBound: true });
    }
  }

  state(): Promise<LeeState> {
    return this.page.evaluate((sel) => {
      const tb = document.querySelector("astro-dev-toolbar");
      const canvas = tb?.shadowRoot?.querySelector(sel) as (HTMLElement & { __lee?: { state(): LeeState } }) | null;
      return canvas?.__lee?.state() ?? ({ editing: false } as LeeState);
    }, 'astro-dev-toolbar-app-canvas[data-app-id="astro-lee"]');
  }

  /** Click the Edit icon in Astro's toolbar (it is hidden until the bar is hovered, so click it from script). */
  async toggleEdit() {
    await this.page.evaluate(() => {
      const tb = document.querySelector("astro-dev-toolbar");
      (tb?.shadowRoot?.querySelector('button[data-app-id="astro-lee"]') as HTMLElement).click();
    });
  }

  async openPopover() {
    if ((await this.pill.getAttribute("aria-expanded")) !== "true") await this.pill.click();
    await expect(this.popover).toBeVisible();
    // Let the pop-in animation land, so a box measured next is where it stays.
    await this.popover.evaluate((el) => Promise.all(el.getAnimations().map((a) => a.finished)));
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
    return this.page.waitForResponse((r) => r.request().method() === "PUT" && r.url().includes("/__lee/api/entry"));
  }

  /** The pill went green: the write landed and nothing is dirty. */
  async expectSaved() {
    await expect.poll(() => this.state()).toMatchObject({ status: "saved", frontmatterDirty: false, bodyDirty: false });
  }
}

type Box = { x: number; y: number; width: number; height: number } | null;

/** The same place and size, to the half pixel. */
export function expectSameBox(actual: Box, expected: Box) {
  expect(actual).not.toBeNull();
  for (const key of ["x", "y", "width", "height"] as const) expect(actual![key]).toBeCloseTo(expected![key], 0);
}

export const test = base.extend<{ lee: Lee }>({
  lee: async ({ page }, use) => {
    const lee = new Lee(page);
    await use(lee);
    await page.close();
    await restoreContent(lee.base);
  },
});

export { expect };
