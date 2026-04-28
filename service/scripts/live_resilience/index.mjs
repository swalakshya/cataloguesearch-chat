#!/usr/bin/env node
/**
 * Live resilience suite.
 *
 * Starts the real chat service via `npm start` so it uses the same `.env.local`
 * flow as local production-like startup, assumes the backend/search service is
 * already running at localhost:8000, and exercises user-visible interruption
 * scenarios against real provider behavior.
 */

import crypto from "node:crypto";
import { execSync, spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  BASE,
  post,
  get,
  createSession,
  pollResult,
  readStream,
  consumeStreamLive,
  sleep,
  waitForHealth,
} from "../resilience/helpers.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SERVICE_DIR = path.resolve(__dirname, "../..");
const BACKEND_URL = process.env.BACKEND_URL || "http://localhost:8000";
const CHAT_PORT = Number(new URL(BASE).port || "8012");
const SEED = Number(process.env.LIVE_SUITE_SEED || Date.now());
const CONCURRENCY = Number(process.env.LIVE_SUITE_CONCURRENCY || 2);

const PASS = "\x1b[32mPASS\x1b[0m";
const FAIL = "\x1b[31mFAIL\x1b[0m";

const QUESTION_POOL = [
  "जैन धर्म में सम्यग्दर्शन का महत्व क्या है?",
  "समयसार का मुख्य संदेश क्या है?",
  "आत्मा और शरीर में क्या अंतर है?",
  "क्या राग और द्वेष मुक्ति में बाधा हैं? उदाहरण सहित बताइए।",
  "सच्चा सुख किसे कहा गया है?",
  "श्रद्धा, ज्ञान और चरित्र का आपस में क्या संबंध है?",
  "निश्चय नय और व्यवहार नय में सरल अंतर समझाइए।",
  "आचार्य कुन्दकुन्द कौन थे और उनका योगदान क्या है?",
  "अहिंसा का व्यवहारिक अर्थ क्या है?",
  "क्या जम्बूस्वामी के बारे में संक्षेप में बता सकते हैं?",
  "सम्यक ज्ञान और मिथ्या ज्ञान में क्या भेद है?",
  "मोक्ष मार्ग के तीन रत्नों को सरल भाषा में समझाइए।",
  "क्या कर्म सिद्धांत को दैनिक जीवन के उदाहरण से समझा सकते हैं?",
  "समयसार किस ग्रंथ परंपरा में महत्वपूर्ण माना जाता है?",
  "जीव और अजीव का अंतर क्या है?",
];

const CASES = [
  { id: "L1", name: "Normal completion + reload after completion", ux: "User waits, then refreshes and still sees the finished answer", queries: 1 },
  { id: "L2", name: "Disconnect after submit", ux: "User sends, loses connection immediately, returns later and still gets one answer", queries: 1 },
  { id: "L3", name: "Mid-stream interrupt + resume", ux: "User sees progress, connection drops, reconnect resumes to one final answer", queries: 1 },
  { id: "L4", name: "Reload while processing", ux: "User refreshes mid-answer and recovery continues", queries: 1 },
  { id: "L5", name: "Retry after ambiguous send", ux: "User retries after uncertain send outcome without duplicate visible answer", queries: 1 },
  { id: "L6", name: "Background and return", ux: "Mobile browser backgrounds after progress and later returns to a completed answer", queries: 1 },
  { id: "L7", name: "Two tabs on same message", ux: "Two open tabs receive consistent progress and the same final answer", queries: 1 },
  { id: "L8", name: "Parallel mixed sessions", ux: "Two independent users hit flaky conditions at the same time without cross-talk", queries: 2 },
  { id: "L9", name: "Restart after completion", ux: "Chat service restarts and the completed answer is still recoverable", queries: 1 },
];

function mulberry32(seed) {
  let t = seed >>> 0;
  return () => {
    t += 0x6D2B79F5;
    let x = Math.imul(t ^ (t >>> 15), 1 | t);
    x ^= x + Math.imul(x ^ (x >>> 7), 61 | x);
    return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
  };
}

