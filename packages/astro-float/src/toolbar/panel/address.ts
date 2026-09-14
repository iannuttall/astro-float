import { ApiError, type EntryDoc } from "../api";
import { slugError } from "../../shared/slug.js";
import { h, replaceChildren } from "../dom";
import { icon } from "../icons";
import { hideTooltip, refreshTooltip, showTooltip } from "../tooltip";
import { describe } from "./util";

/**
 * The Address row at the top of the popover: "Address", and the entry's id in
 * quiet monospace. Nothing around it moves while it changes: the id turns into
 * an input with the same box and font, text selected. Enter applies — the file
 * or folder moves and the page follows — and Esc or leaving the input puts the
 * id back. A post saved as a draft edits on click. A published one (draft
 * false or absent) sits behind a small padlock: "Change address", then "Are
 * you sure? Old links will break", and a second click within a few seconds
 * opens it; Esc, leaving it or a finished rename lock it again. A taken or bad
 * address turns the input's hairline red and says why in its tooltip.
 */
export interface AddressHost {
  doc(): EntryDoc | null;
  /** Move the entry to its new address and navigate there; rejects with the reason when it can't. */
  rename(slug: string): Promise<void>;
}

export interface AddressRow {
  el: HTMLElement;
  /** Draw it again from the saved entry (a save may have made it a draft, or published it); not while it's being changed. */
  refresh(): void;
}

const ASK = "Change address";
const SURE = "Are you sure? Old links will break";
/** How long the padlock waits for its second click. */
const ARMED_FOR = 4000;

export function renderAddressRow(host: AddressHost): AddressRow | null {
  if (!host.doc()) return null;
  const side = h("div", { class: "row-side" });
  const el = h(
    "div",
    { class: "row address-row", "data-inline": "", "data-key": "address" },
    h("div", { class: "row-head" }, h("div", { class: "row-text" }, h("span", { class: "row-label" }, h("span", { class: "row-name" }, "Address"))), side),
  );
  let editing = false;
  /** Set while the padlock waits for its second click. */
  let disarm: (() => void) | null = null;

  const show = () => {
    const doc = host.doc();
    if (!doc) return;
    editing = false;
    disarm?.();
    const segments = doc.id.split("/");
    const last = segments[segments.length - 1];
    const prefix = segments.length > 1 ? h("span", { class: "mono address-prefix" }, `${segments.slice(0, -1).join("/")}/`) : null;
    if (typeof doc.frontmatter.slug === "string") {
      // A frontmatter `slug` names the entry, not the file: the file could move, the address wouldn't.
      replaceChildren(side, prefix, h("span", { class: "mono address", "data-tip": "Set by the slug field" }, last));
    } else if (doc.frontmatter.draft === true) {
      const text: HTMLButtonElement = h("button", { class: "mono address", type: "button", "data-tip": ASK, onClick: () => edit(text, null) }, last);
      replaceChildren(side, prefix, text);
    } else {
      const text = h("span", { class: "mono address" }, last);
      const lock: HTMLButtonElement = h(
        "button",
        {
          class: "address-lock",
          type: "button",
          "aria-label": ASK,
          "data-tip": ASK,
          onClick: () => {
            if (!disarm) return arm(lock);
            disarm();
            edit(text, lock);
          },
        },
        icon("lock", 14),
      );
      replaceChildren(side, prefix, text, lock);
    }
  };

  /** First click on the padlock: it asks, in its own tooltip, and waits a moment for the second. Esc or a click anywhere else stops it asking. */
  const arm = (lock: HTMLButtonElement) => {
    const say = (tip: string) => {
      lock.setAttribute("data-tip", tip);
      lock.setAttribute("aria-label", tip);
    };
    const timer = window.setTimeout(() => disarm?.(), ARMED_FOR);
    const onPointerDown = (e: PointerEvent) => {
      if (!e.composedPath().includes(lock)) disarm?.();
    };
    const onKeydown = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.preventDefault();
      e.stopPropagation();
      disarm?.();
    };
    disarm = () => {
      disarm = null;
      window.clearTimeout(timer);
      document.removeEventListener("pointerdown", onPointerDown, true);
      lock.removeEventListener("keydown", onKeydown);
      delete lock.dataset.escape;
      say(ASK);
      refreshTooltip(lock);
    };
    document.addEventListener("pointerdown", onPointerDown, true);
    lock.addEventListener("keydown", onKeydown);
    // Escape answers the padlock, not the popover.
    lock.dataset.escape = "self";
    say(SURE);
    showTooltip(lock);
  };

  /** The id becomes an input in its own box; a published post's padlock shows open meanwhile. */
  const edit = (text: HTMLElement, lock: HTMLButtonElement | null) => {
    const doc = host.doc();
    if (!doc || editing) return;
    editing = true;
    const original = doc.id.split("/").pop() ?? "";
    const input = h("input", {
      class: "mono address address-input",
      value: original,
      spellcheck: false,
      autocapitalize: "off",
      autocomplete: "off",
      "aria-label": "Address",
      // The popover closes on Escape; here Escape means "put the address back" and no more.
      "data-escape": "self",
    });
    // The box of the text it stands in for, then as wide as what's typed.
    input.style.width = `${text.getBoundingClientRect().width}px`;
    const mirror = h("span", { class: "mono address address-mirror", "aria-hidden": "true" });
    const fit = () => {
      mirror.textContent = input.value;
      input.style.width = `${mirror.getBoundingClientRect().width}px`;
    };
    /** A red hairline and the reason in the input's tooltip, or neither. */
    const say = (problem: string | null) => {
      input.toggleAttribute("data-invalid", !!problem);
      if (problem) {
        input.setAttribute("data-tip", problem);
        showTooltip(input);
      } else if (input.hasAttribute("data-tip")) {
        input.removeAttribute("data-tip");
        hideTooltip();
      }
    };

    let busy = false;
    const cancel = () => {
      if (editing && !busy) show();
    };
    const apply = async () => {
      if (busy) return;
      const slug = input.value;
      if (slug === original) return cancel();
      const problem = slugError(slug);
      if (problem) return say(problem);
      busy = true;
      // Read-only, not disabled: a disabled input drops the focus, and leaving the input cancels.
      input.readOnly = true;
      try {
        await host.rename(slug);
      } catch (err) {
        busy = false;
        input.readOnly = false;
        input.focus();
        // A 409 is a taken address, unless the file changed on disk since it was loaded.
        say(err instanceof ApiError && err.status === 409 && !/changed on disk/.test(err.message) ? "Already used" : describe(err));
        return;
      }
      busy = false;
      // The page moved and the popover was drawn again; if it wasn't, show the address as it is now.
      if (el.isConnected) show();
    };

    input.addEventListener("input", () => {
      // Typed as it will be written: lowercase, spaces to dashes, nothing else.
      const clean = input.value.toLowerCase().replace(/\s+/g, "-").replace(/[^a-z0-9-]/g, "");
      if (clean !== input.value) input.value = clean;
      say(null);
      fit();
    });
    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        void apply();
      } else if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        cancel();
      }
    });
    input.addEventListener("blur", () => window.setTimeout(cancel, 0));

    if (lock) {
      replaceChildren(lock, icon("unlock", 14));
      lock.setAttribute("data-tip", "Lock again");
      lock.setAttribute("aria-label", "Lock again");
    }
    text.replaceWith(input);
    side.appendChild(mirror);
    input.focus({ preventScroll: true });
    input.select();
  };

  show();
  return {
    el,
    refresh: () => {
      if (!editing && !disarm) show();
    },
  };
}
