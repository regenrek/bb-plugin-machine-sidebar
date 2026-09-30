// Run: node --test tags.test.ts
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  autoColorId,
  colorHex,
  normalizeRules,
  parseTitleTags,
  tagColorResolver,
  type TagRule,
} from "./tags.ts";

test("splits leading tags off the title", () => {
  assert.deepEqual(parseTitleTags("[TEST] claude calls codex"), {
    tags: ["TEST"],
    rest: "claude calls codex",
  });
  assert.deepEqual(parseTitleTags("[Coding][Running] Weatherloop"), {
    tags: ["Coding", "Running"],
    rest: "Weatherloop",
  });
  assert.deepEqual(parseTitleTags("  [ WIP ]  [x]  rest [not a tag]"), {
    tags: ["WIP", "x"],
    rest: "rest [not a tag]",
  });
});

test("leaves titles without leading tags alone", () => {
  assert.deepEqual(parseTitleTags("Fix [TEST] later"), { tags: [], rest: "Fix [TEST] later" });
  assert.deepEqual(parseTitleTags("[] empty"), { tags: [], rest: "[] empty" });
  assert.deepEqual(parseTitleTags("[unclosed title"), { tags: [], rest: "[unclosed title" });
  assert.deepEqual(parseTitleTags(`[${"x".repeat(30)}] too long`), {
    tags: [],
    rest: `[${"x".repeat(30)}] too long`,
  });
});

test("automatic colors are stable, case-insensitive, and never gray", () => {
  assert.equal(autoColorId("TEST"), autoColorId("test"));
  // The tags in use today stay distinguishable.
  assert.equal(new Set(["TEST", "Coding", "Running"].map(autoColorId)).size, 3);
  for (const tag of ["a", "bb", "Bug", "WIP", "Review", "Plugin", "x".repeat(24)]) {
    assert.notEqual(autoColorId(tag), "gray");
  }
});

test("user rules win over automatic colors, case-insensitively", () => {
  const resolve = tagColorResolver([{ tag: "Bug", color: "red" }]);
  assert.equal(resolve("BUG"), colorHex("red"));
  assert.equal(resolve("TEST"), colorHex(autoColorId("TEST")));
});

test("normalizes rules from the settings page", () => {
  const rules = [
    { tag: "  Bug ", color: "red" },
    { tag: "[WIP]", color: "amber" },
    { tag: "bug", color: "blue" },
    { tag: "   ", color: "green" },
    { tag: "x".repeat(25), color: "green" },
    { tag: "Odd", color: "chartreuse" },
  ] as unknown as TagRule[];
  assert.deepEqual(normalizeRules(rules), [
    { tag: "Bug", color: "red" },
    { tag: "WIP", color: "amber" },
  ]);
});
