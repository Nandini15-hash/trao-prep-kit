import { Coverage, Question, Requirement } from "@trao/shared";

/**
 * Section 3/4: comparing generated questions against extracted
 * requirements to find what's not covered is "your code's decision to
 * make, not the model's" — this is pure, deterministic, and has no LLM
 * involvement anywhere in it.
 *
 * A requirement counts as covered if at least one question's
 * requirement_ids references it. Only must-have requirements are
 * "gaps" in the sense that forces another generation pass (Section 4:
 * "any requirement with no question against it comes back as a gap") —
 * a nice-to-have with no question is not a failure, but is still worth
 * surfacing, so it's returned separately rather than silently dropped.
 */
export function findUncoveredRequirementIds(
  requirements: Requirement[],
  questions: Question[]
): { mustHaveGaps: string[]; niceToHaveGaps: string[] } {
  const covered = new Set(questions.flatMap((q) => q.requirement_ids));
  const mustHaveGaps: string[] = [];
  const niceToHaveGaps: string[] = [];

  for (const req of requirements) {
    if (covered.has(req.id)) continue;
    if (req.priority === "must") mustHaveGaps.push(req.id);
    else niceToHaveGaps.push(req.id);
  }

  return { mustHaveGaps, niceToHaveGaps };
}

export function buildCoverage(
  requirements: Requirement[],
  questions: Question[],
  passes: number
): Coverage {
  const { mustHaveGaps } = findUncoveredRequirementIds(requirements, questions);
  return { uncovered_requirement_ids: mustHaveGaps, passes };
}
