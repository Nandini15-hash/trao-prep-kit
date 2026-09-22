import { describe, expect, it } from "vitest";
import { Question, Requirement } from "@trao/shared";
import { findUncoveredRequirementIds, buildCoverage } from "../services/generation/coverage";

const requirements: Requirement[] = [
  { id: "r1", text: "5+ years React", kind: "technical", priority: "must" },
  { id: "r2", text: "Mentoring", kind: "behavioural", priority: "nice" },
  { id: "r3", text: "Payments domain knowledge", kind: "domain", priority: "must" },
];

function q(id: string, requirement_ids: string[]): Question {
  return {
    id,
    requirement_ids,
    category: "technical",
    prompt: `prompt ${id}`,
    answer_outline: "outline",
    difficulty: 2,
  };
}

describe("findUncoveredRequirementIds", () => {
  it("finds no gaps when every requirement has at least one question", () => {
    const questions = [q("q1", ["r1"]), q("q2", ["r2"]), q("q3", ["r3"])];
    const { mustHaveGaps, niceToHaveGaps } = findUncoveredRequirementIds(requirements, questions);
    expect(mustHaveGaps).toEqual([]);
    expect(niceToHaveGaps).toEqual([]);
  });

  it("flags an uncovered must-have requirement as a gap", () => {
    const questions = [q("q1", ["r1"]), q("q2", ["r2"])]; // r3 (must) uncovered
    const { mustHaveGaps } = findUncoveredRequirementIds(requirements, questions);
    expect(mustHaveGaps).toEqual(["r3"]);
  });

  it("separates uncovered nice-to-haves from must-have gaps", () => {
    const questions = [q("q1", ["r1"]), q("q3", ["r3"])]; // r2 (nice) uncovered
    const { mustHaveGaps, niceToHaveGaps } = findUncoveredRequirementIds(requirements, questions);
    expect(mustHaveGaps).toEqual([]);
    expect(niceToHaveGaps).toEqual(["r2"]);
  });

  it("counts a requirement covered even if its question also covers others", () => {
    const questions = [q("q1", ["r1", "r3"])];
    const { mustHaveGaps } = findUncoveredRequirementIds(requirements, questions);
    expect(mustHaveGaps).toEqual([]);
  });
});

describe("buildCoverage", () => {
  it("reports only must-have gaps in uncovered_requirement_ids, and records the pass count", () => {
    const questions = [q("q1", ["r1"])]; // r2 (nice) and r3 (must) uncovered
    const coverage = buildCoverage(requirements, questions, 2);
    expect(coverage.uncovered_requirement_ids).toEqual(["r3"]);
    expect(coverage.passes).toBe(2);
  });

  it("reports an empty gap list once everything must-have is covered", () => {
    const questions = [q("q1", ["r1"]), q("q2", ["r3"])];
    const coverage = buildCoverage(requirements, questions, 1);
    expect(coverage.uncovered_requirement_ids).toEqual([]);
  });
});
