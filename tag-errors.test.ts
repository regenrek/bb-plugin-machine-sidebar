import assert from "node:assert/strict";
import test from "node:test";
import { classifyTagRulesError } from "./tag-errors.ts";

test("classifies stable SDK RPC error codes before message text", () => {
  const categories = {
    invalid_input: "validation",
    invalid_json: "validation",
    invalid_output: "server",
    non_json_result: "server",
    handler_error: "server",
    unknown_method: "unavailable",
  } as const;
  for (const [code, expected] of Object.entries(categories)) {
    assert.equal(classifyTagRulesError(Object.assign(new Error("Failed to fetch"), { code })), expected, code);
  }
});

test("classifies browser fetch failures and network transport codes", () => {
  for (const message of ["Failed to fetch", "fetch failed", "Load failed", "NetworkError when attempting to fetch resource."]) {
    assert.equal(classifyTagRulesError(new Error(message)), "network", message);
  }
  for (const code of ["ECONNREFUSED", "ECONNRESET", "ENOTFOUND", "ENETUNREACH"]) {
    assert.equal(classifyTagRulesError(Object.assign(new Error("Transport failed"), { code })), "network", code);
  }
  assert.equal(classifyTagRulesError(new DOMException("Transport failed", "NetworkError")), "network");
});

test("classifies transport timeouts", () => {
  for (const cause of [
    new Error("RPC call timed out"),
    new Error("RPC timeout"),
    new DOMException("Request expired", "TimeoutError"),
    Object.assign(new Error("Request expired"), { code: "ETIMEDOUT" }),
  ]) {
    assert.equal(classifyTagRulesError(cause), "timeout");
  }
});

test("classifies plugin availability failures", () => {
  for (const message of ["Plugin is not running", "Plugin unavailable", "Plugin is not available", "Plugin disabled", "Plugin not found"]) {
    assert.equal(classifyTagRulesError(new Error(message)), "unavailable", message);
  }
});

test("keeps unknown errors generic instead of displaying or guessing raw details", () => {
  for (const cause of [new Error("Unexpected SDK detail"), "Unexpected rejection", null, undefined, 42, {},
    Object.assign(new Error("Invalid tag"), { code: "future_code" }),
    new DOMException("Request cancelled", "AbortError"),
  ]) {
    assert.equal(classifyTagRulesError(cause), "unknown");
  }
});
