import { h, replaceChildren } from "../dom";
import { describe } from "./util";

/**
 * Deleting asks once, in place. A quiet text button ("Delete post") turns
 * into one line that names what goes and what that means — `Delete “Hello”?
 * This removes its file.` — with Cancel and a small red Delete. No dialog.
 * Cancel, Esc or a click anywhere else puts the button back. Cancel has the
 * focus when the line opens, so Enter only deletes once Delete itself has it,
 * and the second click of a double click is never taken for an answer.
 */
export interface DeleteQuestion {
  question: string;
  /** Do it. A rejection's reason takes the question's place, and Delete can be tried again. */
  confirm(): Promise<void>;
}

/** Lines waiting for an answer; the popover puts them back when it closes. */
const waiting = new Set<() => void>();

/** Put back every open question (the popover is closing). */
export function cancelConfirms() {
  for (const dismiss of Array.from(waiting)) dismiss();
}

/** The "Delete …" button and the question it turns into. `ask` builds the question on click, from what the thing is called by then. */
export function renderDeleteLine(label: string, ask: () => DeleteQuestion): HTMLElement {
  const slot = h("div", { class: "delete-row" });
  const button = h(
    "button",
    {
      class: "text-btn",
      type: "button",
      onClick: () =>
        replaceChildren(
          slot,
          renderQuestion(ask(), (refocus) => {
            replaceChildren(slot, button);
            if (refocus) button.focus({ preventScroll: true });
          }),
        ),
    },
    label,
  ) as HTMLButtonElement;
  slot.appendChild(button);
  return slot;
}

/** The question line; `restore` puts the button back (and focuses it when the keyboard was in the line). */
function renderQuestion({ question, confirm }: DeleteQuestion, restore: (refocus: boolean) => void): HTMLElement {
  const text = h("span", { class: "confirm-text" }, question);
  const cancel = h("button", { class: "btn btn-sm btn-ghost", type: "button" }, "Cancel") as HTMLButtonElement;
  const remove = h("button", { class: "btn btn-sm btn-danger", type: "button" }, "Delete") as HTMLButtonElement;
  // `data-escape="self"`: Escape in here answers the question and leaves the popover open.
  const line = h("div", { class: "confirm", role: "group", "aria-label": question, "data-escape": "self" }, text, h("span", { class: "confirm-actions" }, cancel, remove));
  let busy = false;

  const settle = () => {
    waiting.delete(dismiss);
    document.removeEventListener("pointerdown", onPointerDown, true);
  };
  const dismiss = (refocus = false) => {
    if (busy || !waiting.has(dismiss)) return;
    settle();
    restore(refocus);
  };
  const onPointerDown = (e: PointerEvent) => {
    if (!line.isConnected) settle();
    else if (!e.composedPath().includes(line)) dismiss();
  };

  cancel.addEventListener("click", () => dismiss(true));
  remove.addEventListener("click", async (e) => {
    if (busy || e.detail > 1) return;
    busy = true;
    cancel.disabled = remove.disabled = true;
    text.textContent = question;
    text.removeAttribute("data-error");
    try {
      await confirm();
      busy = false;
      settle();
      // Nothing moved on (there was nothing to delete): back to the button.
      if (line.isConnected) restore(false);
    } catch (err) {
      busy = false;
      text.textContent = describe(err);
      text.setAttribute("data-error", "");
      cancel.disabled = remove.disabled = false;
      cancel.focus({ preventScroll: true });
    }
  });
  line.addEventListener("keydown", (e) => {
    if (e.key !== "Escape") return;
    e.preventDefault();
    e.stopPropagation();
    dismiss(true);
  });

  waiting.add(dismiss);
  document.addEventListener("pointerdown", onPointerDown, true);
  queueMicrotask(() => cancel.focus({ preventScroll: true }));
  return line;
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
