import type { FieldDef, FieldType } from "../toolbar/schema";

export const TEXT_KEYS: Set<string>;
export const TEXT_MAX: number;
export const DATE_LIKE: RegExp;
export const HAS_TIME: RegExp;
export const IMAGE_LIKE: RegExp;
export const IMAGE_KEYS: RegExp;

/** `pubDate` → "Pub date", `hero_image` → "Hero image", `SEOTitle` → "SEO title". */
export function humanize(key: string): string;
/** A definition for one key, from its value alone (never required). */
export function inferField(key: string, value: unknown): FieldDef;
/** The control a value asks for. */
export function inferType(key: string, value: unknown): FieldType;
