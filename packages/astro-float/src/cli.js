#!/usr/bin/env node
/**
 * astro-float — the command line.
 *
 *   astro-float doctor [--url http://localhost:4321] [--route /blog/[id]] [--all]
 *
 * With `astro dev` running, `doctor` asks Float's API about every collection
 * and prints a short report: where the schema comes from, which entries the
 * schema refuses (field and message), and — for each entry's page — whether
 * every frontmatter value and the body actually appear on the page, which is
 * what Float needs to find them without `data-float-*` attributes. Exit code
 * 1 when any entry fails validation.
 *
 * Node only, no dependencies.
 */

const args = process.argv.slice(2);
const command = args.find((a) => !a.startsWith("-"));

if (command === "doctor") {
  doctor(parseFlags(args)).then(
    (code) => process.exit(code),
    (err) => {
      console.error(`astro-float: ${err?.message ?? err}`);
      process.exit(2);
    },
  );
} else {
  console.log(
    [
      "astro-float — on-page content editor for Astro (dev only)",
      "",
      "Usage:",
      "  astro-float doctor [--url http://localhost:4321] [--route /blog/[id]] [--all]",
      "",
      "  doctor   with astro dev running: schema source per collection, entries the",
      "           schema refuses, and whether each entry's values show on its page.",
      "           --route sets the page route (collection=/path/[id] for one",
      "           collection, or /path/[id] for all); --all checks every entry",
      "           instead of the first 20 per collection.",
    ].join("\n"),
  );
  process.exit(command ? 2 : 0);
}

// ---- doctor ---------------------------------------------------------------------------

async function doctor(flags) {
  const base = String(flags.url ?? "http://localhost:4321").replace(/\/+$/, "");
  const api = `${base}/__float/api`;
  const cap = flags.all ? Infinity : 20;
  const paint = painter();

  let collections;
  try {
    collections = (await getJson(`${api}/collections`)).collections;
  } catch (err) {
    throw new Error(`can't reach ${api} (${err?.message ?? err}). Is astro dev running there? Pass --url if it's elsewhere.`);
  }

  out(`astro-float doctor — ${base}`);
  out("");
  if (!collections.length) {
    out("No collections found under the content directory.");
    return 0;
  }

  let failing = 0;
  for (const collection of collections) {
    const diagnosis = await getJson(`${api}/diagnose?collection=${encodeURIComponent(collection.name)}`);
    const count = collection.entries.length;
    const source =
      diagnosis.schema === "zod"
        ? `schema from content.config.ts${diagnosis.strict ? " (strict)" : ""}`
        : diagnosis.schema === "none"
          ? "schema not loadable, saves aren't validated"
          : "no schema, types inferred from values";
    out(`${collection.name} — ${count} ${count === 1 ? "entry" : "entries"}, ${source}`);

    const invalid = diagnosis.entries.filter((e) => e.issues.length);
    failing += invalid.length;
    for (const e of invalid) {
      out(`  ${paint.bad("✗")} ${e.id}  fails validation`);
      for (const issue of e.issues) {
        for (const line of wrap(`${issue.path.join(".") || "(entry)"}: ${issue.message}`, 74)) out(`      ${line}`);
      }
    }

    const toCheck = collection.entries.slice(0, cap);
    for (const entry of toCheck) {
      const report = await checkPage({ api, base, collection, entry, route: routeFor(flags, collection) });
      out(`  ${entry.id}`);
      if (report.skipped) {
        out(`      page ? ${report.skipped}`);
        continue;
      }
      for (const line of wrap(report.marks.map((m) => `${m.label} ${m.ok ? paint.ok("✓") : paint.bad("✗")}${m.note ? ` ${m.note}` : ""}`).join("  "), 74)) out(`      ${line}`);
      for (const fix of report.fixes) for (const line of wrap(`fix: ${fix}`, 74)) out(`      ${line}`);
    }
    if (count > toCheck.length) out(`  … ${count - toCheck.length} more (pass --all to check every entry)`);
    out("");
  }

  if (failing) out(`${failing} ${failing === 1 ? "entry fails" : "entries fail"} validation.`);
  else out("Every entry passes its schema.");
  return failing ? 1 : 0;
}

