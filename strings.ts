// Every user-visible text of Machine Sidebar, one file per language:
// strings/en.ts (the default, and the source of the `Strings` shape) and
// strings/de.ts. The `language` plugin setting picks one (see i18n.tsx).
//
// Downstream forks that need their own texts add their own keys to BOTH
// languages (en.ts, then de.ts, which is typed as the English shape, so a
// missing key fails `npm run typecheck`) and leave this file and the code that
// uses the texts alone. That keeps merges from upstream conflict-free: upstream
// edits existing keys, a fork only adds new ones. To add a language, create
// strings/<code>.ts typed as `Strings` and register it in LANGUAGES below.
import { de } from "./strings/de.ts";
import { en, type Strings } from "./strings/en.ts";

export type { Strings };

/** Plugin setting that picks the language of every text below. */
export const LANGUAGE_SETTING = "language";
/** Selectable values: a language code, or "auto" (browser language, else English). */
export const LANGUAGE_OPTIONS = ["en", "de", "auto"];
export const DEFAULT_LANGUAGE = "en";

export const LANGUAGES = { en, de } as const satisfies Record<string, Strings>;
export type Language = keyof typeof LANGUAGES;

/**
 * The texts for a stored setting value. Unknown or missing values give English;
 * "auto" follows `browserLanguage` (for example `navigator.language`).
 * Returns one of the module-level objects, so the result is referentially stable.
 */
export function resolveStrings(setting: unknown, browserLanguage?: string): Strings {
  const language = setting === "auto" ? browserLanguage?.toLowerCase().split("-")[0] : setting;
  return typeof language === "string" && Object.hasOwn(LANGUAGES, language)
    ? LANGUAGES[language as Language]
    : en;
}

/** English texts: the default, and for places that cannot react to the setting. */
export const ENGLISH: Strings = en;
