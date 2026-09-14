import { api, type Collection, type EntryDoc, type MediaItem } from "../api";
import { DatePicker } from "../datepicker";
import { h, replaceChildren } from "../dom";
import { icon } from "../icons";
import { DATE_LIKE, emptyValue, helpFor, inferField, type FieldDef } from "../schema";
import { autosize, describe, formatDateLabel, imageUrl } from "./util";

/**
 * One control per field type. Each returns its element plus `set()`, which
 * paints a value that changed elsewhere (typed on the page, reverted, YAML
 * edited) without firing `onChange` back.
 */
export interface ControlCtx {
  canvas: ShadowRoot;
  doc: EntryDoc;
  collections(): Collection[];
  onChange(value: unknown): void;
  /** A one-line note under the control (kept-last-value, invalid JSON …). */
  note(text: string): void;
}

export interface Control {
  el: HTMLElement;
  set(value: unknown): void;
  /** Short controls sit on the right of the label; the rest take the full width below it. */
  inline: boolean;
}

export function makeControl(def: FieldDef, value: unknown, ctx: ControlCtx): Control {
  const control = buildControl(def, value, ctx);
  // The label is text next to the control, not a <label>: name the control ourselves, and say when it's required.
  const target = control.el.matches("input, textarea, select, button, [role=radiogroup]") ? control.el : control.el.querySelector("input, textarea, select, button");
  if (target && !target.hasAttribute("aria-label")) target.setAttribute("aria-label", def.label);
  if (target && def.required) target.setAttribute("aria-required", "true");
  return control;
}

function buildControl(def: FieldDef, value: unknown, ctx: ControlCtx): Control {
  switch (def.type) {
    case "boolean":
      return booleanControl(value, ctx);
    case "number":
      return numberControl(def, value, ctx);
    case "date":
      return dateControl(value, ctx);
    case "datetime":
      return datetimeControl(value, ctx);
    case "enum":
      return enumControl(def, value, ctx);
    case "tags":
      return tagsControl(value, ctx);
    case "image":
      return imageControl(value, ctx);
    case "object":
      return objectControl(def, value, ctx);
    case "array":
      return arrayControl(def, value, ctx);
    case "reference":
      return referenceControl(def, value, ctx);
    case "json":
      return jsonControl(value, ctx);
    case "text":
      return textControl(def, value, ctx);
    default:
      return stringControl(def, value, ctx);
  }
}

// ---- strings ----------------------------------------------------------------------

function stringControl(def: FieldDef, value: unknown, ctx: ControlCtx): Control {
  const input = h("input", {
    class: "input",
    type: "text",
    value: value == null ? "" : String(value),
    placeholder: def.required ? "Required" : "Not set",
    maxlength: def.max,
  }) as HTMLInputElement;
  input.addEventListener("input", () => ctx.onChange(input.value));
  return {
    el: input,
    inline: false,
    set: (v) => {
      if (ctx.canvas.activeElement === input) return;
      const text = v == null ? "" : String(v);
      if (input.value !== text) input.value = text;
    },
  };
}

function textControl(def: FieldDef, value: unknown, ctx: ControlCtx): Control {
  const ta = h("textarea", { class: "textarea", rows: 2, value: value == null ? "" : String(value), placeholder: def.required ? "Required" : "Not set" }) as HTMLTextAreaElement;
  const fit = autosize(ta);
  ta.addEventListener("input", () => ctx.onChange(ta.value));
  return {
    el: ta,
    inline: false,
    set: (v) => {
      if (ctx.canvas.activeElement === ta) return;
      const text = v == null ? "" : String(v);
      if (ta.value !== text) {
        ta.value = text;
        fit();
      }
    },
  };
}

function jsonControl(value: unknown, ctx: ControlCtx): Control {
  const ta = h("textarea", { class: "textarea mono", rows: 3, value: value === undefined ? "" : JSON.stringify(value, null, 2) }) as HTMLTextAreaElement;
  const fit = autosize(ta);
  ta.addEventListener("input", () => {
    try {
      ctx.onChange(ta.value.trim() === "" ? null : JSON.parse(ta.value));
      delete ta.dataset.invalid;
      ctx.note("");
    } catch {
      ta.dataset.invalid = "";
      ctx.note("Not valid JSON yet — keeping the last valid value.");
    }
  });
  return {
    el: ta,
    inline: false,
    set: (v) => {
      if (ctx.canvas.activeElement === ta) return;
      const text = v === undefined ? "" : JSON.stringify(v, null, 2);
      if (ta.value !== text) {
        ta.value = text;
        delete ta.dataset.invalid;
        fit();
      }
    },
  };
}

