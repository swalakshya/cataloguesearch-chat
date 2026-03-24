import { getAnswerPrompt, getWorkflowGuidelines } from "./prompts.js";
import { log } from "../utils/log.js";

export async function runAnswerSynthesis({
  provider,
  question,
  workflowName,
  context,
  requestId,
}) {
  const guidelines = getWorkflowGuidelines(workflowName);
  const prompt = getAnswerPrompt(question, context, guidelines);

  const messages = [
    { role: "system", content: "You are a Jain texts scholar." },
    { role: "user", content: prompt },
  ];

  const answer = await provider.completeText({
    messages,
    temperature: Number(process.env.LLM_TEMPERATURE || 0.75),
    requestId,
  });

  // Logged at info to correlate with downstream response parsing.
  // Avoid logging full answer to keep logs manageable.
  log.info("answer_synthesis_llm_response", {
    requestId,
    length: answer?.length || 0,
    preview: String(answer || "").slice(0, 500),
  });

  return answer;
}
