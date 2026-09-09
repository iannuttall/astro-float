import { icon } from "./icons";

/**
 * One small calendar popover, used by the date on the page and the date
 * control in the sidebar. Lives in `document.body` (styled by the page-side
 * stylesheet), positions itself under its anchor, closes on click-away /
 * Escape / pick, and hands back a plain `YYYY-MM-DD`.
 *
 * Keyboard: arrows move a day, PageUp/PageDown a month, Home/End to the week's
 * ends, Enter/Space pick, Escape closes.
 */
export interface DatePickerOptions {
  anchor: Element;
  /** Current `YYYY-MM-DD`, or null for none. */
  value: string | null;
  onPick(iso: string): void;
  onClose?(): void;
  locale?: string;
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

interface Ymd {
  y: number;
  m: number; // 0-based
  d: number;
}

export class DatePicker {
  private static current: DatePicker | null = null;

  /** Open for an anchor; a second call on the same anchor closes instead (toggle). */
  static toggle(opts: DatePickerOptions): DatePicker | null {
    if (DatePicker.current?.opts.anchor === opts.anchor) {
      DatePicker.current.close();
      return null;
    }
    DatePicker.current?.close();
    const picker = new DatePicker(opts);
    DatePicker.current = picker;
    return picker;
  }

  static close() {
    DatePicker.current?.close();
  }

  static isOpenFor(anchor: Element) {
    return DatePicker.current?.opts.anchor === anchor;
  }

  private el: HTMLElement;
  private grid: HTMLElement;
  private label: HTMLElement;
  private view: { y: number; m: number };
  private focused: Ymd;
  private selected: Ymd | null;
  private locale: string;
  private firstDay: number; // 1 = Monday … 7 = Sunday
  private todayYmd = fromDate(new Date());

  private constructor(private opts: DatePickerOptions) {
    this.locale = opts.locale ?? document.documentElement.lang ?? navigator.language ?? "en";
    this.firstDay = weekStart(this.locale);
    this.selected = opts.value && ISO_DATE.test(opts.value) ? fromIso(opts.value) : null;
    const start = this.selected ?? this.todayYmd;
    this.view = { y: start.y, m: start.m };
    this.focused = start;

    this.el = document.createElement("div");
    this.el.className = "astro-float-datepicker";
    this.el.setAttribute("role", "dialog");
    this.el.setAttribute("aria-label", "Choose a date");
    this.el.addEventListener("mousedown", (e) => e.preventDefault()); // don't steal the page's selection/focus
    this.el.addEventListener("keydown", this.onKeydown);

    const head = document.createElement("div");
    head.className = "astro-float-dp-head";
    const prev = this.navButton("chevronLeft", "Previous month", -1);
    const next = this.navButton("chevron", "Next month", 1);
    this.label = document.createElement("div");
    this.label.className = "astro-float-dp-label";
    this.label.setAttribute("aria-live", "polite");
    head.append(prev, this.label, next);

    const weekdays = document.createElement("div");
    weekdays.className = "astro-float-dp-weekdays";
    const fmt = new Intl.DateTimeFormat(this.locale, { weekday: "short", timeZone: "UTC" });
    for (let i = 0; i < 7; i++) {
      const dow = ((this.firstDay - 1 + i) % 7) + 1; // 1..7, Monday = 1
      // 2024-01-01 is a Monday.
      const sample = new Date(Date.UTC(2024, 0, dow));
      const cell = document.createElement("span");
      cell.textContent = fmt.format(sample).slice(0, 2);
      weekdays.appendChild(cell);
    }

    this.grid = document.createElement("div");
    this.grid.className = "astro-float-dp-grid";
    this.grid.setAttribute("role", "grid");

    const foot = document.createElement("div");
    foot.className = "astro-float-dp-foot";
    const today = document.createElement("button");
    today.type = "button";
    today.textContent = "Today";
    today.addEventListener("click", () => this.pick(this.todayYmd));
    foot.appendChild(today);

    this.el.append(head, weekdays, this.grid, foot);
    document.body.appendChild(this.el);
    this.render();
    this.position();

    document.addEventListener("mousedown", this.onDocumentMouseDown, true);
    document.addEventListener("keydown", this.onDocumentKeydown, true);
    window.addEventListener("scroll", this.position, true);
    window.addEventListener("resize", this.position);
    opts.anchor.setAttribute("data-float-open", "");

    // Keyboard users land on the selected (or today's) day.
    queueMicrotask(() => this.focusDay(this.focused, false));
  }

