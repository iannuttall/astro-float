import { h } from "../dom";

/**
 * Deleting takes two clicks on one button. A quiet "Delete post" (bottom left)
 * turns into a red "Confirm" in exactly its own box, and a second click within
 * five seconds deletes. Five seconds, Esc or a click anywhere else turn it
 * back; hovering or focusing Confirm doesn't add time. Enter only deletes when
 * Confirm has the focus, and neither the second click of a double click nor a
 * held-down key counts as the second click.
 */

/** How long Confirm waits for its click. */
const CONFIRM_FOR = 5000;

/** Buttons showing Confirm; the popover turns them back when it closes. */
const armed = new Set<() => void>();

/** Turn every Confirm back into its "Delete …" (the popover is closing). */
export function cancelConfirms() {
  for (const disarm of Array.from(armed)) disarm();
}

/** The row holding "Delete post" or "Delete collection". `confirm` runs on the second click; when it rejects, the pill has said why and the button turns back. */
export function renderDeleteLine(label: string, confirm: () => Promise<void>): HTMLElement {
  const button = h("button", { class: "text-btn", type: "button" }, label) as HTMLButtonElement;
  let timer: number | undefined;
  let busy = false;

  const disarm = (refocus = false) => {
    if (busy || !armed.has(disarm)) return;
    armed.delete(disarm);
    window.clearTimeout(timer);
    document.removeEventListener("pointerdown", onPointerDown, true);
    button.removeAttribute("data-confirming");
    delete button.dataset.escape;
    button.style.width = "";
    button.textContent = label;
    if (refocus) button.focus({ preventScroll: true });
  };
  const onPointerDown = (e: PointerEvent) => {
    if (!e.composedPath().includes(button)) disarm();
  };

  button.addEventListener("click", async (e) => {
    if (busy) return;
    if (!armed.has(disarm)) {
      // Confirm keeps the box "Delete post" had, to the pixel: nothing moves.
      button.style.width = `${button.getBoundingClientRect().width}px`;
      button.textContent = "Confirm";
      button.setAttribute("data-confirming", "");
      // Escape turns it back and leaves the popover open; Enter on it now deletes.
      button.dataset.escape = "self";
      button.focus({ preventScroll: true });
      armed.add(disarm);
      document.addEventListener("pointerdown", onPointerDown, true);
      timer = window.setTimeout(() => disarm(), CONFIRM_FOR);
      return;
    }
    // The second click of a double click on "Delete post" isn't an answer.
    if (e.detail > 1) return;
    window.clearTimeout(timer);
    busy = true;
    try {
      await confirm();
    } catch {
      /* the pill says why */
    } finally {
      busy = false;
      disarm();
    }
  });
  button.addEventListener("keydown", (e) => {
    if (!armed.has(disarm)) return;
    if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      disarm(true);
    } else if (e.repeat && (e.key === "Enter" || e.key === " ")) {
      // The key that armed it, held down, never confirms.
      e.preventDefault();
    }
  });
  return h("div", { class: "delete-row" }, button);
}

/** Plurals that aren't one: "news" isn't many "new"s. */
const NOT_PLURAL = new Set(["news", "analytics", "physics"]);

/**
 * What one entry of a collection is called, for "Delete post": a blog's is a
 * post; a plain plural loses its "s" (notes → note, blog-posts → blog post);
 * anything less obvious (til, stories, boxes) is an "entry".
 */
export function nounFor(collection: string): string {
  const words = collection.toLowerCase().split(/[-_\s]+/).filter(Boolean);
  const last = words.pop() ?? "";
  if (last === "blog") return "post";
  if (last.length < 4 || NOT_PLURAL.has(last) || /(ss|us|is|ies)$/.test(last)) return "entry";
  if (/[^aeiu]s$/.test(last) || /[^sxzh]es$/.test(last)) return [...words, last.slice(0, -1)].join(" ");
  return "entry";
}
