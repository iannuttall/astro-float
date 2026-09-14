/**
 * One tooltip for everything Float draws — the corner control, the pill, the
 * popover's icon buttons, the "+" chip on the page. Attach it to a root
 * (the document, or the toolbar app's shadow root) and any element with a
 * `data-tip` attribute gets it: 300ms after the pointer settles or the element
 * takes keyboard focus, a small dark label appears 6px above the trigger
 * (below when there's no room), never clipped by the viewport, never in the
 * way of the pointer. Styled by the page stylesheet (`.astro-float-tip`).
 */
const DELAY = 300;
const GAP = 6;

let tip: HTMLElement | null = null;
let current: Element | null = null;
let timer: number | undefined;
const roots = new Set<Document | ShadowRoot>();

export function attachTooltips(root: Document | ShadowRoot) {
  if (roots.has(root)) return;
  roots.add(root);
  root.addEventListener("pointerover", onPointerOver);
  root.addEventListener("pointerout", onPointerOut);
  root.addEventListener("focusin", onFocusIn);
  root.addEventListener("focusout", onFocusOut);
  root.addEventListener("pointerdown", hideTooltip, true);
  root.addEventListener("keydown", onKeydown, true);
  if (roots.size === 1) {
    window.addEventListener("scroll", hideTooltip, true);
    window.addEventListener("resize", hideTooltip);
  }
}

export function detachTooltips(root: Document | ShadowRoot) {
  if (!roots.delete(root)) return;
  root.removeEventListener("pointerover", onPointerOver);
  root.removeEventListener("pointerout", onPointerOut);
  root.removeEventListener("focusin", onFocusIn);
  root.removeEventListener("focusout", onFocusOut);
  root.removeEventListener("pointerdown", hideTooltip, true);
  root.removeEventListener("keydown", onKeydown, true);
  if (roots.size === 0) {
    window.removeEventListener("scroll", hideTooltip, true);
    window.removeEventListener("resize", hideTooltip);
    hideTooltip();
    tip?.remove();
    tip = null;
  }
}

/** The trigger's text changed (a copy button now says "Copied"): redraw if it's the one showing. */
export function refreshTooltip(el?: Element) {
  if (!current || (el && el !== current)) return;
  if (!tip || !tip.hasAttribute("data-show")) return;
  show(current);
}

/** Show `el`'s tip now, without waiting for the pointer to settle: its text just changed because of a click. */
export function showTooltip(el: Element) {
  window.clearTimeout(timer);
  timer = undefined;
  current = el;
  show(el);
}

export function hideTooltip() {
  window.clearTimeout(timer);
  timer = undefined;
  current = null;
  tip?.removeAttribute("data-show");
}

function triggerOf(target: EventTarget | null): Element | null {
  return target instanceof Element ? target.closest("[data-tip]") : null;
}

function onPointerOver(e: Event) {
  const el = triggerOf(e.target);
  if (!el) return;
  if (el === current) return;
  schedule(el);
}

function onPointerOut(e: Event) {
  const el = triggerOf(e.target);
  if (!el) return;
  const to = (e as PointerEvent).relatedTarget;
  if (to instanceof Node && el.contains(to)) return; // still inside the trigger
  if (el === current || timer !== undefined) hideTooltip();
}

function onFocusIn(e: Event) {
  const el = triggerOf(e.target);
  if (!el || !el.matches(":focus-visible")) return; // keyboard focus only; a click shows nothing extra
  schedule(el);
}

function onFocusOut(e: Event) {
  const el = triggerOf(e.target);
  if (el && el === current) hideTooltip();
}

function onKeydown(e: Event) {
  if ((e as KeyboardEvent).key === "Escape") hideTooltip();
}

function schedule(el: Element) {
  window.clearTimeout(timer);
  current = el;
  timer = window.setTimeout(() => {
    timer = undefined;
    if (current === el && el.isConnected) show(el);
  }, DELAY);
}

function show(el: Element) {
  const text = el.getAttribute("data-tip");
  if (!text) return;
  if (!tip) {
    tip = document.createElement("div");
    tip.className = "astro-float-tip";
    tip.setAttribute("role", "tooltip");
  }
  if (!tip.isConnected) document.body.appendChild(tip);
  tip.textContent = text;
  tip.removeAttribute("data-below");
  // Measure from the top-left corner (a previous spot near the right edge would make the text wrap),
  // then place: above the trigger, centred; below when the top is off-screen; always inside the viewport.
  tip.style.left = "0px";
  tip.style.top = "0px";
  const r = el.getBoundingClientRect();
  const w = tip.offsetWidth;
  const hgt = tip.offsetHeight;
  let top = r.top - hgt - GAP;
  if (top < 4) {
    top = r.bottom + GAP;
    tip.setAttribute("data-below", "");
  }
  const left = Math.max(4, Math.min(r.left + r.width / 2 - w / 2, window.innerWidth - w - 4));
  tip.style.left = `${Math.round(left)}px`;
  tip.style.top = `${Math.round(top)}px`;
  tip.setAttribute("data-show", "");
}