  close() {
    if (DatePicker.current === this) DatePicker.current = null;
    document.removeEventListener("mousedown", this.onDocumentMouseDown, true);
    document.removeEventListener("keydown", this.onDocumentKeydown, true);
    window.removeEventListener("scroll", this.position, true);
    window.removeEventListener("resize", this.position);
    this.opts.anchor.removeAttribute("data-float-open");
    const hadFocus = this.el.contains(document.activeElement);
    this.el.remove();
    if (hadFocus && this.opts.anchor instanceof HTMLElement) this.opts.anchor.focus({ preventScroll: true });
    this.opts.onClose?.();
  }

  private pick(ymd: Ymd) {
    this.opts.onPick(toIso(ymd));
    this.close();
  }

  private navButton(name: "chevronLeft" | "chevron", label: string, delta: number) {
    const b = document.createElement("button");
    b.type = "button";
    b.setAttribute("aria-label", label);
    b.appendChild(icon(name, 14));
    b.addEventListener("click", () => this.shiftMonth(delta));
    return b;
  }

  private shiftMonth(delta: number) {
    const d = new Date(Date.UTC(this.view.y, this.view.m + delta, 1));
    this.view = { y: d.getUTCFullYear(), m: d.getUTCMonth() };
    // Keep the focused day inside the visible month.
    if (this.focused.y !== this.view.y || this.focused.m !== this.view.m) {
      const last = daysIn(this.view.y, this.view.m);
      this.focused = { y: this.view.y, m: this.view.m, d: Math.min(this.focused.d, last) };
    }
    this.render();
  }

  private render() {
    const { y, m } = this.view;
    this.label.textContent = new Intl.DateTimeFormat(this.locale, { month: "long", year: "numeric", timeZone: "UTC" }).format(new Date(Date.UTC(y, m, 1)));
    this.grid.textContent = "";
    const first = new Date(Date.UTC(y, m, 1));
    const firstDow = ((first.getUTCDay() + 6) % 7) + 1; // Monday = 1 … Sunday = 7
    const lead = (firstDow - this.firstDay + 7) % 7;
    const days = daysIn(y, m);
    const total = Math.ceil((lead + days) / 7) * 7;
    const longFmt = new Intl.DateTimeFormat(this.locale, { dateStyle: "full", timeZone: "UTC" });
    for (let i = 0; i < total; i++) {
      const offset = i - lead; // 0-based day index within the month, may spill
      const date = new Date(Date.UTC(y, m, offset + 1));
      const ymd = fromDate(date);
      const b = document.createElement("button");
      b.type = "button";
      b.setAttribute("role", "gridcell");
      b.textContent = String(ymd.d);
      b.dataset.iso = toIso(ymd);
      b.setAttribute("aria-label", longFmt.format(date));
      if (ymd.m !== m) b.setAttribute("data-outside", "");
      if (same(ymd, this.todayYmd)) b.setAttribute("data-today", "");
      if (this.selected && same(ymd, this.selected)) {
        b.setAttribute("data-selected", "");
        b.setAttribute("aria-selected", "true");
      }
      b.tabIndex = same(ymd, this.focused) ? 0 : -1;
      b.addEventListener("click", () => this.pick(ymd));
      this.grid.appendChild(b);
    }
  }

  private focusDay(ymd: Ymd, scrollView = true) {
    if (scrollView && (ymd.y !== this.view.y || ymd.m !== this.view.m)) {
      this.view = { y: ymd.y, m: ymd.m };
      this.focused = ymd;
      this.render();
    }
    this.focused = ymd;
    for (const cell of Array.from(this.grid.children) as HTMLElement[]) {
      const on = cell.dataset.iso === toIso(ymd) && !cell.hasAttribute("data-outside");
      cell.tabIndex = on ? 0 : -1;
      if (on) cell.focus({ preventScroll: true });
    }
  }

