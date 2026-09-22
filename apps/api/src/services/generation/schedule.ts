import { Question, Requirement, Schedule, ScheduleDay } from "@trao/shared";

/**
 * Section 8: "This is arithmetic and allocation. It belongs in your
 * code, not in a prompt." Entirely deterministic — no LLM call anywhere
 * in this file.
 *
 * Design (documented here and in the README, since the brief leaves the
 * exact minutes-per-question convention open):
 *   minutes(question) = 15 * difficulty   (20/30/45 for difficulty 1/2/3)
 * reflecting that a harder question needs more prep time, not just that
 * it's worth more "points". Questions are sorted must-have-first, then
 * hardest-first, then by id for a stable order, and split into
 * days_available contiguous chunks in that order — so day 1 always gets
 * the hardest and most must-have-heavy material, and difficulty trends
 * down as the days go on ("harder and higher-priority material lands
 * earlier, not the night before"). Every question that exists is placed
 * on exactly one day; none are dropped, since Section 8 says the
 * application "distributes the material across exactly that many days",
 * not a subset of it.
 *
 * If there are more days than questions (Section 10's "the user asks for
 * ... a 60-day one" with a modest question bank), the leftover days get
 * an empty, honestly-labelled review slot rather than invented content.
 */

function minutesForQuestion(q: Question): number {
  return 15 * q.difficulty;
}

function questionPriorityWeight(q: Question, mustHaveIds: Set<string>): number {
  return q.requirement_ids.some((id) => mustHaveIds.has(id)) ? 1 : 0;
}

function focusForQuestions(questions: Question[]): string {
  if (questions.length === 0) return "Review & practice flashcards";
  const categories = [...new Set(questions.map((q) => q.category))];
  return categories
    .map((c) => c.replace("-", " "))
    .map((c) => c.charAt(0).toUpperCase() + c.slice(1))
    .join(" + ");
}

export function allocateSchedule(
  requirements: Requirement[],
  questions: Question[],
  daysAvailable: number
): Schedule {
  const mustHaveIds = new Set(requirements.filter((r) => r.priority === "must").map((r) => r.id));

  const sorted = [...questions].sort((a, b) => {
    const priorityDiff = questionPriorityWeight(b, mustHaveIds) - questionPriorityWeight(a, mustHaveIds);
    if (priorityDiff !== 0) return priorityDiff;
    const difficultyDiff = b.difficulty - a.difficulty;
    if (difficultyDiff !== 0) return difficultyDiff;
    return a.id.localeCompare(b.id);
  });

  const days: ScheduleDay[] = [];
  const total = sorted.length;

  for (let day = 1; day <= daysAvailable; day++) {
    const startIdx = Math.floor(((day - 1) * total) / daysAvailable);
    const endIdx = Math.floor((day * total) / daysAvailable);
    const dayQuestions = sorted.slice(startIdx, endIdx);

    days.push({
      day,
      focus: focusForQuestions(dayQuestions),
      question_ids: dayQuestions.map((q) => q.id),
      minutes: dayQuestions.reduce((sum, q) => sum + minutesForQuestion(q), 0),
    });
  }

  return { days_available: daysAvailable, days };
}
