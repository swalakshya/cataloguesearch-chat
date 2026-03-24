import { runBasicQuestion } from "./workflows/basic_question_v1.js";
import { runFollowupQuestion } from "./workflows/followup_question_v1.js";
import { runAdvancedDistinctQuestions } from "./workflows/advanced_distinct_questions_v1.js";
import { runAdvancedNestedQuestions } from "./workflows/advanced_nested_questions_v1.js";

export const workflowRegistry = {
  basic_question_v1: runBasicQuestion,
  followup_question_v1: runFollowupQuestion,
  advanced_distinct_questions_v1: runAdvancedDistinctQuestions,
  advanced_nested_questions_v1: runAdvancedNestedQuestions,
};