const rng = mulberry32(SEED);

function pickQuestion() {
  const idx = Math.floor(rng() * QUESTION_POOL.length);
  return QUESTION_POOL[idx];
}

function pickDetailedQuestion() {
  return `${pickQuestion()} कृपया कारण, उदाहरण और व्यवहारिक अर्थ भी बताइए।`;
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function expectStructuredAnswer(result, label) {
  assert(result?.status === "done", `${label}: expected status=done`);
  assert(typeof result?.answer === "string" && result.answer.trim().length > 0, `${label}: missing answer`);
  assert(Array.isArray(result?.references), `${label}: references is not an array`);
  assert(Array.isArray(result?.follow_up_questions), `${label}: follow_up_questions is not an array`);
}

function shortQuestion(text) {
  return String(text || "").replace(/\s+/g, " ").slice(0, 52);
}

async function submit(sessionId, content, { clientMessageId } = {}) {
  const messageId = clientMessageId || crypto.randomUUID();
  const { res, json } = await post(`/v1/chat/sessions/${sessionId}/messages`, {
    role: "user",
    content,
    response_format: "structured",
    client_message_id: messageId,
  });
  return { res, json, messageId };
}

async function waitForBackend(timeoutMs = 20_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`${BACKEND_URL}/api/metadata`);
      if (res.ok) return true;
    } catch {
      // ignore
    }
    await sleep(500);
  }
  return false;
}

function killPortListener(port) {
  let pids = "";
  try {
    pids = execSync(`lsof -tiTCP:${port} -sTCP:LISTEN || true`, {
      cwd: SERVICE_DIR,
      stdio: ["ignore", "pipe", "ignore"],
      encoding: "utf8",
    }).trim();
  } catch {
    pids = "";
  }
  for (const pid of pids.split(/\s+/).filter(Boolean)) {
    try { process.kill(Number(pid), "SIGTERM"); } catch {}
  }
}

class ChatServiceManager {
  constructor() {
    this.child = null;
    this.logLines = [];
  }

  capture(data) {
    const lines = String(data || "").split(/\r?\n/).filter(Boolean);
    for (const line of lines) this.logLines.push(line);
    this.logLines = this.logLines.slice(-80);
  }

  tailLogs() {
    return this.logLines.slice(-20).join("\n");
  }

  async start() {
    killPortListener(CHAT_PORT);
    this.logLines = [];
    this.child = spawn("npm", ["start"], {
      cwd: SERVICE_DIR,
      env: { ...process.env },
      detached: true,
      stdio: ["ignore", "pipe", "pipe"],
    });
    this.child.stdout?.on("data", (chunk) => this.capture(chunk));
    this.child.stderr?.on("data", (chunk) => this.capture(chunk));
    const healthy = await waitForHealth(45_000);
    if (!healthy) {
      const logs = this.tailLogs();
      throw new Error(`chat_service_not_healthy${logs ? `\n${logs}` : ""}`);
    }
  }

  async stop() {
    if (this.child?.pid) {
      try { process.kill(-this.child.pid, "SIGTERM"); } catch {}
    }
    this.child = null;
    await sleep(1_500);
    killPortListener(CHAT_PORT);
  }

  async restart() {
    await this.stop();
    await this.start();
  }
}

async function runCase(meta, fn) {
  const startedAt = Date.now();
  process.stdout.write(`\n\x1b[36m${meta.id}  ${meta.name}\x1b[0m\n`);
  try {
    const info = await fn();
    return {
      ...meta,
      ok: true,
      ms: Date.now() - startedAt,
      question: shortQuestion(info?.question),
      extra: "",
    };
  } catch (err) {
    return {
      ...meta,
      ok: false,
      ms: Date.now() - startedAt,
      question: shortQuestion(err?.question || meta.question || ""),
      extra: err?.message || String(err),
    };
  }
}