  private onKeydown = (e: KeyboardEvent) => {
    const move = (days: number) => {
      e.preventDefault();
      const d = new Date(Date.UTC(this.focused.y, this.focused.m, this.focused.d + days));
      this.focusDay(fromDate(d));
    };
    switch (e.key) {
      case "ArrowLeft":
        return move(-1);
      case "ArrowRight":
        return move(1);
      case "ArrowUp":
        return move(-7);
      case "ArrowDown":
        return move(7);
      case "Home":
        return move(-((dow(this.focused) - this.firstDay + 7) % 7));
      case "End":
        return move((this.firstDay + 6 - dow(this.focused) + 7) % 7);
      case "PageUp": {
        e.preventDefault();
        const d = new Date(Date.UTC(this.focused.y, this.focused.m - (e.shiftKey ? 12 : 1), 1));
        const last = daysIn(d.getUTCFullYear(), d.getUTCMonth());
        return this.focusDay({ y: d.getUTCFullYear(), m: d.getUTCMonth(), d: Math.min(this.focused.d, last) });
      }
      case "PageDown": {
        e.preventDefault();
        const d = new Date(Date.UTC(this.focused.y, this.focused.m + (e.shiftKey ? 12 : 1), 1));
        const last = daysIn(d.getUTCFullYear(), d.getUTCMonth());
        return this.focusDay({ y: d.getUTCFullYear(), m: d.getUTCMonth(), d: Math.min(this.focused.d, last) });
      }
      case "Enter":
      case " ": {
        const target = e.target as HTMLElement;
        if (target.matches("[role=gridcell]")) {
          e.preventDefault();
          this.pick(this.focused);
        }
        return;
      }
      case "Escape":
        e.preventDefault();
        e.stopPropagation();
        this.close();
        return;
      default:
        return;
    }
  };

  private onDocumentMouseDown = (e: MouseEvent) => {
    const path = e.composedPath();
    if (path.includes(this.el) || path.includes(this.opts.anchor)) return; // the anchor's own click toggles
    this.close();
  };

  private onDocumentKeydown = (e: KeyboardEvent) => {
    if (e.key === "Escape" && !this.el.contains(e.target as Node)) {
      e.preventDefault();
      e.stopPropagation();
      this.close();
    }
  };

  private position = () => {
    if (!this.opts.anchor.isConnected) {
      this.close();
      return;
    }
    const r = this.opts.anchor.getBoundingClientRect();
    const w = this.el.offsetWidth;
    const hgt = this.el.offsetHeight;
    const below = r.bottom + 6;
    const top = below + hgt <= window.innerHeight - 8 ? below : Math.max(8, r.top - hgt - 6);
    const left = Math.max(8, Math.min(r.left, window.innerWidth - w - 8));
    Object.assign(this.el.style, { top: `${top}px`, left: `${left}px` });
    this.el.toggleAttribute("data-above", top < r.top);
  };
}

// ---- date helpers ------------------------------------------------------------------

function fromIso(iso: string): Ymd {
  const [y, m, d] = iso.split("-").map(Number);
  return { y, m: m - 1, d };
}

function toIso({ y, m, d }: Ymd) {
  return `${y}-${String(m + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

function fromDate(date: Date): Ymd {
  return { y: date.getUTCFullYear(), m: date.getUTCMonth(), d: date.getUTCDate() };
}

function daysIn(y: number, m: number) {
  return new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
}

function same(a: Ymd, b: Ymd) {
  return a.y === b.y && a.m === b.m && a.d === b.d;
}

/** Monday = 1 … Sunday = 7 */
function dow(ymd: Ymd) {
  return ((new Date(Date.UTC(ymd.y, ymd.m, ymd.d)).getUTCDay() + 6) % 7) + 1;
}

/** First day of the week for a locale (Monday = 1 … Sunday = 7); Monday when the browser can't say. */
function weekStart(locale: string): number {
  try {
    const loc = new Intl.Locale(locale) as Intl.Locale & { weekInfo?: { firstDay: number }; getWeekInfo?: () => { firstDay: number } };
    const info = loc.getWeekInfo?.() ?? loc.weekInfo;
    if (info?.firstDay) return info.firstDay;
  } catch {
    /* unknown locale */
  }
  return /^en(-US)?$/i.test(locale) ? 7 : 1;
}
