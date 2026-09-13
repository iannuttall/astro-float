// Compat check for astro-float against one running demo dev server.
// Usage: node scripts/compat/compat-test.mjs <baseUrl> <label>
// Playwright is not a dependency of this repo: point PLAYWRIGHT at an installed copy
// (e.g. PLAYWRIGHT=/path/to/node_modules/playwright/index.mjs), or install it and leave it unset.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const { chromium } = await import(process.env.PLAYWRIGHT ?? "playwright");

const BASE = process.argv[2] ?? "http://127.0.0.1:4365";
const LABEL = process.argv[3] ?? "run";
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const DEMO = path.join(ROOT, "demo");
const ENTRY = `${DEMO}/src/content/blog/hello-float/index.md`;
const SHOT = process.env.SHOT_DIR ?? path.join(ROOT, "scripts/compat/out");
fs.mkdirSync(SHOT, { recursive: true });
const original = fs.readFileSync(ENTRY, "utf8");
const results = [];
const check = (name, ok, extra = "") => results.push(`${ok ? "PASS" : "FAIL"} ${name}${extra ? " — " + extra : ""}`);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const fileHas = (s) => fs.readFileSync(ENTRY, "utf8").includes(s);
async function waitFile(s, ms = 8000) {
  const t = Date.now();
  while (Date.now() - t < ms) { if (fileHas(s)) return true; await sleep(150); }
  return false;
}

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
const logs = [];
page.on("console", (m) => { if (m.type() === "error" || m.type() === "warning") logs.push(`[${m.type()}] ${m.text()}`); });
page.on("pageerror", (e) => logs.push(`[pageerror] ${e.message}`));
page.on("response", (r) => { if (r.status() >= 400) logs.push(`[http ${r.status()}] ${r.url()}`); });

const CANVAS_JS = `(() => {
  const tb = document.querySelector("astro-dev-toolbar");
  return tb?.shadowRoot?.querySelector("astro-dev-toolbar-app-canvas[data-app-id='astro-float']") ?? null;
})()`;
const state = () => page.evaluate((js) => { const c = eval(js); const s = c?.__astroFloat?.state(); if (!s) return null; return s; }, CANVAS_JS);
const clickToolbarApp = () => page.evaluate(() => {
  const tb = document.querySelector("astro-dev-toolbar");
  const btn = tb?.shadowRoot?.querySelector("[data-app-id='astro-float']:not(astro-dev-toolbar-app-canvas)");
  if (!btn) return "no button";
  btn.click();
  return btn.tagName;
});
const waitEditing = (on) => page.waitForFunction(([js, on]) => { const c = eval(js); return !!c?.__astroFloat && c.__astroFloat.state().editing === on; }, [CANVAS_JS, on], { timeout: 10000 });