async function scenarioNormalReload() {
  const question = pickQuestion();
  const sessionId = await createSession();
  const { res, json, messageId } = await submit(sessionId, question);
  assert(res.status === 202, `submit status ${res.status}`);
  const { res: resultRes, json: resultJson } = await pollResult(sessionId, messageId);
  assert(resultRes.status === 200, `poll status ${resultRes.status}`);
  expectStructuredAnswer(resultJson, "normal_reload");
  const { res: sessionRes, json: sessionJson } = await get(`/v1/chat/sessions/${sessionId}`);
  assert(sessionRes.status === 200, `session status ${sessionRes.status}`);
  assert(Array.isArray(sessionJson?.messages) && sessionJson.messages.length >= 2, "session messages missing");
  const assistant = [...sessionJson.messages].reverse().find((m) => m?.role === "assistant");
  assert(typeof assistant?.content === "string" && assistant.content.trim().length > 0, "assistant message missing after reload");
  return { question };
}

async function scenarioDisconnectPoll() {
  const question = pickQuestion();
  const sessionId = await createSession();
  const { res, messageId } = await submit(sessionId, question);
  assert(res.status === 202, `submit status ${res.status}`);
  await sleep(1_500);
  const { res: resultRes, json: resultJson } = await pollResult(sessionId, messageId);
  assert(resultRes.status === 200, `poll status ${resultRes.status}`);
  expectStructuredAnswer(resultJson, "disconnect_poll");
  return { question };
}

async function interruptAndCaptureCursor(sessionId, messageId) {
  let cursorId = null;
  let aborted = false;
  const ac = new AbortController();
  await consumeStreamLive(sessionId, messageId, {
    signal: ac.signal,
    onEventId: (id) => { cursorId = id; },
    onEvent: (payload) => {
      if (!aborted && payload.type === "stage") {
        aborted = true;
        ac.abort();
      }
    },
  }).catch((err) => {
    if (err?.name === "AbortError") return null;
    throw err;
  });
  assert(cursorId != null, "no cursor captured before interrupt");
  return cursorId;
}

async function scenarioMidStreamReconnect() {
  const question = pickDetailedQuestion();
  const sessionId = await createSession();
  const { res, messageId } = await submit(sessionId, question);
  assert(res.status === 202, `submit status ${res.status}`);
  const cursorId = await interruptAndCaptureCursor(sessionId, messageId);
  const { events, finalPayload } = await readStream(sessionId, messageId, { lastEventId: cursorId });
  assert(events.some((e) => e.type === "final"), "reconnect stream missing final event");
  expectStructuredAnswer({ status: "done", ...finalPayload }, "mid_stream_reconnect");
  return { question };
}

async function scenarioReloadWhileProcessing() {
  const question = pickDetailedQuestion();
  const sessionId = await createSession();
  const { res, messageId } = await submit(sessionId, question);
  assert(res.status === 202, `submit status ${res.status}`);
  await sleep(400);
  const { res: sessionRes, json: sessionJson } = await get(`/v1/chat/sessions/${sessionId}`);
  assert(sessionRes.status === 200, `session status ${sessionRes.status}`);
  assert("busy" in sessionJson, "busy field missing");
  assert(Array.isArray(sessionJson?.messages) && sessionJson.messages.some((m) => m?.role === "user"), "user message missing after reload");
  const { res: resultRes, json: resultJson } = await pollResult(sessionId, messageId);
  assert(resultRes.status === 200, `poll status ${resultRes.status}`);
  expectStructuredAnswer(resultJson, "reload_processing");
  return { question };
}

async function scenarioAmbiguousRetry() {
  const question = pickQuestion();
  const sessionId = await createSession();
  const clientMessageId = crypto.randomUUID();
  const first = await submit(sessionId, question, { clientMessageId });
  assert(first.res.status === 202, `first submit status ${first.res.status}`);
  await sleep(800);
  const retry = await submit(sessionId, question, { clientMessageId });
  assert(retry.res.status === 200 || retry.res.status === 202, `retry status ${retry.res.status}`);
  assert(retry.json?.message_id === clientMessageId, "retry changed message_id");
  const { res: resultRes, json: resultJson } = await pollResult(sessionId, clientMessageId);
  assert(resultRes.status === 200, `poll status ${resultRes.status}`);
  expectStructuredAnswer(resultJson, "ambiguous_retry");
  return { question };
}

