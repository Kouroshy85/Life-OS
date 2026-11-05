import { t } from "../../i18n";
import type { RequestKind } from "./context";

export type QuickPromptId = "week" | "goal" | "exam" | "day" | "overwhelmed" | "review";

export interface QuickPrompt {
  id: QuickPromptId;
  kind: RequestKind;
  label: () => string;
  /** The message sent for the user, in the app's language. */
  message: () => string;
}

/** The six starting points. All of them go through the same conversation as typed messages. */
export const QUICK_PROMPTS: QuickPrompt[] = [
  { id: "week", kind: "week", label: () => t.qpWeek, message: () => t.qpWeekMsg },
  { id: "goal", kind: "goal", label: () => t.qpGoal, message: () => t.qpGoalMsg },
  { id: "exam", kind: "study", label: () => t.qpExam, message: () => t.qpExamMsg },
  { id: "day", kind: "day", label: () => t.qpDay, message: () => t.qpDayMsg },
  { id: "overwhelmed", kind: "overwhelmed", label: () => t.qpOverwhelmed, message: () => t.qpOverwhelmedMsg },
  { id: "review", kind: "review", label: () => t.qpReview, message: () => t.qpReviewMsg },
];
