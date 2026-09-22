import { describe, expect, it } from "vitest";
import { Requirement } from "@trao/shared";
import { detectHiringSignals } from "../services/generation/hiring-signals";
import { planCategoryAssignments, shouldGenerateCompanyFit } from "../services/generation/plan-categories";

describe("detectHiringSignals", () => {
  it("detects a system design round from hiring-page text", () => {
    const signals = detectHiringSignals("Our process: a take-home, then a system design interview.");
    expect(signals.mentionsSystemDesign).toBe(true);
    expect(signals.mentionsTakeHome).toBe(true);
  });

  it("reports no signals for a page that says nothing about process", () => {
    const signals = detectHiringSignals("We build great products for great teams.");
    expect(signals.mentionsSystemDesign).toBe(false);
    expect(signals.mentionsTakeHome).toBe(false);
    expect(signals.mentionsBehaviouralRound).toBe(false);
    expect(signals.mentionsOnsitePanel).toBe(false);
  });

  it("combines multiple text sources (hiring page + search snippets)", () => {
    const signals = detectHiringSignals("Nothing here.", "Glassdoor review: onsite panel of 4 interviews.");
    expect(signals.mentionsOnsitePanel).toBe(true);
  });
});

function req(id: string, kind: Requirement["kind"], priority: Requirement["priority"]): Requirement {
  return { id, text: `req ${id}`, kind, priority };
}

describe("planCategoryAssignments", () => {
  const noSignals = { mentionsSystemDesign: false, mentionsTakeHome: false, mentionsBehaviouralRound: false, mentionsOnsitePanel: false };

  it("routes behavioural requirements to the behavioural category only", () => {
    const plan = planCategoryAssignments([req("r1", "behavioural", "must")], noSignals, "Mid-level");
    expect(plan.behavioural.map((r) => r.id)).toEqual(["r1"]);
    expect(plan.technical).toEqual([]);
    expect(plan["system-design"]).toEqual([]);
  });

  it("routes technical and domain requirements to the technical category", () => {
    const plan = planCategoryAssignments(
      [req("r1", "technical", "must"), req("r2", "domain", "nice")],
      noSignals,
      "Mid-level"
    );
    expect(plan.technical.map((r) => r.id).sort()).toEqual(["r1", "r2"]);
  });

  it("adds a must-have technical requirement to system-design when the hiring page signals it", () => {
    const signals = { ...noSignals, mentionsSystemDesign: true };
    const plan = planCategoryAssignments([req("r1", "technical", "must")], signals, "Mid-level");
    expect(plan["system-design"].map((r) => r.id)).toEqual(["r1"]);
  });

  it("adds a must-have technical requirement to system-design for a senior role even with no explicit signal", () => {
    const plan = planCategoryAssignments([req("r1", "technical", "must")], noSignals, "Senior");
    expect(plan["system-design"].map((r) => r.id)).toEqual(["r1"]);
  });

  it("does not add system-design for a nice-to-have requirement, even for a senior role", () => {
    const plan = planCategoryAssignments([req("r1", "technical", "nice")], noSignals, "Senior");
    expect(plan["system-design"]).toEqual([]);
  });

  it("does not default a junior/mid role with no signal into system-design", () => {
    const plan = planCategoryAssignments([req("r1", "technical", "must")], noSignals, "Junior");
    expect(plan["system-design"]).toEqual([]);
  });
});

describe("shouldGenerateCompanyFit", () => {
  it("skips company-fit questions when there's essentially nothing to work with", () => {
    expect(shouldGenerateCompanyFit("")).toBe(false);
    expect(shouldGenerateCompanyFit("A company.")).toBe(false);
  });

  it("generates company-fit questions once there's real brief content", () => {
    expect(
      shouldGenerateCompanyFit(
        "Acme builds developer tools for distributed teams and has been operating since 2019 with a strong focus on reliability."
      )
    ).toBe(true);
  });
});