async function scenarioBackgroundReturn() {
  const question = pickDetailedQuestion();
  const sessionId = await createSession();
  const { res, messageId } = await submit(sessionId, question);
  assert(res.status === 202, `submit status ${res.status}`);
  await interruptAndCaptureCursor(sessionId, messageId);
  await sleep(2_000);
  const { res: resultRes, json: resultJson } = await pollResult(sessionId, messageId);
  assert(resultRes.status === 200, `poll status ${resultRes.status}`);
  expectStructuredAnswer(resultJson, "background_return");
  return { question };
}

async function scenarioTwoTabs() {
  const question = pickQuestion();
  const sessionId = await createSession();
  const { res, messageId } = await submit(sessionId, question);
  assert(res.status === 202, `submit status ${res.status}`);
  await sleep(500);
  const [a, b] = await Promise.all([
    readStream(sessionId, messageId),
    readStream(sessionId, messageId),
  ]);
  assert(a.events.length > 0 && b.events.length > 0, "empty stream in one tab");
  assert(JSON.stringify(a.events.map((e) => e.type)) === JSON.stringify(b.events.map((e) => e.type)), "stream event types diverged");
  expectStructuredAnswer({ status: "done", ...a.finalPayload }, "two_tabs_a");
  expectStructuredAnswer({ status: "done", ...b.finalPayload }, "two_tabs_b");
  assert(a.finalPayload.answer === b.finalPayload.answer, "tab answers diverged");
  return { question };
}

async function scenarioParallelPair() {
  const questionA = pickQuestion();
  const questionB = pickDetailedQuestion();
  const questionC = pickQuestion();

  const runnerA = async () => {
    const sessionId = await createSession();
    const { res, messageId } = await submit(sessionId, questionA);
    assert(res.status === 202, `parallel A submit status ${res.status}`);
    const { res: resultRes, json: resultJson } = await pollResult(sessionId, messageId);
    assert(resultRes.status === 200, `parallel A poll status ${resultRes.status}`);
    expectStructuredAnswer(resultJson, "parallel_a");
  };

  const runnerB = async () => {
    const sessionId = await createSession();
    const { res, messageId } = await submit(sessionId, questionB);
    assert(res.status === 202, `parallel B submit status ${res.status}`);
    const cursorId = await interruptAndCaptureCursor(sessionId, messageId);
    const { events, finalPayload } = await readStream(sessionId, messageId, { lastEventId: cursorId });
    assert(events.some((e) => e.type === "final"), "parallel B reconnect missing final event");
    expectStructuredAnswer({ status: "done", ...finalPayload }, "parallel_b");
  };

  const runners = [runnerA(), runnerB()];

  if (CONCURRENCY >= 3) {
    runners.push((async () => {
      const sessionId = await createSession();
      const { res, messageId } = await submit(sessionId, questionC);
      assert(res.status === 202, `parallel C submit status ${res.status}`);
      await sleep(1_000);
      const { res: resultRes, json: resultJson } = await pollResult(sessionId, messageId);
      assert(resultRes.status === 200, `parallel C poll status ${resultRes.status}`);
      expectStructuredAnswer(resultJson, "parallel_c");
    })());
  }

  await Promise.all(runners);
  const used = CONCURRENCY >= 3
    ? `${shortQuestion(questionA)} | ${shortQuestion(questionB)} | ${shortQuestion(questionC)}`
    : `${shortQuestion(questionA)} | ${shortQuestion(questionB)}`;
  return { question: used };
}

async function scenarioRestartAfterCompletion(serviceManager) {
  const question = pickQuestion();
  const sessionId = await createSession();
  const { res, messageId } = await submit(sessionId, question);
  assert(res.status === 202, `submit status ${res.status}`);
  const first = await pollResult(sessionId, messageId);
  assert(first.res.status === 200, `poll status ${first.res.status}`);
  expectStructuredAnswer(first.json, "restart_before");
  const originalAnswer = first.json.answer;
  await serviceManager.restart();
  const after = await get(`/v1/chat/sessions/${sessionId}/messages/${messageId}/result`);
  assert(after.res.status === 200, `after restart status ${after.res.status}`);
  expectStructuredAnswer(after.json, "restart_after");
  assert(after.json.answer === originalAnswer, "answer changed after restart");
  return { question };
}