// ---- number / boolean ----------------------------------------------------------------

function numberControl(def: FieldDef, value: unknown, ctx: ControlCtx): Control {
  let last: unknown = value;
  const input = h("input", {
    class: "input input-number",
    type: "number",
    step: def.integer ? "1" : "any",
    inputmode: def.integer ? "numeric" : "decimal",
    min: def.min,
    max: def.max,
    value: typeof value === "number" ? String(value) : "",
    placeholder: "—",
  }) as HTMLInputElement;
  const keeping = () => (typeof last === "number" ? ` — keeping ${String(last)}.` : " — not written yet.");
  const problem = (n: number): string | null => {
    if (def.integer && !Number.isInteger(n)) return "Whole numbers only";
    if (def.min != null && n < def.min) return `At least ${def.min}`;
    if (def.max != null && n > def.max) return `At most ${def.max}`;
    return null;
  };
  input.addEventListener("input", () => {
    if (input.value === "") {
      if (typeof last === "number") {
        input.dataset.invalid = "";
        ctx.note(`Empty${keeping()}`);
      }
      return;
    }
    const n = Number(input.value);
    if (Number.isNaN(n)) return;
    const why = problem(n);
    if (why) {
      input.dataset.invalid = "";
      ctx.note(why + keeping());
      return;
    }
    delete input.dataset.invalid;
    ctx.note("");
    last = n;
    ctx.onChange(n);
  });
  return {
    el: input,
    inline: true,
    set: (v) => {
      last = v;
      if (ctx.canvas.activeElement === input) return;
      const text = typeof v === "number" ? String(v) : "";
      if (input.value !== text) input.value = text;
      delete input.dataset.invalid;
    },
  };
}

function booleanControl(value: unknown, ctx: ControlCtx): Control {
  const row = h(
    "button",
    {
      class: "toggle",
      type: "button",
      role: "switch",
      "aria-checked": String(Boolean(value)),
      onClick: () => {
        const next = row.getAttribute("aria-checked") !== "true";
        row.setAttribute("aria-checked", String(next));
        ctx.onChange(next);
      },
    },
    h("span", { class: "switch" }),
  );
  return { el: row, inline: true, set: (v) => row.setAttribute("aria-checked", String(Boolean(v))) };
}

// ---- dates ----------------------------------------------------------------------------

/** A button that opens the shared calendar; the stored shape is kept (date part swapped, any suffix preserved). */
function dateControl(value: unknown, ctx: ControlCtx): Control {
  let suffix = typeof value === "string" && DATE_LIKE.test(value) ? value.slice(10) : "";
  const label = h("span", { class: "date-label" });
  const button = h("button", { class: "input date-btn", type: "button", "aria-haspopup": "dialog", "data-tip": "Change the date" }, label, icon("calendar", 14)) as HTMLButtonElement;
  const paint = (v: unknown) => {
    const iso = typeof v === "string" && DATE_LIKE.test(v) ? v.slice(0, 10) : "";
    label.textContent = iso ? formatDateLabel(iso) : "Pick a date";
    button.dataset.iso = iso;
  };
  paint(value);
  button.addEventListener("click", (e) => {
    e.preventDefault();
    DatePicker.toggle({
      anchor: button,
      value: button.dataset.iso || null,
      onPick: (iso) => {
        const next = iso + suffix;
        paint(next);
        ctx.onChange(next);
      },
    });
  });
  return {
    el: button,
    inline: true,
    set: (v) => {
      if (typeof v === "string" && DATE_LIKE.test(v)) suffix = v.slice(10);
      paint(v);
    },
  };
}

