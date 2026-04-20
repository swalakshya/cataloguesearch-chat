const SERVER_STATUS = new Set([500, 502, 503, 504, 429, 529]);

export function classifyProviderError(err) {
  if (err?.name === "AbortError") {
    return { kind: "server", reason: "timeout" };
  }
  const status = err?.status ?? err?.code ?? err?.response?.status;
  if (SERVER_STATUS.has(Number(status))) {
    return { kind: "server", reason: "http_status" };
  }

  const message = String(err?.message || "").toLowerCase();
  // The Google GenAI SDK wraps AbortError as a plain Error with message
  // "exception AbortError: This operation was aborted", so check by message too.
  if (message.includes("aborterror") || message.includes("operation was aborted")) {
    return { kind: "server", reason: "timeout" };
  }
  if (
    message.includes("unavailable") ||
    message.includes("resource_exhausted") ||
    message.includes("service unavailable") ||
    message.includes("high demand") ||
    message.includes("timeout") ||
    message.includes("timed out")
  ) {
    return { kind: "server", reason: "message" };
  }

  if (message.includes("unauthorized") || message.includes("forbidden")) {
    return { kind: "client", reason: "auth" };
  }

  if (status && Number(status) >= 400 && Number(status) < 500) {
    return { kind: "client", reason: "http_4xx" };
  }

  return { kind: "unknown", reason: "unknown" };
}
