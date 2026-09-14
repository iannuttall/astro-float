import { svg } from "./dom";

/**
 * One icon set for everything Float draws — panel, selection bubble, island
 * bar. Lucide (ISC) paths on a 24px grid, 1.75 stroke, round
 * caps and joins, rendered at 14–16px. Nothing else gets to draw an icon.
 */
const PATHS = {
  // sidebar
  plus: `<path d="M5 12h14"/><path d="M12 5v14"/>`,
  close: `<path d="M18 6 6 18"/><path d="m6 6 12 12"/>`,
  check: `<path d="M20 6 9 17l-5-5"/>`,
  chevron: `<path d="m9 18 6-6-6-6"/>`,
  chevronLeft: `<path d="m15 18-6-6 6-6"/>`,
  calendar: `<path d="M8 2v4"/><path d="M16 2v4"/><rect width="18" height="18" x="3" y="4" rx="2"/><path d="M3 10h18"/>`,
  folderPlus: `<path d="M12 10v6"/><path d="M9 13h6"/><path d="M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z"/>`,
  panelClose: `<rect width="18" height="18" x="3" y="3" rx="2"/><path d="M15 3v18"/><path d="m8 9 3 3-3 3"/>`,
  panelOpen: `<rect width="18" height="18" x="3" y="3" rx="2"/><path d="M15 3v18"/><path d="m10 15-3-3 3-3"/>`,
  undo: `<path d="M9 14 4 9l5-5"/><path d="M4 9h10.5a5.5 5.5 0 0 1 5.5 5.5a5.5 5.5 0 0 1-5.5 5.5H11"/>`,
  lock: `<rect width="18" height="11" x="3" y="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/>`,
  unlock: `<rect width="18" height="11" x="3" y="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 9.9-1"/>`,
  chevronDown: `<path d="m6 9 6 6 6-6"/>`,
  image: `<rect width="18" height="18" x="3" y="3" rx="2" ry="2"/><circle cx="9" cy="9" r="2"/><path d="m21 15-3.086-3.086a2 2 0 0 0-2.828 0L6 21"/>`,
  upload: `<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" x2="12" y1="3" y2="15"/>`,
  // panel + bubble
  copy: `<rect width="14" height="14" x="8" y="8" rx="2" ry="2"/><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/>`,
  code: `<path d="m16 18 6-6-6-6"/><path d="m8 6-6 6 6 6"/>`,
  eye: `<path d="M2.062 12.348a1 1 0 0 1 0-.696 10.75 10.75 0 0 1 19.876 0 1 1 0 0 1 0 .696 10.75 10.75 0 0 1-19.876 0"/><circle cx="12" cy="12" r="3"/>`,
  bold: `<path d="M6 12h9a4 4 0 0 1 0 8H7a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1h7a4 4 0 0 1 0 8"/>`,
  // Heading glyphs drawn on the same box as bold / italic (y 4–20): Lucide's own H sits on 6–18 and reads a size smaller.
  heading1: `<path d="M3 4v16"/><path d="M11 4v16"/><path d="M3 12h8"/><path d="m15.5 10.5 3-2.5v12"/>`,
  heading2: `<path d="M3 4v16"/><path d="M11 4v16"/><path d="M3 12h8"/><path d="M15 11c.2-2 1.7-3 3.4-3 1.9 0 3.2 1.2 3.2 2.9 0 1.4-.8 2.4-2.2 3.7L15 20h6.8"/>`,
  heading3: `<path d="M3 4v16"/><path d="M11 4v16"/><path d="M3 12h8"/><path d="M15.2 9.6c.6-1 1.7-1.6 3-1.6 1.9 0 3.2 1.1 3.2 2.6s-1.1 2.4-2.6 2.6c1.7.2 2.8 1.2 2.8 2.8 0 1.8-1.5 3-3.5 3-1.5 0-2.7-.6-3.3-1.6"/>`,
  italic: `<line x1="19" x2="10" y1="4" y2="4"/><line x1="14" x2="5" y1="20" y2="20"/><line x1="15" x2="9" y1="4" y2="20"/>`,
  link: `<path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/>`,
  // island bar, image bar
  alignLeft: `<path d="M15 12H3"/><path d="M17 18H3"/><path d="M21 6H3"/>`,
  alignCenter: `<path d="M17 12H7"/><path d="M19 18H5"/><path d="M21 6H3"/>`,
  alignRight: `<path d="M21 12H9"/><path d="M21 18H7"/><path d="M21 6H3"/>`,
  captions: `<rect width="18" height="14" x="3" y="5" rx="2" ry="2"/><path d="M7 15h4M15 15h2M7 11h2M13 11h4"/>`,
  arrowUp: `<path d="m18 15-6-6-6 6"/>`,
  arrowDown: `<path d="m6 9 6 6 6-6"/>`,
  grip: `<circle cx="9" cy="12" r="1"/><circle cx="9" cy="5" r="1"/><circle cx="9" cy="19" r="1"/><circle cx="15" cy="12" r="1"/><circle cx="15" cy="5" r="1"/><circle cx="15" cy="19" r="1"/>`,
  trash: `<path d="M3 6h18"/><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"/><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"/>`,
  alert: `<circle cx="12" cy="12" r="10"/><line x1="12" x2="12" y1="8" y2="12"/><line x1="12" x2="12.01" y1="16" y2="16"/>`,
} as const;

export type IconName = keyof typeof PATHS;

export function icon(name: IconName, size = 15): SVGElement {
  return svg(iconMarkup(name, size));
}

/** Same icon as a string, for places that build markup by hand. */
export function iconMarkup(name: IconName, size = 15): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${PATHS[name]}</svg>`;
}
