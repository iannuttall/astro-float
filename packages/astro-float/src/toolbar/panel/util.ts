/** Small helpers shared by the panel's views. */
import { ApiError } from "../api";

/** Keep a focused control visible inside a scrolling column when the keyboard comes up. */
export function keepInView(form: HTMLElement) {
  form.addEventListener("focusin", (e) => {
    const target = e.target as HTMLElement;
    window.setTimeout(() => target.scrollIntoView?.({ block: "nearest", behavior: "smooth" }), 60);
  });
}

/**
 * iOS zooms the page when a focused control has text smaller than 16px and
 * doesn't zoom back out on blur. The panel's controls are 16px on touch devices
 * so this shouldn't trigger — but if the page is left zoomed anyway, briefly pin
 * `maximum-scale=1` on the viewport meta to snap it back, then restore the
 * original so user zoom keeps working. No-op on desktop (`scale` is 1).
 */
export function resetViewportZoom() {
  const vv = window.visualViewport;
  if (!vv || vv.scale <= 1.01) return;
  const meta = document.querySelector<HTMLMetaElement>('meta[name="viewport"]');
  if (!meta) return;
  const original = meta.getAttribute("content") ?? "width=device-width, initial-scale=1";
  const pinned = original.replace(/,?\s*maximum-scale=[^,]*/i, "") + ", maximum-scale=1";
  meta.setAttribute("content", pinned);
  window.setTimeout(() => meta.setAttribute("content", original), 350);
}

/** A textarea that grows with its content instead of scrolling. */
export function autosize(ta: HTMLTextAreaElement, minRows = 2) {
  const fit = () => {
    ta.style.height = "auto";
    ta.style.height = `${Math.max(ta.scrollHeight, minRows * 20)}px`;
  };
  ta.addEventListener("input", fit);
  // Not laid out yet when created; measure once it's in the document.
  queueMicrotask(fit);
  requestAnimationFrame(fit);
  return fit;
}

export function slugify(value: string) {
  return value
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export function describe(err: unknown): string {
  if (err instanceof ApiError && err.issues?.length) {
    const first = err.issues[0];
    const where = first.path.join(".");
    return where ? `${where}: ${first.message}` : first.message;
  }
  if (err instanceof Error) return err.message;
  return String(err);
}

export function clone<T>(value: T): T {
  return value === undefined ? value : JSON.parse(JSON.stringify(value));
}

/** "Oct 3, 2026" — the panel's compact date label. */
export function formatDateLabel(iso: string) {
  return new Intl.DateTimeFormat(document.documentElement.lang || navigator.language || "en", { dateStyle: "medium", timeZone: "UTC" }).format(
    new Date(`${iso}T00:00:00Z`),
  );
}

/** Resolve a frontmatter image path to something the dev server can show. */
export function imageUrl(value: string, absDir: string): string {
  if (/^(https?:)?\/\//.test(value) || value.startsWith("data:")) return value;
  if (value.startsWith("/@fs/") || value.startsWith("/_image")) return value;
  if (value.startsWith("/")) return value; // public/
  // Relative to the entry: walk it against the entry's directory.
  const parts = absDir.split("/").filter(Boolean);
  for (const seg of value.replace(/^\.\//, "").split("/")) {
    if (seg === "..") parts.pop();
    else if (seg && seg !== ".") parts.push(seg);
  }
  return `/@fs/${parts.join("/")}`;
}