/** Calendar for the day, a time input for the clock; the separator and zone of the stored value are kept. */
function datetimeControl(value: unknown, ctx: ControlCtx): Control {
  const parse = (v: unknown) => {
    const s = typeof v === "string" && DATE_LIKE.test(v) ? v : "";
    const m = s.match(/^(\d{4}-\d{2}-\d{2})(?:([T ])(\d{2}):(\d{2})(?::(\d{2}(?:\.\d+)?))?(.*))?$/);
    if (!m) return { date: "", sep: "T", time: "", seconds: "00", zone: "Z" };
    return { date: m[1], sep: m[2] ?? "T", time: m[3] ? `${m[3]}:${m[4]}` : "", seconds: m[5] ?? "00", zone: m[6] ?? "" };
  };
  let parts = parse(value);
  const compose = () => (parts.date ? `${parts.date}${parts.sep}${parts.time || "00:00"}:${parts.seconds}${parts.zone}` : "");

  const label = h("span", { class: "date-label" });
  const button = h("button", { class: "input date-btn", type: "button", "aria-haspopup": "dialog", "data-tip": "Change the date" }, label, icon("calendar", 14)) as HTMLButtonElement;
  const time = h("input", { class: "input input-time", type: "time", value: parts.time, "aria-label": "Time" }) as HTMLInputElement;
  const paint = () => {
    label.textContent = parts.date ? formatDateLabel(parts.date) : "Pick a date";
    button.dataset.iso = parts.date;
    if (ctx.canvas.activeElement !== time && time.value !== parts.time) time.value = parts.time;
  };
  paint();
  button.addEventListener("click", (e) => {
    e.preventDefault();
    DatePicker.toggle({
      anchor: button,
      value: parts.date || null,
      onPick: (iso) => {
        parts.date = iso;
        paint();
        ctx.onChange(compose());
      },
    });
  });
  time.addEventListener("input", () => {
    if (!time.value) return;
    parts.time = time.value;
    if (!parts.date) parts.date = new Date().toISOString().slice(0, 10);
    paint();
    ctx.onChange(compose());
  });
  return {
    el: h("div", { class: "datetime" }, button, time),
    inline: false,
    set: (v) => {
      parts = parse(v);
      paint();
    },
  };
}

// ---- enum / reference ----------------------------------------------------------------

function enumControl(def: FieldDef, value: unknown, ctx: ControlCtx): Control {
  const options = [...(def.options ?? [])];
  const current = value == null ? "" : String(value);
  if (current && !options.includes(current)) options.push(current);

  const select = selectControl(
    [...(def.required ? [] : [{ value: "", label: "—" }]), ...options.map((o) => ({ value: o, label: o }))],
    current,
    (v) => ctx.onChange(v === "" ? undefined : v),
  );
  if (options.length > 4) return select;

  // Up to four options: a segmented control — but only while every label fits without truncating
  // at the panel's current width; otherwise the select (which has the "—" none option too).
  const choices: Array<{ value: string | undefined; label: string }> = [...(def.required ? [] : [{ value: undefined, label: "—" }]), ...options.map((o) => ({ value: o, label: o }))];
  const buttons = choices.map((c) =>
    h(
      "button",
      {
        class: "seg-btn",
        type: "button",
        role: "radio",
        "aria-checked": String((c.value ?? "") === current),
        "aria-label": c.value === undefined ? "None" : undefined,
        "data-tip": c.value === undefined ? "None" : undefined,
        "data-value": c.value ?? "",
        "data-none": c.value === undefined ? "" : null,
        onClick: () => {
          paint(c.value);
          ctx.onChange(c.value);
        },
      },
      c.label,
    ),
  );
  const paint = (v: unknown) => {
    const want = v == null ? "" : String(v);
    for (const b of buttons) b.setAttribute("aria-checked", String((b.dataset.value ?? "") === want));
    select.set(v);
  };
  const segmented = h("div", { class: "segmented", role: "radiogroup" }, buttons);
  const wrap = h("div", { class: "enum" }, segmented);

  // Segments share the row equally, so the widest label decides: it must fit in its share
  // (room minus the frame and gaps, divided by the number of segments) with the button padding.
  const layout = () => {
    const room = wrap.clientWidth;
    if (!room) return; // not laid out yet; the observer calls again
    const font = getComputedStyle(buttons[0]).font || "500 12px system-ui";
    const widest = Math.max(...choices.map((c) => textWidth(c.label, font)));
    const share = (room - 6 - (choices.length - 1) * 2) / choices.length;
    const want = widest + 20 <= share ? segmented : select.el;
    if (wrap.firstElementChild !== want) replaceChildren(wrap, want);
  };
  new ResizeObserver(layout).observe(wrap);
  queueMicrotask(layout);

  return { el: wrap, inline: false, set: paint };
}

