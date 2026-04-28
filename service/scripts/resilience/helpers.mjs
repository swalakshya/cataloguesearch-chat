/**
 * Shared helpers for the resilience test CLI.
 */

export const BASE = process.env.SERVICE_URL || "http://localhost:8012";

export const HINDI_QUESTIONS = [
  "ज्ञान और राग कैसे भिन्न है?",
  "आत्मानुभूति का उपाय क्या है?",
  "आचार्य कुन्दकुन्द कौन थे?",
  "समयसार की महिमा क्या है?",
  "स्वपरप्रकाशक ज्ञान क्या है?",
  "श्रद्धा और ज्ञान में क्या फ़र्क़ है?",
  "निश्चय और व्यवहार नय में क्या अंतर है?",
  "सच्चा धर्म क्या है?",
  "सच्चा सुख क्या है?",
  "जैन धर्म क्या है?",
];

export function pickQuestion(index = 0) {
  return HINDI_QUESTIONS[index % HINDI_QUESTIONS.length];
}

// ── HTTP helpers ──────────────────────────────────────────────────────────────

export async function post(route, body, { signal } = {}) {
  const res = await fetch(`${BASE}${route}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body || {}),
    signal,
  });
  let json = null;
  try { json = await res.json(); } catch {}
  return { res, json };
}

export async function get(route, { signal } = {}) {
  const res = await fetch(`${BASE}${route}`, { signal });
  let json = null;
  try { json = await res.json(); } catch {}
  return { res, json };
}

export async function createSession() {
  const { json } = await post("/v1/chat/sessions", { provider: "auto" });
  if (!json?.session_id) throw new Error("Failed to create session: " + JSON.stringify(json));
  return json.session_id;
}

export async function submitMessage(sessionId, content, extra = {}) {
  const clientMessageId = crypto.randomUUID();
  const { res, json } = await post(`/v1/chat/sessions/${sessionId}/messages`, {
    role: "user",
    content,
    response_format: "structured",
    client_message_id: clientMessageId,
    ...extra,
  });
  return { res, json, clientMessageId };
}

export async function pollResult(sessionId, messageId, { timeoutMs = 90_000, intervalMs = 600 } = {}) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const { res, json } = await get(`/v1/chat/sessions/${sessionId}/messages/${messageId}/result`);
    if (res.status === 200) return { res, json };
    if (res.status === 202) {
      await sleep(intervalMs);
      continue;
    }
    return { res, json }; // error status
  }
  throw new Error(`pollResult timed out after ${timeoutMs}ms for message ${messageId}`);
}

export async function readStream(sessionId, messageId, { lastEventId, signal } = {}) {
  const qs = lastEventId != null ? `?last_event_id=${lastEventId}` : "";
  const res = await fetch(`${BASE}/v1/chat/sessions/${sessionId}/messages/${messageId}/stream${qs}`, { signal });
  if (!res.ok) {
    let json = null;
    try { json = await res.json(); } catch {}
    throw Object.assign(new Error(`HTTP ${res.status}`), { status: res.status, json });
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buf = "";
  const events = [];
  let finalPayload = null;
  const ids = [];

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    const lines = buf.split("\n");
    buf = lines.pop() || "";
    for (const line of lines) {
      if (line.startsWith("id: ")) { ids.push(Number(line.slice(4))); continue; }
      if (!line.startsWith("data: ")) continue;
      let payload;
      try { payload = JSON.parse(line.slice(6)); } catch { continue; }
      events.push(payload);
      if (payload.type === "final") finalPayload = payload.data;
    }
  }
  return { events, finalPayload, ids };
}

/** Like readStream but calls onEvent for each event as they arrive (live streaming). */
export async function consumeStreamLive(sessionId, messageId, { lastEventId, signal, onEvent, onEventId } = {}) {
  const qs = lastEventId != null ? `?last_event_id=${lastEventId}` : "";
  const res = await fetch(`${BASE}/v1/chat/sessions/${sessionId}/messages/${messageId}/stream${qs}`, { signal });
  if (!res.ok) {
    let json = null;
    try { json = await res.json(); } catch {}
    throw Object.assign(new Error(`HTTP ${res.status}`), { status: res.status, json });
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buf = "";
  const events = [];
  let finalPayload = null;
  let lastSeenId = null;
  let currentEventId = null;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    const lines = buf.split("\n");
    buf = lines.pop() || "";
    for (const line of lines) {
      if (signal?.aborted) {
        throw new DOMException("This operation was aborted", "AbortError");
      }
      if (line.startsWith("id: ")) {
        currentEventId = Number(line.slice(4));
        continue;
      }
      if (!line.startsWith("data: ")) continue;
      let payload;
      try { payload = JSON.parse(line.slice(6)); } catch { continue; }
      lastSeenId = currentEventId;
      if (lastSeenId != null) onEventId?.(lastSeenId);
      events.push(payload);
      onEvent?.(payload, lastSeenId);
      if (payload.type === "final") finalPayload = payload.data;
      currentEventId = null;
      if (signal?.aborted) {
        throw new DOMException("This operation was aborted", "AbortError");
      }
    }
  }
  return { events, finalPayload, lastSeenId };
}

// ── Assertion helpers ─────────────────────────────────────────────────────────

const PASS = "\x1b[32m✓\x1b[0m";
const FAIL = "\x1b[31m✗\x1b[0m";

export const results = [];
let _currentTestId = null;

export function assert(label, condition, extra = "") {
  const ok = Boolean(condition);
  const taggedLabel = _currentTestId ? `${_currentTestId} ${label}` : label;
  results.push({ label: taggedLabel, ok, extra: ok ? "" : extra });
  if (ok) {
    process.stdout.write(`    ${PASS} ${label}\n`);
  } else {
    process.stdout.write(`    ${FAIL} ${label}${extra ? " — " + extra : ""}\n`);
  }
  return ok;
}

export function testHeader(name) {
  // Extract "SFn-n" prefix from header like "SF1-3  Idempotent..."
  const m = name.match(/^(SF\d+-\d+)\b/);
  _currentTestId = m ? m[1] : null;
  process.stdout.write(`\n  \x1b[36m${name}\x1b[0m\n`);
}

export function groupHeader(name) {
  process.stdout.write(`\n\x1b[1m\x1b[34m${name}\x1b[0m\n`);
}

// ── Timing ────────────────────────────────────────────────────────────────────

export function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

export async function measureMs(fn) {
  const t = Date.now();
  const result = await fn();
  return { result, ms: Date.now() - t };
}

// ── Health check ──────────────────────────────────────────────────────────────

export async function waitForHealth(timeoutMs = 30_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`${BASE}/v1/health`);
      if (res.ok) return true;
    } catch {}
    await sleep(500);
  }
  return false;
}
