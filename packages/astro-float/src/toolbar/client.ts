import { mountFloat } from "./float";

export const HOST_ATTR = "data-astro-float-host";

function mount() {
  if (document.querySelector(`[${HOST_ATTR}]`)) return;
  const host = document.createElement("div");
  host.setAttribute(HOST_ATTR, "");
  // `all: initial` keeps page CSS from leaking in; the shadow root does the rest.
  host.style.cssText = "all:initial;position:absolute;top:0;left:0;z-index:2000000000;";
  document.body.appendChild(host);
  mountFloat(host.attachShadow({ mode: "open" }));
}

if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", mount, { once: true });
else mount();