function referenceControl(def: FieldDef, value: unknown, ctx: ControlCtx): Control {
  const target = ctx.collections().find((c) => c.name === def.collection);
  const entries = target?.entries ?? [];
  const current = value == null ? "" : typeof value === "object" && value && "id" in value ? String((value as { id: unknown }).id) : String(value);
  const options = [...(def.required ? [] : [{ value: "", label: "—" }]), ...entries.map((e) => ({ value: e.id, label: e.title, title: e.id }))];
  if (current && !entries.some((e) => e.id === current)) options.push({ value: current, label: `${current} (missing)`, title: current });
  const select = selectControl(options, current, (v) => ctx.onChange(v === "" ? undefined : v));
  if (!target) ctx.note(def.collection ? `No collection "${def.collection}" found.` : "");
  return select;
}

function selectControl(options: Array<{ value: string; label: string; title?: string }>, current: string, onChange: (v: string) => void): Control {
  const select = h(
    "select",
    { class: "input select", onChange: () => onChange(select.value) },
    options.map((o) => h("option", { value: o.value, selected: o.value === current, title: o.title }, o.label)),
  ) as HTMLSelectElement;
  const tipFor = (v: string) => options.find((o) => o.value === v)?.title ?? "";
  if (tipFor(current)) select.setAttribute("data-tip", tipFor(current));
  select.addEventListener("change", () => (tipFor(select.value) ? select.setAttribute("data-tip", tipFor(select.value)) : select.removeAttribute("data-tip")));
  return {
    el: select,
    inline: true,
    set: (v) => {
      const next = v == null ? "" : String(v);
      if (select.value !== next && Array.from(select.options).some((o) => o.value === next)) select.value = next;
    },
  };
}

// ---- tags ------------------------------------------------------------------------------

/** Chips plus a text input: Enter or comma adds, Backspace on an empty input removes the last chip. */
function tagsControl(value: unknown, ctx: ControlCtx): Control {
  let items: Array<string | number> = Array.isArray(value) ? (value.filter((v) => typeof v === "string" || typeof v === "number") as Array<string | number>) : [];
  const numeric = items.length > 0 && items.every((v) => typeof v === "number");
  const list = h("div", { class: "chips-list" });
  const input = h("input", { class: "chips-input", placeholder: items.length ? "" : "Add…", "aria-label": "Add a tag" }) as HTMLInputElement;
  const box = h("div", { class: "chips", onClick: (e: MouseEvent) => { if (e.target === box || e.target === list) input.focus(); } }, list, input);

  const commit = () => ctx.onChange(items.slice());
  const paint = () => {
    replaceChildren(
      list,
      items.map((item, i) =>
        h(
          "span",
          { class: "chip" },
          h("span", { class: "chip-text" }, String(item)),
          h(
            "button",
            {
              class: "chip-x",
              type: "button",
              "aria-label": `Remove ${String(item)}`,
              onClick: () => {
                items.splice(i, 1);
                paint();
                commit();
              },
            },
            icon("close", 10),
          ),
        ),
      ),
    );
    input.placeholder = items.length ? "" : "Add…";
  };
  const add = () => {
    const raw = input.value.split(",").map((s) => s.trim()).filter(Boolean);
    if (!raw.length) return;
    for (const r of raw) {
      const v: string | number = numeric && !Number.isNaN(Number(r)) ? Number(r) : r;
      if (!items.includes(v)) items.push(v);
    }
    input.value = "";
    paint();
    commit();
  };
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter" || e.key === ",") {
      e.preventDefault();
      add();
    } else if (e.key === "Backspace" && input.value === "" && items.length) {
      e.preventDefault();
      items.pop();
      paint();
      commit();
    }
  });
  input.addEventListener("blur", add);
  input.addEventListener("input", () => {
    if (input.value.includes(",")) add();
  });
  paint();
  return {
    el: box,
    inline: false,
    set: (v) => {
      items = Array.isArray(v) ? (v.filter((x) => typeof x === "string" || typeof x === "number") as Array<string | number>) : [];
      paint();
    },
  };
}