/**
 * Fetch the entry's page and look for each value in its text. Dates count as
 * found when the year, month and day appear ("formatted"); tags when every tag
 * does; the body when the first block's text does.
 */
async function checkPage({ api, base, collection, entry, route }) {
  const doc = await getJson(`${api}/entry?collection=${encodeURIComponent(collection.name)}&id=${encodeURIComponent(entry.id)}`);
  const candidates = route ? [fillRoute(route, entry.id)] : [`/${collection.name}/${entry.id}/`, `/${collection.name}/${entry.id}`];
  let html = null;
  for (const p of candidates) {
    const res = await fetch(base + p, { headers: { accept: "text/html" } }).catch(() => null);
    if (res?.ok) {
      html = await res.text();
      break;
    }
  }
  if (html == null) return { skipped: `no page at ${candidates[0]} (pass --route ${collection.name}=/path/[id])` };

  // Inline tags (<code>, <a>, <em>) add stray spaces when stripped, and Astro's
  // smartypants swaps quotes and dashes: compare with whitespace removed and
  // punctuation folded. Dates keep the spaced text so word boundaries work.
  const text = normalize(pageText(html));
  const dense = squash(text);
  const has = (needle) => {
    const n = squash(normalize(needle));
    return n.length > 0 && dense.includes(n);
  };
  const fields = new Map((doc.schema?.fields ?? []).map((f) => [f.key, f]));
  const marks = [];
  const fixes = [];

  for (const [key, value] of Object.entries(doc.frontmatter ?? {})) {
    if (key === "slug" || key === "layout" || key === "draft") continue;
    const def = fields.get(key);
    const type = def?.type ?? guessType(key, value);
    if (!["string", "text", "date", "datetime", "tags", "enum"].includes(type)) continue;
    if (value == null || value === "" || (Array.isArray(value) && !value.length)) {
      marks.push({ label: key, ok: false, note: "empty" });
      continue;
    }
    if (type === "tags") {
      const tags = Array.isArray(value) ? value.map(String) : [String(value)];
      const found = tags.filter((t) => has(t));
      const ok = found.length === tags.length;
      marks.push({ label: key, ok, note: ok ? "" : `(${found.length} of ${tags.length})` });
      if (!ok) fixes.push(`add data-float-field="${key}" to the element that lists the tags, or print every tag verbatim`);
      continue;
    }
    if (type === "date" || type === "datetime") {
      const raw = String(value);
      if (has(raw)) {
        marks.push({ label: key, ok: true });
        continue;
      }
      const formatted = dateFormatted(raw, text);
      marks.push({ label: key, ok: formatted, note: formatted ? "(formatted)" : "" });
      if (!formatted) fixes.push(`add data-float-field="${key}" to the <time> (or element) that prints the date`);
      continue;
    }
    const ok = has(String(value));
    marks.push({ label: key, ok });
    if (!ok) fixes.push(`add data-float-field="${key}" to the element that prints it, or print the value verbatim`);
  }

  const first = (doc.blocks ?? []).find((b) => !b.island && typeof b.text === "string" && b.text.trim());
  if (first) {
    const ok = has(first.text);
    marks.push({ label: "body", ok });
    if (!ok) fixes.push("add data-float-body to the element that wraps the rendered Markdown");
  } else {
    marks.push({ label: "body", ok: false, note: "empty" });
  }
  return { marks, fixes };
}

// ---- helpers --------------------------------------------------------------------------

function parseFlags(argv) {
  const flags = { routes: {} };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--all") flags.all = true;
    else if (a === "--url") flags.url = argv[++i];
    else if (a.startsWith("--url=")) flags.url = a.slice(6);
    else if (a === "--route" || a.startsWith("--route=")) {
      const v = a === "--route" ? argv[++i] : a.slice(8);
      const m = /^([^=/]+)=(.+)$/.exec(v ?? "");
      if (m) flags.routes[m[1]] = m[2];
      else flags.route = v;
    }
  }
  return flags;
}

