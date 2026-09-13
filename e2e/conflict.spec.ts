import fs from "node:fs";
import { entryPath, originalEntry, readEntry } from "./content";
import { expect, test } from "./float";

const ENTRY = "blog/hello-float/index.md";

test("a save against a file changed on disk gets a 409, and Overwrite wins", async ({ float }) => {
  // Astro answers an outside edit with a full page reload, which would drop the draft
  // before the conflict can be seen; keep the HMR socket open but swallow that one message.
  await float.page.routeWebSocket(() => true, (ws) => {
    const server = ws.connectToServer();
    ws.onMessage((m) => server.send(m));
    server.onMessage((m) => {
      if (typeof m === "string" && m.includes('"full-reload"')) return;
      ws.send(m);
    });
  });
  await float.open("/blog/hello-float/");
  const p = float.body.locator("p").first();
  await float.selectWord(p, "special");
  await float.page.keyboard.type("contested");

  // Meanwhile someone edits the description in their IDE.
  const outside = originalEntry(ENTRY).replace("description: What this demo is, and how to poke at it.", "description: Edited outside Float.");
  fs.writeFileSync(entryPath(ENTRY), outside);
  await float.page.waitForTimeout(300);

  const res = await float.save();
  expect(res.status()).toBe(409);
  await expect.poll(() => float.state()).toMatchObject({ status: "conflict", bodyDirty: true });
  await expect(float.pill).toHaveAttribute("data-state", "conflict");
  expect(readEntry(ENTRY)).toBe(outside);

  await float.openPopover();
  await expect(float.popover.getByRole("button", { name: "Reload" })).toBeVisible();
  const overwrite = float.popover.getByRole("button", { name: "Overwrite" });
  const [forced] = await Promise.all([float.waitForSave(), overwrite.click()]);
  expect(forced.status()).toBe(200);
  await float.expectSaved();

  const after = readEntry(ENTRY);
  expect(after).toContain("Nothing about it is contested");
  expect(after).toContain("description: What this demo is, and how to poke at it.");
  expect(after).not.toContain("Edited outside Float");
});