// ---- image ------------------------------------------------------------------------------

/** Thumbnail + path, Upload (copies the file next to the entry) and Choose (existing media next to the entry). */
function imageControl(value: unknown, ctx: ControlCtx): Control {
  let current = typeof value === "string" ? value : "";
  const thumb = h("div", { class: "image-thumb" });
  const path = h("div", { class: "image-path mono" });
  const picker = h("div", { class: "image-picker", hidden: true });
  const file = h("input", { type: "file", accept: "image/*", hidden: true }) as HTMLInputElement;

  const paint = () => {
    replaceChildren(thumb, current ? h("img", { src: imageUrl(current, ctx.doc.absDir), alt: "" }) : icon("image", 16));
    path.textContent = current || "No image";
    clear.hidden = !current;
  };
  const choose = (src: string | undefined) => {
    current = src ?? "";
    picker.hidden = true;
    paint();
    ctx.onChange(src);
  };

  file.addEventListener("change", async () => {
    const f = file.files?.[0];
    file.value = "";
    if (!f) return;
    upload.disabled = true;
    ctx.note("Uploading…");
    try {
      const saved = await api.upload(ctx.doc.collection, ctx.doc.id, f);
      ctx.note("");
      choose(saved.src);
    } catch (err) {
      ctx.note(describe(err));
    } finally {
      upload.disabled = false;
    }
  });

  const openPicker = async () => {
    if (!picker.hidden) {
      picker.hidden = true;
      return;
    }
    replaceChildren(picker, h("span", { class: "muted" }, "Loading…"));
    picker.hidden = false;
    let media: MediaItem[] = [];
    try {
      media = await api.media(ctx.doc.collection, ctx.doc.id);
    } catch (err) {
      replaceChildren(picker, h("span", { class: "muted" }, describe(err)));
      return;
    }
    if (!media.length) {
      replaceChildren(picker, h("span", { class: "muted" }, "No images next to this entry yet. Upload one, or drop it on the page."));
      return;
    }
    replaceChildren(
      picker,
      media.map((m) =>
        h(
          "button",
          { class: "image-option", type: "button", "data-tip": m.name, "aria-pressed": String(m.src === current), onClick: () => choose(m.src) },
          h("img", { src: m.url, alt: "" }),
          h("span", null, m.name),
        ),
      ),
    );
  };

  const upload = h("button", { class: "btn btn-sm", type: "button", onClick: () => file.click() }, icon("upload", 13), "Upload") as HTMLButtonElement;
  const pick = h("button", { class: "btn btn-sm", type: "button", onClick: () => void openPicker() }, icon("image", 13), "Choose");
  const clear = h("button", { class: "btn btn-sm btn-ghost", type: "button", "data-tip": "Clear", "aria-label": "Clear image", onClick: () => choose(undefined) }, icon("close", 12)) as HTMLButtonElement;
  paint();

  return {
    el: h("div", { class: "image-field" }, h("div", { class: "image-row" }, thumb, h("div", { class: "image-meta" }, path, h("div", { class: "image-actions" }, upload, pick, clear))), picker, file),
    inline: false,
    set: (v) => {
      current = typeof v === "string" ? v : "";
      paint();
    },
  };
}

// ---- object / array ---------------------------------------------------------------------