function routeFor(flags, collection) {
  return flags.routes[collection.name] ?? flags.route ?? collection.route ?? null;
}

function fillRoute(route, id) {
  let p = route.replace(/\[\.\.\.[^\]]+\]/g, id).replace(/\[[^\]]+\]/g, id);
  if (!p.startsWith("/")) p = "/" + p;
  return p;
}

async function getJson(url) {
  const res = await fetch(url, { headers: { accept: "application/json" } });
  const text = await res.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    /* not JSON */
  }
  if (!res.ok) throw new Error(data?.error ? String(data.error) : `HTTP ${res.status} for ${url}`);
  return data;
}

/** The page's visible text: scripts, styles and the dev toolbar dropped, tags stripped, entities decoded. */
function pageText(html) {
  return html
    .replace(/<script\b[\s\S]*?<\/script>/gi, " ")
    .replace(/<style\b[\s\S]*?<\/style>/gi, " ")
    .replace(/<template\b[\s\S]*?<\/template>/gi, " ")
    .replace(/<astro-dev-toolbar\b[\s\S]*?<\/astro-dev-toolbar>/gi, " ")
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos|nbsp|#39);/gi, (m, code) => {
      const named = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", "#39": "'" };
      if (code.toLowerCase() in named) return named[code.toLowerCase()];
      const n = code[1]?.toLowerCase() === "x" ? parseInt(code.slice(2), 16) : parseInt(code.slice(1), 10);
      return Number.isFinite(n) ? String.fromCodePoint(n) : m;
    });
}

function normalize(s) {
  return String(s)
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/…/g, "...")
    .replace(/[–—]|-{2,3}/g, "-")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

function squash(s) {
  return s.replace(/\s+/g, "");
}

const MONTHS = ["january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december"];

/** "2026-09-05" printed as "5 September 2026", "Sep 5, 2026", "09/05/2026", … */
function dateFormatted(raw, text) {
  const d = new Date(raw);
  if (Number.isNaN(d.getTime())) return false;
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(raw);
  const year = m ? m[1] : String(d.getUTCFullYear());
  const month = m ? Number(m[2]) : d.getUTCMonth() + 1;
  const day = m ? Number(m[3]) : d.getUTCDate();
  if (!text.includes(year)) return false;
  const monthName = MONTHS[month - 1];
  const hasMonth = text.includes(monthName) || text.includes(monthName.slice(0, 3)) || new RegExp(`\\b0?${month}[./-]0?${day}\\b|\\b0?${day}[./-]0?${month}\\b`).test(text);
  const hasDay = new RegExp(`\\b0?${day}(?:st|nd|rd|th)?\\b`).test(text);
  return hasMonth && hasDay;
}

function guessType(key, value) {
  if (typeof value === "string") return /^\d{4}-\d{2}-\d{2}/.test(value) ? "date" : "string";
  if (Array.isArray(value) && value.every((v) => typeof v === "string")) return "tags";
  return "other";
}

function wrap(line, width) {
  const words = line.split(" ");
  const lines = [];
  let cur = "";
  for (const w of words) {
    const visible = (s) => s.replace(/\x1b\[[0-9;]*m/g, "").length;
    if (cur && visible(cur) + 1 + visible(w) > width) {
      lines.push(cur);
      cur = w;
    } else cur = cur ? `${cur} ${w}` : w;
  }
  if (cur) lines.push(cur);
  return lines;
}

function painter() {
  const colour = process.stdout.isTTY && !process.env.NO_COLOR;
  return {
    ok: (s) => (colour ? `\x1b[32m${s}\x1b[0m` : s),
    bad: (s) => (colour ? `\x1b[31m${s}\x1b[0m` : s),
  };
}

function out(line) {
  process.stdout.write(line + "\n");
}
