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

    const system = String(messages?.[0]?.content || "").toLowerCase();
    if (system.includes("keyword extractor")) {
      const userContent = String(messages?.[1]?.content || "");
      const forceFollowup = userContent.includes("FORCE_FOLLOWUP");
      return JSON.stringify({
        language: "hi",
        script: "roman",
        workflow: "basic_question_v1",
        is_followup: forceFollowup,
        keywords: ["q"],
        filters: {},
      });
    }
    if (system.includes("you map filter values")) {
      return JSON.stringify({ granth: "", anuyog: "", contributor: "" });
    }
    const userContent = String(messages?.[1]?.content || "");
    if (userContent.includes('"follow_up_questions"')) {
      return JSON.stringify({ answer: "test-answer", follow_up_questions: ["q1", "q2"], scoring: [] });
    }
    return JSON.stringify({
      answer: "test-answer\n\n_If you want I can answer this in detail or I can also answer -_\n- q1\n- q2",
      scoring: [],
    });
  }

  async completeText({ messages }) {
    const system = String(messages?.[0]?.content || "").toLowerCase();
    if (system.includes("summarizer")) return "test-summary";
    return "test";
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
