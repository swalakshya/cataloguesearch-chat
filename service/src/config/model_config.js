const TEST_MODE = String(process.env.TEST_MODE || "").toLowerCase() === "true";

function readNumber(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export const MODEL_ROUTING_CONFIG = {
  windowMs: TEST_MODE
    ? readNumber(process.env.TEST_WINDOW_MS, 15 * 60 * 1000)
    : 15 * 60 * 1000,
  failureRateThreshold: TEST_MODE
    ? readNumber(process.env.TEST_FAILURE_RATE_THRESHOLD, 0.10)
    : 0.10,
  minSamples: TEST_MODE
    ? readNumber(process.env.TEST_MIN_SAMPLES, 20)
    : 20,
  workflowDefaults: {
    basic: {
      page: 1,
      page_size: 15,
      rerank: true,
      referenceCount: 2,
    },
    followup: {
      page: 1,
      page_size: 10,
      rerank: true,
      navigate_steps: 3,
      navigate_direction: "both",
      expand_limit: 10,
      referenceCount: 5,
    },
    advanced_distinct: {
      page: 1,
      page_size: 10,
      rerank: true,
      referenceCount: 5,
    },
    advanced_nested: {
      page: 1,
      page_size: 10,
      rerank: true,
      referenceCount: 5,
    },
  },
  models: [
    {
      id: "gemini-2.5-flash",
      provider: "gemini",
      priority: 3,
      workflowOverrides: {},
    },
    {
      id: "gemini-3-flash-preview",
      provider: "gemini",
      priority: 1,
      workflowOverrides: {},
    },
    {
      id: "gpt-4o",
      provider: "openai",
      priority: 2,
      workflowOverrides: {
        basic: {
          page_size: 7,
        },
        followup: {
          page_size: 5,
          navigate_steps: 2,
          expand_limit: 5,
        },
        advanced_distinct: {
          page_size: 7,
        },
        advanced_nested: {
          page_size: 7,
        },
      },
    },
  ],
};