try {
  // First load lets Vite's dep optimizer settle (a fresh install can answer 504 "Outdated Optimize Dep" once); the reload is the real page.
  await page.goto(BASE + "/blog/hello-float/", { waitUntil: "networkidle" });
  // Vite may discover a dep on the first load, re-optimize and reload the page itself; wait for the toolbar app to be there.
  const t0 = Date.now();
  let toolbarReady = false;
  while (Date.now() - t0 < 20000 && !toolbarReady) {
    toolbarReady = await page.evaluate(() => !!document.querySelector("astro-dev-toolbar")?.shadowRoot?.querySelector("astro-dev-toolbar-app-canvas[data-app-id='astro-float']")?.__astroFloat).catch(() => false);
    if (!toolbarReady) await sleep(500);
  }
  check(`toolbar app mounted (${Date.now() - t0}ms after first load)`, toolbarReady);
  await sleep(500);

  // 1. Toolbar app registered (addDevToolbarApp) and toggles through the toolbar button (defineToolbarApp / canvas).
  const btnTag = await clickToolbarApp();
  check("toolbar button for astro-float exists", btnTag !== "no button", btnTag);
  let s = null;
  try {
    await waitEditing(true);
    await page.waitForFunction((js) => { const c = eval(js); const st = c?.__astroFloat?.state(); return !!st?.entry && st.bodyBound; }, CANVAS_JS, { timeout: 10000 }).catch(() => {});
    s = await state();
  } catch (e) { check("edit mode turned on via toolbar button", false, e.message); }
  if (s) {
    check("edit mode turned on via toolbar button", s.editing === true);
    // 2. Entry loaded with schema.
    check("entry resolved from URL", s.entry === "blog/hello-float", String(s.entry));
    check("schema source is zod (from .astro/collections)", s.schema?.source === "zod", JSON.stringify(s.schema?.source));
    check("schema has title field", Array.isArray(s.schema?.fields) && s.schema.fields.some((f) => f.key === "title"));
    check("body auto-bound", s.bodyBound === true && s.bodyMapped === true, JSON.stringify({ bound: s.bodyBound, mapped: s.bodyMapped, ro: s.bodyReadOnly }));
  }

  // 3. .astro/collections/*.schema.json written by astro sync.
  const schemaFile = `${DEMO}/.astro/collections/blog.schema.json`;
  check(".astro/collections/blog.schema.json exists", fs.existsSync(schemaFile));

  // 4. Render endpoint (markdown-remark resolved through the project's astro).
  const rendered = await page.evaluate(async () => {
    const res = await fetch("/__float/api/render", { method: "POST", headers: { "content-type": "application/json", "x-astro-float": "1" }, body: JSON.stringify({ collection: "blog", id: "hello-float", body: "Hello **world**\n\n- one\n- two\n" }) });
    return { status: res.status, body: await res.text() };
  });
  let renderOk = false;
  try { const j = JSON.parse(rendered.body); renderOk = rendered.status === 200 && j.blocks?.[0]?.html?.includes("<strong>") && j.blocks?.[1]?.html?.includes("<li>"); } catch {}
  check("POST /render works (markdown pipeline import resolves)", renderOk, rendered.body.slice(0, 200));
  const renderedImg = await page.evaluate(async () => {
    const res = await fetch("/__float/api/render", { method: "POST", headers: { "content-type": "application/json", "x-astro-float": "1" }, body: JSON.stringify({ collection: "notes", id: "hairline-followup", body: "![cover](./cover.png)\n\n```js\nconst a = 1;\n```\n" }) });
    return { status: res.status, body: await res.text() };
  });
  let imgOk = false, codeOk = false;
  try { const j = JSON.parse(renderedImg.body); imgOk = /<img[^>]*src="\/@fs\/[^"]*cover\.png"/.test(j.blocks?.[0]?.html ?? ""); codeOk = /<pre[^>]*>[\s\S]*<code/.test(j.blocks?.[1]?.html ?? ""); } catch {}
  check("POST /render: relative image points at /@fs and code block highlighted", imgOk && codeOk, renderedImg.body.slice(0, 300));

  // 4b. Schema hints need content.config.ts loaded through Vite (module runner / ssrLoadModule).
  const notesSchema = await page.evaluate(async () => (await fetch("/__float/api/schema?collection=notes")).json());
  const about = notesSchema.fields?.find((f) => f.key === "about");
  const cover = notesSchema.fields?.find((f) => f.key === "cover");
  check("schema hints: reference(\"blog\") and image() found by loading content.config.ts", about?.type === "reference" && about?.collection === "blog" && cover?.type === "image", JSON.stringify({ about, cover }).slice(0, 200));

  // 4c. A save Astro rejects answers synced:false fast (logger hook), not after the 2.5s timeout.
  const rejected = await page.evaluate(async () => {
    const doc = await (await fetch("/__float/api/entry?collection=blog&id=hello-float")).json();
    const t = Date.now();
    const res = await fetch("/__float/api/entry", { method: "PUT", headers: { "content-type": "application/json", "x-astro-float": "1" }, body: JSON.stringify({ collection: "blog", id: "hello-float", frontmatter: { ...doc.frontmatter, pubDate: "not-a-date" }, body: doc.body, baseHash: doc.hash }) });
    const j = await res.json();
    const ms = Date.now() - t;
    // put it back (a 422 never touched the file)
    if (res.status === 200) await fetch("/__float/api/entry", { method: "PUT", headers: { "content-type": "application/json", "x-astro-float": "1" }, body: JSON.stringify({ collection: "blog", id: "hello-float", frontmatter: doc.frontmatter, body: doc.body, baseHash: j.hash, force: true }) });
    return { status: res.status, synced: j.synced, issues: j.issues, ms };
  });
  // With the Zod pre-validation the save is refused (422, issue on pubDate); without it Astro's
  // content-layer error must be seen before the timeout and answer synced:false.
  const refused = rejected.status === 422 && Array.isArray(rejected.issues) && rejected.issues.some((i) => String(i.path).includes("pubDate"));
  const seen = rejected.status === 200 && rejected.synced === false && rejected.ms < 2200;
  check("invalid save is refused (422 with issues) or answers synced:false before the timeout", refused || seen, JSON.stringify(rejected).slice(0, 200));
  await sleep(1500);
  // Astro 5 also pushes the content error to Vite's overlay; clear it so it doesn't swallow the clicks below.
  await page.evaluate(() => document.querySelectorAll("vite-error-overlay").forEach((el) => el.remove()));

  // 5. Save round trip + sync gate: no full reload, PUT answers synced:true, file updated.
  await page.evaluate(() => { window.__floatNoReload = true; });
  const marker = `Compat edit ${LABEL} ${Date.now()}.`;
  await page.locator(".prose > p").first().click();
  await page.keyboard.press("End");
  await page.keyboard.type(" " + marker);
  const putWait = page.waitForResponse((r) => r.url().includes("/__float/api/entry") && r.request().method() === "PUT", { timeout: 15000 });
  await page.keyboard.press("Meta+s");
  let put = null;
  try { put = await (await putWait).json(); } catch (e) { check("PUT /entry answered", false, e.message); }
  if (put) {
    check("PUT /entry changed:true", put.changed === true, JSON.stringify(put).slice(0, 160));
    check("PUT /entry synced:true (sync-gate saw the content-layer reload)", put.synced === true, `synced=${put.synced}`);
  }
  check("edit written to disk", await waitFile(marker));
  await sleep(1500);
  const noReload = await page.evaluate(() => window.__floatNoReload === true);
  check("no full page reload after save (reload swallowed)", noReload);
  const after = await state();
  check("still editing after save", after?.editing === true && (after.status === "saved" || after.status === "idle"), JSON.stringify({ status: after?.status, editing: after?.editing }));
  const onPage = await page.evaluate((m) => document.querySelector(".prose")?.textContent?.includes(m), marker);
  check("saved text on the page after swap", onPage === true);

  // 6. Embeds: a lone YouTube URL pasted on an empty line becomes an iframe embed, saves as raw HTML, and renders back.
  await page.locator(".prose > p").last().click();
  await page.evaluate(() => {
    const p = document.querySelector("[data-float-body]").lastElementChild;
    const r = document.createRange(); r.selectNodeContents(p); r.collapse(false);
    const sel = getSelection(); sel.removeAllRanges(); sel.addRange(r);
  });
  await page.keyboard.press("Enter");
  await sleep(200);
  await page.evaluate(() => {
    const body = document.querySelector("[data-float-body]");
    const dt = new DataTransfer();
    dt.setData("text/plain", "https://www.youtube.com/watch?v=dQw4w9WgXcQ");
    const target = document.activeElement && body.contains(document.activeElement) ? document.activeElement : body;
    target.dispatchEvent(new ClipboardEvent("paste", { clipboardData: dt, bubbles: true, cancelable: true }));
  });
  await sleep(400);
  const embedInfo = await page.evaluate(() => {
    const body = document.querySelector("[data-float-body]");
    return { count: body.querySelectorAll("figure.embed iframe[src*='youtube-nocookie']").length, figures: body.querySelectorAll("figure.embed").length, tail: Array.from(body.children).slice(-2).map((c) => c.outerHTML.slice(0, 100)) };
  });
  check("pasted YouTube URL became an embed iframe", embedInfo.count === 1, JSON.stringify(embedInfo));
  const putWait2 = page.waitForResponse((r) => r.url().includes("/__float/api/entry") && r.request().method() === "PUT", { timeout: 15000 });
  await page.keyboard.press("Meta+s");
  try { const p2 = await (await putWait2).json(); check("embed save synced", p2.synced === true, `synced=${p2.synced}`); } catch (e) { check("embed save answered", false, e.message); }
  check("embed written to disk as raw HTML", await waitFile('<figure class="embed"><iframe src="https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ"'));
  await sleep(1500);
  const embedAfter = await page.evaluate(() => document.querySelectorAll("[data-float-body] figure.embed iframe[src*='youtube-nocookie']").length);
  check("embed still rendered after the page swap (Astro rendered the raw HTML)", embedAfter === 1, `count=${embedAfter}`);

  // 7. Toggle off through the toolbar (beforeTogglingOff path).
  await clickToolbarApp();
  try { await waitEditing(false); check("edit mode turned off via toolbar button", true); } catch (e) { check("edit mode turned off via toolbar button", false, e.message); }
  const editableLeft = await page.evaluate(() => document.querySelectorAll("[contenteditable='true']").length);
  check("no contenteditable left after edit off", editableLeft === 0, `count=${editableLeft}`);

  // 8. Fresh load of the mdx entry with edit on (sessionStorage path) — islands intact.
  await page.evaluate(() => sessionStorage.setItem("astro-float:edit", "1"));
  await page.goto(BASE + "/blog/mdx-islands/", { waitUntil: "networkidle" });
  try { await waitEditing(true); } catch {}
  const mdx = await page.evaluate(() => ({
    islands: document.querySelectorAll("[data-float-body] > [contenteditable='false']").length,
    callout: !!document.querySelector(".callout"),
  }));
  const ms = await state();
  check("mdx entry loads in edit mode with islands", ms?.entry === "blog/mdx-islands" && ms.editing && mdx.islands > 0 && mdx.callout, JSON.stringify({ entry: ms?.entry, ...mdx }));

  await page.screenshot({ path: `${SHOT}/${LABEL}.png` });
} catch (e) {
  results.push("ERROR " + (e.stack ?? e));
} finally {
  await browser.close();
  fs.writeFileSync(ENTRY, original);
  console.log(`## ${LABEL}`);
  console.log(results.join("\n"));
  const relevant = logs.filter((l) => !/favicon|DevTools|vite.*connected|\[vite\]/.test(l));
  if (relevant.length) console.log("browser logs:\n" + relevant.slice(0, 20).join("\n"));
  console.log(`SUMMARY ${LABEL}: ${results.filter((r) => r.startsWith("PASS")).length} pass, ${results.filter((r) => !r.startsWith("PASS")).length} fail`);
}
