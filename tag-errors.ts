/** Language-independent categories retained by the tag settings UI. */
export type TagRulesErrorCode = "network" | "timeout" | "unavailable" | "validation" | "server" | "unknown";

/**
 * SDK 0.5.29 documents Error.code for RPC rejections in PluginRpcClient.call.
 * Transport errors originate in the host/browser; recognize common failures
 * conservatively and keep every unrecognized detail out of visible messages.
 */
export function classifyTagRulesError(cause: unknown): TagRulesErrorCode {
  const error = cause !== null && typeof cause === "object"
    ? cause as { code?: unknown; name?: unknown; message?: unknown }
    : undefined;
  const code = typeof error?.code === "string" ? error.code.toLowerCase() : "";
  switch (code) {
    case "invalid_input":
    case "invalid_json":
      return "validation";
    case "handler_error":
    case "invalid_output":
    case "non_json_result":
      return "server";
    case "unknown_method":
      return "unavailable";
  }

  const message = typeof error?.message === "string" ? error.message : typeof cause === "string" ? cause : "";
  if (error?.name === "TimeoutError" || code === "etimedout" || /\b(?:timeout|timed out)\b/iu.test(message)) {
    return "timeout";
  }
  if (/\bplugin\b.*\b(?:not running|unavailable|not available|disabled|not found)\b/iu.test(message)) {
    return "unavailable";
  }
  if (["econnrefused", "econnreset", "enotfound", "enetunreach"].includes(code)
    || error?.name === "NetworkError"
    || /^(?:failed to fetch|fetch failed|load failed|network ?error(?: when attempting to fetch resource\.?)?)\.?$/iu.test(message)) {
    return "network";
  }
  return "unknown";
}
