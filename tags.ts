// Leading title tags for Machine Sidebar: "[TEST][Running] Checkout Flow" is
// drawn as two colored pills followed by "Checkout Flow". Colors come from the
// user's tag rules (Settings → Machine Sidebar) or, for tags without a rule,
// from a stable hash of the tag name. Kept free of React and the SDK runtime
// so it can be tested with plain Node and shared by server and app.

export interface TitleTags {
  tags: string[];
  rest: string;
}

export const MAX_TAG_LENGTH = 24;
/** Realtime channel the server publishes on when tag rules change. */
export const TAG_RULES_CHANGED = "tag-rules-changed";
/** Realtime channel the server publishes on when inactive marks change. */
export const INACTIVE_CHANGED = "inactive-changed";
export const MAX_TAG_RULES = 100;

const LEADING_TAG = new RegExp(`^\\s*\\[([^[\\]]{1,${MAX_TAG_LENGTH}})\\]`, "u");

/** Splits bracketed tags off the start of a title; other brackets stay text. */
export function parseTitleTags(title: string): TitleTags {
  const tags: string[] = [];
  let rest = title;
  for (let match = LEADING_TAG.exec(rest); match !== null; match = LEADING_TAG.exec(rest)) {
    const tag = match[1].trim();
    if (tag === "") break;
    tags.push(tag);
    rest = rest.slice(match[0].length);
  }
  return { tags, rest: rest.trim() };
}

/** Mid-tone hues that stay readable on both light and dark sidebars. */
export const TAG_PALETTE = [
  { id: "red", hex: "#e5484d" },
  { id: "orange", hex: "#f76b15" },
  { id: "amber", hex: "#d6a100" },
  { id: "green", hex: "#30a46c" },
  { id: "teal", hex: "#12a594" },
  { id: "blue", hex: "#0090ff" },
  { id: "violet", hex: "#8e4ec6" },
  { id: "pink", hex: "#d6409f" },
  { id: "gray", hex: "#8b8d98" },
] as const;

export type TagColorId = (typeof TAG_PALETTE)[number]["id"];
export const TAG_COLOR_IDS = TAG_PALETTE.map((color) => color.id) as [TagColorId, ...TagColorId[]];

export interface TagRule {
  tag: string;
  color: TagColorId;
}

const HEX_BY_ID = new Map<string, string>(TAG_PALETTE.map((color) => [color.id, color.hex]));
/** Automatic colors skip gray, which is reserved for deliberate choices. */
const AUTO_COLORS = TAG_PALETTE.filter((color) => color.id !== "gray");

export function colorHex(id: TagColorId): string {
  return HEX_BY_ID.get(id) ?? TAG_PALETTE[0].hex;
}

/** The automatic color: the same tag always gets the same color, regardless of case. */
export function autoColorId(tag: string): TagColorId {
  let hash = 0x811c9dc5;
  for (const char of tag.toLowerCase()) {
    hash ^= char.codePointAt(0)!;
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return AUTO_COLORS[hash % AUTO_COLORS.length].id;
}

/** Trims tags, drops empty ones, and keeps the first rule per tag (case-insensitive). */
export function normalizeRules(rules: readonly TagRule[]): TagRule[] {
  const seen = new Set<string>();
  const result: TagRule[] = [];
  for (const rule of rules) {
    const tag = rule.tag.trim().replace(/^\[|\]$/gu, "").trim();
    const key = tag.toLowerCase();
    if (tag === "" || tag.length > MAX_TAG_LENGTH || seen.has(key)) continue;
    if (!HEX_BY_ID.has(rule.color)) continue;
    seen.add(key);
    result.push({ tag, color: rule.color });
  }
  return result.slice(0, MAX_TAG_RULES);
}

/** A lookup from tag to hex color: the user's rule first, then the automatic color. */
export function tagColorResolver(rules: readonly TagRule[]): (tag: string) => string {
  const byTag = new Map(rules.map((rule) => [rule.tag.toLowerCase(), rule.color]));
  return (tag) => colorHex(byTag.get(tag.toLowerCase()) ?? autoColorId(tag));
}
