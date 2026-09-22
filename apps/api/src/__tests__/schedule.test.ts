import { describe, expect, it } from "vitest";
import { Question, Requirement } from "@trao/shared";
import { allocateSchedule } from "../services/generation/schedule";

function req(id: string, priority: "must" | "nice"): Requirement {
  return { id, text: `requirement ${id}`, kind: "technical", priority };
}

function q(id: string, requirement_ids: string[], difficulty: 1 | 2 | 3, category = "technical"): Question {
  return {
    id,
    requirement_ids,
    category: category as Question["category"],
    prompt: `prompt ${id}`,
    answer_outline: "outline",
    difficulty,
  };
}

describe("allocateSchedule", () => {
  const requirements = [req("r1", "must"), req("r2", "must"), req("r3", "nice")];
  const questions = [
    q("q1", ["r1"], 3),
    q("q2", ["r2"], 3),
    q("q3", ["r3"], 1),
    q("q4", ["r1"], 2),
    q("q5", ["r2"], 1),
    q("q6", ["r3"], 2),
  ];

  it("produces exactly days_available days", () => {
    const schedule = allocateSchedule(requirements, questions, 3);
    expect(schedule.days_available).toBe(3);
    expect(schedule.days).toHaveLength(3);
    expect(schedule.days.map((d) => d.day)).toEqual([1, 2, 3]);
  });

  it("places every question exactly once, dropping none", () => {
    const schedule = allocateSchedule(requirements, questions, 3);
    const scheduledIds = schedule.days.flatMap((d) => d.question_ids);
    expect(scheduledIds.sort()).toEqual(questions.map((q) => q.id).sort());
    expect(new Set(scheduledIds).size).toBe(scheduledIds.length); // no duplicates
  });

  it("represents every must-have requirement somewhere in the schedule", () => {
    const schedule = allocateSchedule(requirements, questions, 3);
    const scheduledQuestionIds = new Set(schedule.days.flatMap((d) => d.question_ids));
    const scheduledQuestions = questions.filter((q) => scheduledQuestionIds.has(q.id));
    const coveredReqIds = new Set(scheduledQuestions.flatMap((q) => q.requirement_ids));
    for (const r of requirements.filter((r) => r.priority === "must")) {
      expect(coveredReqIds.has(r.id)).toBe(true);
    }
  });

  it("front-loads must-have and harder material rather than saving it for the last day", () => {
    const schedule = allocateSchedule(requirements, questions, 3);
    const byId = new Map(questions.map((q) => [q.id, q]));
    const avgDifficulty = (ids: string[]) =>
      ids.length === 0 ? 0 : ids.reduce((sum, id) => sum + byId.get(id)!.difficulty, 0) / ids.length;

    const day1Avg = avgDifficulty(schedule.days[0].question_ids);
    const lastDayAvg = avgDifficulty(schedule.days[schedule.days.length - 1].question_ids);
    expect(day1Avg).toBeGreaterThanOrEqual(lastDayAvg);

    // The single hardest question (q1, difficulty 3, must-have) should land on day 1.
    expect(schedule.days[0].question_ids).toContain("q1");
  });

  it("uses integer minutes derived from difficulty", () => {
    const schedule = allocateSchedule(requirements, questions, 3);
    for (const day of schedule.days) {
      expect(Number.isInteger(day.minutes)).toBe(true);
      expect(day.minutes).toBeGreaterThanOrEqual(0);
    }
  });

  it("puts everything on day 1 for a 1-day schedule", () => {
    const schedule = allocateSchedule(requirements, questions, 1);
    expect(schedule.days).toHaveLength(1);
    expect(schedule.days[0].question_ids.sort()).toEqual(questions.map((q) => q.id).sort());
  });

  it("gives an honest empty review slot to days beyond what the material fills (60-day case)", () => {
    const schedule = allocateSchedule(requirements, questions, 60);
    expect(schedule.days).toHaveLength(60);
    const totalScheduled = schedule.days.flatMap((d) => d.question_ids).length;
    expect(totalScheduled).toBe(questions.length);
    const emptyDays = schedule.days.filter((d) => d.question_ids.length === 0);
    expect(emptyDays.length).toBeGreaterThan(0);
    for (const day of emptyDays) {
      expect(day.minutes).toBe(0);
      expect(day.focus).toMatch(/review/i);
    }
  });

  it("handles zero questions without throwing (e.g. a company/JD we could find nothing for)", () => {
    const schedule = allocateSchedule(requirements, [], 5);
    expect(schedule.days).toHaveLength(5);
    for (const day of schedule.days) {
      expect(day.question_ids).toEqual([]);
      expect(day.minutes).toBe(0);
    }
  });
});
