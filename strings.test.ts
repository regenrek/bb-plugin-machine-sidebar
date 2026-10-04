import { describe, expect, it } from "vitest";
import { LANGUAGES, LANGUAGE_OPTIONS, resolveStrings } from "./strings";
import { buildTree, type TreeThread } from "./tree";

/** Every path to a leaf: strings, functions and word-form pairs end a path. */
function leafPaths(value: unknown, prefix = ""): string[] {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return [prefix];
  return Object.entries(value).flatMap(([key, child]) => leafPaths(child, prefix ? `${prefix}.${key}` : key));
}
const shape = (value: unknown, prefix = ""): string[] => {
  if (Array.isArray(value)) return [`${prefix}[${value.length}]`];
  if (value === null || typeof value !== "object") return [`${prefix}:${typeof value}`];
  return Object.entries(value).flatMap(([key, child]) => shape(child, prefix ? `${prefix}.${key}` : key));
};

describe("string files", () => {
  it("german has exactly the keys, value kinds and word forms of english", () => {
    expect(shape(LANGUAGES.de).sort()).toEqual(shape(LANGUAGES.en).sort());
    expect(leafPaths(LANGUAGES.de).length).toBeGreaterThan(100);
  });
  it("german leaves no empty text", () => {
    for (const path of leafPaths(LANGUAGES.de)) {
      const value = path.split(".").reduce<unknown>((node, key) => (node as Record<string, unknown>)[key], LANGUAGES.de);
      if (typeof value === "string") expect(value, path).not.toBe("");
    }
  });
  it("every language code is selectable, next to auto", () => {
    expect([...LANGUAGE_OPTIONS].sort()).toEqual([...Object.keys(LANGUAGES), "auto"].sort());
  });
});

describe("resolveStrings", () => {
  it("defaults to english for missing, unknown and inherited values", () => {
    for (const setting of [undefined, null, "", "fr", 3, "constructor", "toString"]) {
      expect(resolveStrings(setting)).toBe(LANGUAGES.en);
    }
  });
  it("picks the chosen language", () => {
    expect(resolveStrings("en")).toBe(LANGUAGES.en);
    expect(resolveStrings("de")).toBe(LANGUAGES.de);
  });
  it("auto follows the browser language and falls back to english", () => {
    expect(resolveStrings("auto", "de-AT")).toBe(LANGUAGES.de);
    expect(resolveStrings("auto", "DE")).toBe(LANGUAGES.de);
    expect(resolveStrings("auto", "en-US")).toBe(LANGUAGES.en);
    expect(resolveStrings("auto", "fr-FR")).toBe(LANGUAGES.en);
    expect(resolveStrings("auto")).toBe(LANGUAGES.en);
  });
  it("returns a stable object so context consumers do not re-render", () => {
    expect(resolveStrings("de")).toBe(resolveStrings("auto", "de-DE"));
  });
});

describe("group names", () => {
  const thread: TreeThread = {
    id: "t", projectId: "unknown", parentThreadId: null, isPinned: false, isArchived: false, isHidden: false,
    pinSortKey: null, pinnedAt: null, updatedAt: 1, latestAttentionAt: null, host: null,
  };
  it("come from the given language and default to english", () => {
    const german = buildTree([thread], [], { groups: LANGUAGES.de.groups });
    expect(german.machines[0].fullName).toBe("Keine Maschine");
    expect(german.machines[0].projects[0].name).toBe("Unbekanntes Projekt");
    expect(buildTree([thread], []).machines[0].projects[0].name).toBe("Unknown project");
  });
});