/** Nested group: one row per sub-field, indented, sharing the parent's change callback. */
function objectControl(def: FieldDef, value: unknown, ctx: ControlCtx): Control {
  let obj: Record<string, unknown> = value && typeof value === "object" && !Array.isArray(value) ? { ...(value as Record<string, unknown>) } : {};
  const defs = [...(def.fields ?? [])];
  for (const key of Object.keys(obj)) if (!defs.some((d) => d.key === key)) defs.push(inferField(key, obj[key]));
  const controls = new Map<string, Control>();
  const group = h("div", { class: "group" });
  for (const sub of defs) {
    const row = nestedRow(sub, obj[sub.key], {
      ...ctx,
      onChange: (v) => {
        if (v === undefined) delete obj[sub.key];
        else obj[sub.key] = v;
        ctx.onChange({ ...obj });
      },
    });
    controls.set(sub.key, row.control);
    group.appendChild(row.el);
  }
  if (!defs.length) group.appendChild(h("span", { class: "muted" }, "Empty"));
  return {
    el: group,
    inline: false,
    set: (v) => {
      obj = v && typeof v === "object" && !Array.isArray(v) ? { ...(v as Record<string, unknown>) } : {};
      for (const [key, c] of controls) c.set(obj[key]);
    },
  };
}

/** A list of items with add / remove / move; each item is the item type's own control. */
function arrayControl(def: FieldDef, value: unknown, ctx: ControlCtx): Control {
  let items: unknown[] = Array.isArray(value) ? [...value] : [];
  const item = def.item ?? inferField("item", items[0]);
  const list = h("div", { class: "items" });
  const commit = () => ctx.onChange(items.slice());
  const paint = () => {
    replaceChildren(
      list,
      items.map((v, i) => {
        const control = makeControl(item, v, {
          ...ctx,
          onChange: (next) => {
            items[i] = next;
            commit();
          },
        });
        return h(
          "div",
          { class: "item" },
          h("div", { class: "item-body" }, control.el),
          h(
            "div",
            { class: "item-tools" },
            h("button", { class: "icon-btn", type: "button", "aria-label": "Move up", disabled: i === 0, onClick: () => { move(i, -1); } }, icon("arrowUp", 13)),
            h("button", { class: "icon-btn", type: "button", "aria-label": "Move down", disabled: i === items.length - 1, onClick: () => { move(i, 1); } }, icon("arrowDown", 13)),
            h("button", { class: "icon-btn icon-btn-danger", type: "button", "aria-label": "Remove", onClick: () => { items.splice(i, 1); paint(); commit(); } }, icon("close", 13)),
          ),
        );
      }),
    );
  };
  const move = (i: number, by: number) => {
    const j = i + by;
    if (j < 0 || j >= items.length) return;
    [items[i], items[j]] = [items[j], items[i]];
    paint();
    commit();
  };
  paint();
  const add = h(
    "button",
    { class: "btn btn-sm btn-ghost add-item", type: "button", onClick: () => { items.push(emptyValue(item)); paint(); commit(); } },
    icon("plus", 13),
    `Add ${item.label.toLowerCase() === "item" ? "item" : item.label.toLowerCase()}`,
  );
  return {
    el: h("div", { class: "array" }, list, add),
    inline: false,
    set: (v) => {
      items = Array.isArray(v) ? [...v] : [];
      paint();
    },
  };
}

let measurer: CanvasRenderingContext2D | null = null;
/** Width of a label in the given CSS font, for deciding whether it fits without truncating. */
function textWidth(text: string, font: string): number {
  measurer ??= document.createElement("canvas").getContext("2d");
  if (!measurer) return text.length * 8;
  measurer.font = font;
  return measurer.measureText(text).width;
}

/** A label + help + control row for a nested field (no revert / remove / on-page: those belong to the top level). */
export function nestedRow(def: FieldDef, value: unknown, ctx: ControlCtx): { el: HTMLElement; control: Control } {
  const note = h("div", { class: "row-note" });
  const control = makeControl(def, value, { ...ctx, note: (t) => (note.textContent = t) });
  const el = h(
    "div",
    { class: "row row-nested", "data-type": def.type, "data-inline": control.inline ? "" : null },
    h(
      "div",
      { class: "row-head" },
      h("div", { class: "row-text" }, h("span", { class: "row-label" }, h("span", { class: "row-name" }, def.label), def.required ? h("span", { class: "req", "aria-hidden": "true" }, "*") : null), h("span", { class: "row-help" }, helpFor(def))),
      control.inline ? h("div", { class: "row-side" }, control.el) : null,
    ),
    control.inline ? null : control.el,
    note,
  );
  return { el, control };
}
