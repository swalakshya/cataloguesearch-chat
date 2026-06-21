const behaviorByModel = new Map();
const callCounts = new Map();

export function setTestProviderBehavior(behaviorMap) {
  behaviorByModel.clear();
  for (const [modelId, behavior] of Object.entries(behaviorMap || {})) {
    behaviorByModel.set(modelId, behavior);
  }
}

export function resetTestProviderStats() {
  callCounts.clear();
}

export function getTestProviderStats() {
  const stats = {};
  for (const [modelId, count] of callCounts.entries()) {
    stats[modelId] = count;
  }
  return stats;
}

function wrapTestResult(text) {
  return {
    text,
    usage_raw: {},
    usage_normalized: {
      input_tokens: 10,
      output_tokens: 5,
      total_tokens: 15,
      cached_input_tokens: 0,
      thought_tokens: null,
    },
    provider_response_id: "test-response-id",
    model_version: "test-model-v1",
  };
}

class TestProvider {
  constructor({ modelId, behavior }) {
    this.modelId = modelId;
    this.behavior = behavior || "success";
  }

  name() {
    return "test";
  }

  async completeJson({ messages }) {
    callCounts.set(this.modelId, (callCounts.get(this.modelId) || 0) + 1);
    const system = String(messages?.[0]?.content || "").toLowerCase();
    if (system.includes("keyword extractor")) {
      const userContent = String(messages?.[1]?.content || "");
      const forceFollowup = userContent.includes("FORCE_FOLLOWUP");

      // KB integration test triggers: include Devanagari keywords so
      // applyJainPartitionDefaults sets jain_keywords automatically.
      if (userContent.includes("JAIN_QUESTION")) {
        return wrapTestResult(JSON.stringify({
          language: "hi",
          script: "roman",
          workflow: "basic_question_v1",
          is_followup: false,
          keywords: ["आत्मा", "definition"],
          jain_keywords: ["आत्मा"],
          normal_keywords: ["definition"],
          kb_subworkflows: null,
          kb_entities: { shastra_hints: [], author_hints: [] },
          filters: {},
        }));
      }

      // Direct retrieval sub-workflow trigger
      if (userContent.includes("DIRECT_RETRIEVAL_QUESTION")) {
        return wrapTestResult(JSON.stringify({
          language: "hi",
          script: "roman",
          workflow: "basic_question_v1",
          is_followup: false,
          keywords: ["समयसार"],
          jain_keywords: ["समयसार"],
          normal_keywords: [],
          kb_subworkflows: [{ name: "direct_retrieval", shastra: "samaysaar", gatha_number: 6, want: null, topic: null }],
          kb_entities: { shastra_hints: ["samaysaar"], author_hints: [] },
          filters: {},
        }));
      }

      return wrapTestResult(JSON.stringify({
        language: "hi",
        script: "roman",
        workflow: "basic_question_v1",
        is_followup: forceFollowup,
        keywords: ["q"],
        jain_keywords: [],
        normal_keywords: ["q"],
        kb_subworkflows: null,
        kb_entities: null,
        filters: {},
      }));
    }
    if (system.includes("you map filter values")) {
      return wrapTestResult(JSON.stringify({ granth: "", anuyog: "", contributor: "" }));
    }
    if (this.behavior === "server_error") {
      const err = new Error("Service Unavailable");
      err.status = 503;
      throw err;
    }
    if (this.behavior === "rate_limited") {
      const err = new Error("Too Many Requests");
      err.status = 429;
      throw err;
    }
    if (this.behavior === "client_error") {
      const err = new Error("Unauthorized");
      err.status = 401;
      throw err;
    }
    if (this.behavior === "no_answer") {
      return wrapTestResult(JSON.stringify({
        answer_status: "no_answer",
        answer: "किसी उपलब्ध संदर्भ में इसका स्पष्ट उत्तर नहीं मिला।",
        scoring: [],
      }));
    }
    if (this.behavior === "no_answer_empty") {
      return wrapTestResult(JSON.stringify({
        answer_status: "no_answer",
        answer: "",
        scoring: [],
      }));
    }
    if (this.behavior === "no_answer_malformed") {
      return wrapTestResult(JSON.stringify({
        answer_status: "no_answer",
        answer: "किसी उपलब्ध संदर्भ में इसका स्पष्ट उत्तर नहीं मिला।\n\n_If you want I can answer this in detail or I can also answer -_\n- q1",
        scoring: [{ chunk_id: "c1", score: 91 }],
      }));
    }
    const userContent = String(messages?.[1]?.content || "");
    // Echo any KB citation ids present in the Step2 context into `scoring`, so
    // integration tests exercise the KB source_url reference-merge deterministically.
    const kbScoring = Array.from(
      new Set((userContent.match(/KB-[TD]-\d+/g) || []))
    ).map((id) => ({ chunk_id: id, score: 80 }));
    if (userContent.includes('"follow_up_questions"')) {
      return wrapTestResult(JSON.stringify({ answer_status: "answered", answer: "test-answer", follow_up_questions: ["q1", "q2"], scoring: kbScoring }));
    }
    return wrapTestResult(JSON.stringify({
      answer_status: "answered",
      answer: "test-answer\n\n_If you want I can answer this in detail or I can also answer -_\n- q1\n- q2",
      scoring: kbScoring,
    }));
  }

  async completeText({ messages }) {
    const system = String(messages?.[0]?.content || "").toLowerCase();
    if (system.includes("summarizer")) return wrapTestResult("test-summary");
    return wrapTestResult("test");
  }
}

export function buildTestProviderFactory() {
  return {
    async getProvider({ modelId }) {
      const behavior = behaviorByModel.get(modelId) || "success";
      return new TestProvider({ modelId, behavior });
    },
  };
}
