export type Child = Node | string | number | null | undefined | false | Child[];

type Props = Record<string, unknown> | null | undefined;

const PROPERTY_KEYS = new Set([
  "value",
  "checked",
  "disabled",
  "selected",
  "readOnly",
  "spellcheck",
  "textContent",
  "innerHTML",
  "className",
]);

/** Tiny hyperscript. Handlers go in as `onClick`, dataset as `dataset`, everything else is an attribute. */
export function h<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  props?: Props,
  ...children: Child[]
): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  if (props) {
    for (const [key, value] of Object.entries(props)) {
      if (value == null) continue;
      if (value === false) {
        // `spellcheck: false` and friends must be written; a missing boolean attribute is simply omitted.
        if (PROPERTY_KEYS.has(key)) (el as unknown as Record<string, unknown>)[key] = value;
        continue;
      }
      if (key === "class") el.className = String(value);
      else if (key === "dataset") Object.assign(el.dataset, value as Record<string, string>);
      else if (key === "style" && typeof value === "object") Object.assign(el.style, value);
      else if (key.startsWith("on") && typeof value === "function") {
        el.addEventListener(key.slice(2).toLowerCase(), value as EventListener);
      } else if (PROPERTY_KEYS.has(key)) (el as unknown as Record<string, unknown>)[key] = value;
      else el.setAttribute(key, value === true ? "" : String(value));
    }
  }
  append(el, children);
  return el;
}

export function append(parent: Node, children: Child[]) {
  for (const child of children) {
    if (child == null || child === false) continue;
    if (Array.isArray(child)) append(parent, child);
    else if (child instanceof Node) parent.appendChild(child);
    else parent.appendChild(document.createTextNode(String(child)));
  }
}

export function replaceChildren(parent: Element, ...children: Child[]) {
  parent.textContent = "";
  append(parent, children);
}

export function svg(markup: string): SVGElement {
  const tpl = document.createElement("template");
  tpl.innerHTML = markup.trim();
  return tpl.content.firstElementChild as SVGElement;
}
