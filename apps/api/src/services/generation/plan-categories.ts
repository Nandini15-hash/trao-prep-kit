import { Requirement } from "@trao/shared";
import { HiringSignals } from "./hiring-signals";

export type RequirementCategory = "technical" | "behavioural" | "system-design";

const SENIOR_PATTERN = /senior|staff|principal|lead|architect/i;

/**
 * Section 3: "a requirement like five years of React leads to technical
 * questions while mentoring junior engineers leads to behavioural ones;
 * the two should not come from the same call with the same
 * instructions." This is the code that decides, per requirement, which
 * category (or categories) of question to generate for it — a call to
 * the model is always scoped to one category, never "generate
 * everything".
 *
 * "domain" requirements map to the technical category: applying
 * domain-specific knowledge (payments regulation, healthcare compliance)
 * is assessed the same way a technical skill is — through a concrete
 * scenario question — and Appendix A's question category enum has no
 * separate "domain" value.
 *
 * A must-have technical requirement additionally gets a system-design
 * question when the hiring page or public discussion actually mentions a
 * system-design round, or — absent any signal either way — when the role
 * itself is senior enough that architecture questions are standard
 * (Section 3's "the two should not come from the same call" cuts both
 * ways: this must not default to "always generate system-design", or a
 * thin/junior posting gets a kit it doesn't need).
 */
export function planCategoryAssignments(
  requirements: Requirement[],
  signals: HiringSignals,
  seniority: string
): Record<RequirementCategory, Requirement[]> {
  const plan: Record<RequirementCategory, Requirement[]> = {
    technical: [],
    behavioural: [],
    "system-design": [],
  };

  const isSenior = SENIOR_PATTERN.test(seniority);

  for (const req of requirements) {
    if (req.kind === "behavioural") {
      plan.behavioural.push(req);
      continue;
    }

    // technical or domain
    plan.technical.push(req);
    const wantsSystemDesign = req.priority === "must" && (signals.mentionsSystemDesign || isSenior);
    if (wantsSystemDesign) {
      plan["system-design"].push(req);
    }
  }

  return plan;
}

/**
 * Whether a company-fit question round is worth generating at all —
 * Section 10: a company we can find nothing about "should produce an
 * honest brief rather than a fabricated one", and that extends to not
 * inventing company-fit questions from a company_brief that's
 * essentially empty.
 */
export function shouldGenerateCompanyFit(companyBriefText: string): boolean {
  return companyBriefText.trim().length >= 80;
}