function printCaseResult(result) {
  const status = result.ok ? PASS : FAIL;
  const duration = `${(result.ms / 1000).toFixed(1)}s`;
  process.stdout.write(
    `${result.id.padEnd(4)}  ${result.name.padEnd(34)}  ${duration.padStart(6)}  ${status}  ${result.question || "—"}\n`
  );
  if (!result.ok && result.extra) {
    process.stdout.write(`      \x1b[31m↳ ${result.extra}\x1b[0m\n`);
  }
}

async function main() {
  console.log(`\n\x1b[1mCatalogueSearch-Chat Live Resilience Suite\x1b[0m`);
  console.log(`Chat service: ${BASE}`);
  console.log(`Backend service: ${BACKEND_URL}`);
  console.log(`Seed: ${SEED}`);
  console.log(`Parallel sessions: ${CONCURRENCY}\n`);

  process.stdout.write("Checking backend health...");
  const backendHealthy = await waitForBackend(20_000);
  if (!backendHealthy) {
    console.log(` \x1b[31mFAIL\x1b[0m`);
    console.log(`Backend not reachable at ${BACKEND_URL}`);
    process.exit(1);
  }
  console.log(` \x1b[32mOK\x1b[0m`);

  const serviceManager = new ChatServiceManager();
  process.stdout.write("Starting chat service via npm start...");
  await serviceManager.start();
  console.log(` \x1b[32mOK\x1b[0m\n`);

  const plannedQueries = CASES.reduce((sum, item) => {
    if (item.id === "L8") return sum + (CONCURRENCY >= 3 ? 3 : 2);
    return sum + item.queries;
  }, 0);
  console.log(`Planned user journeys: ${CASES.length}`);
  console.log(`Planned real queries: ${plannedQueries}\n`);

  const results = [];
  try {
    results.push(await runCase(CASES[0], scenarioNormalReload));
    results.push(await runCase(CASES[1], scenarioDisconnectPoll));
    results.push(await runCase(CASES[2], scenarioMidStreamReconnect));
    results.push(await runCase(CASES[3], scenarioReloadWhileProcessing));
    results.push(await runCase(CASES[4], scenarioAmbiguousRetry));
    results.push(await runCase(CASES[5], scenarioBackgroundReturn));
    results.push(await runCase(CASES[6], scenarioTwoTabs));
    results.push(await runCase(CASES[7], scenarioParallelPair));
    results.push(await runCase(CASES[8], () => scenarioRestartAfterCompletion(serviceManager)));
  } finally {
    await serviceManager.stop();
  }

  console.log(`\n${"─".repeat(118)}`);
  console.log("\x1b[1mLive Test Report\x1b[0m");
  console.log(`${"─".repeat(118)}`);
  console.log(
    [
      "Case".padEnd(4),
      "Scenario".padEnd(34),
      "Time".padStart(6),
      "Result".padEnd(6),
      "Question",
    ].join("  ")
  );
  console.log(`${"─".repeat(118)}`);
  for (const result of results) printCaseResult(result);
  console.log(`${"─".repeat(118)}`);

  const failed = results.filter((result) => !result.ok);
  const passed = results.length - failed.length;
  if (failed.length > 0) {
    console.log(`\n\x1b[31m✗ ${failed.length} / ${results.length} journeys failed\x1b[0m`);
    process.exit(1);
  }
  console.log(`\n\x1b[32m✓ All ${results.length} live journeys passed (${plannedQueries} real queries)\x1b[0m`);
  console.log(`\x1b[2mApproximate total confidence path: real backend + real provider + user interruption flows\x1b[0m\n`);
}

main().catch((err) => {
  console.error("\nUnexpected fatal error:", err);
  process.exit(1);
});
