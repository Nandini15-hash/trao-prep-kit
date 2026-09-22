import { describe, expect, it, vi, beforeEach } from "vitest";
import { generateKit } from "../services/generation/pipeline";

const {
  crawlCompanySiteMock,
  searchMock,
  extractRequirementsMock,
  generateCompanyBriefMock,
  generateQuestionsForCategoryMock,
  generateCompanyFitQuestionsMock,
  generateFlashcardsMock,
} = vi.hoisted(() => ({
  crawlCompanySiteMock: vi.fn(),
  searchMock: vi.fn(),
  extractRequirementsMock: vi.fn(),
  generateCompanyBriefMock: vi.fn(),
  generateQuestionsForCategoryMock: vi.fn(),
  generateCompanyFitQuestionsMock: vi.fn(),
  generateFlashcardsMock: vi.fn(),
}));

vi.mock("../services/retrieval/crawler", () => ({ crawlCompanySite: crawlCompanySiteMock }));
vi.mock("../services/search/tavily", () => ({ searchPublicInterviewDiscussion: searchMock }));
vi.mock("../services/generation/extract-requirements", () => ({ extractRequirements: extractRequirementsMock }));
vi.mock("../services/generation/generate-company-brief", () => ({ generateCompanyBrief: generateCompanyBriefMock }));
vi.mock("../services/generation/generate-questions", () => ({
  generateQuestionsForCategory: generateQuestionsForCategoryMock,
}));
vi.mock("../services/generation/generate-company-fit-questions", () => ({
  generateCompanyFitQuestions: generateCompanyFitQuestionsMock,
}));
vi.mock("../services/generation/generate-flashcards", () => ({ generateFlashcards: generateFlashcardsMock }));

const R1 = { id: "r1", text: "5+ years React", kind: "technical" as const, priority: "must" as const };
const R2 = { id: "r2", text: "Payments domain knowledge", kind: "domain" as const, priority: "must" as const };
const R3 = { id: "r3", text: "Mentoring", kind: "behavioural" as const, priority: "nice" as const };

function baseMocks() {
  extractRequirementsMock.mockResolvedValue({
    title: "Senior Backend Engineer",
    seniority: "Senior",
    location: "Remote",
    responsibilities: ["Own the payments service"],
    requirements: [R1, R2, R3],
  });
  crawlCompanySiteMock.mockResolvedValue({
    pages: [{ url: "https://acme.example/", title: "Acme", text: "Acme builds payment infra.", links: [], hiringScore: 0, aboutScore: 1 }],
    aboutPage: { url: "https://acme.example/about", title: "About Acme", text: "Acme builds payment infrastructure for banks.", links: [], hiringScore: 0, aboutScore: 2 },
    hiringPage: { url: "https://acme.example/careers", title: "Careers", text: "We do a take-home then a system design round.", links: [], hiringScore: 2, aboutScore: 0 },
    skipped: [],
    failed: [],
  });
  searchMock.mockResolvedValue({ attempted: true, results: [] });
  generateCompanyBriefMock.mockResolvedValue({
    summary: "Acme builds payment infrastructure for banks and fintechs.",
    what_they_do: "They provide APIs for moving money between accounts.",
  });
  generateCompanyFitQuestionsMock.mockResolvedValue([
    { prompt: "Why Acme?", answer_outline: "...", difficulty: 1, requirement_ids: [] },
  ]);
  generateFlashcardsMock.mockResolvedValue([
    { front: "What is Acme's product?", back: "Payment APIs.", requirement_ids: ["r1"] },
  ]);
}

beforeEach(() => {
  vi.clearAllMocks();
  baseMocks();
});

describe("generateKit — full sequencing", () => {
  it("produces a fully-covered kit when the first generation pass covers everything", async () => {
    generateQuestionsForCategoryMock.mockImplementation(async ({ category, requirements }) => {
      return requirements.map((r: { id: string }) => ({
        requirement_ids: [r.id],
        prompt: `Question about ${r.id}`,
        answer_outline: "outline",
        difficulty: 2,
      }));
    });

    const kit = await generateKit({ jd: "some JD", companyUrl: "https://acme.example/", days: 5 });

    expect(kit.coverage.uncovered_requirement_ids).toEqual([]);
    expect(kit.coverage.passes).toBe(1);
    expect(kit.role.requirements).toHaveLength(3);
    expect(kit.schedule.days_available).toBe(5);
    expect(kit.schedule.days).toHaveLength(5);
    // system-design was requested for r1 (must, technical) — hiring page mentions it.
    expect(generateQuestionsForCategoryMock.mock.calls.some((c) => c[0].category === "system-design")).toBe(
      true
    );
    // every question id is unique and sequential
    expect(kit.questions.map((q) => q.id)).toEqual(kit.questions.map((_, i) => `q${i + 1}`));
  });

  it("runs a targeted second pass when a must-have requirement is left uncovered, and closes the gap", async () => {
    // r1 is technical+must+senior (so both "technical" and "system-design"
    // get asked about it); r2 is domain+must+senior, so it's asked about
    // in those same two categories too. To isolate "one gap forces one
    // narrow follow-up call", every call drops r2 from its coverage
    // UNLESS it's the narrow gap-only call (requirements === just [r2]).
    generateQuestionsForCategoryMock.mockImplementation(async ({ requirements }) => {
      const isNarrowGapCall = requirements.length === 1 && requirements[0].id === "r2";
      const toCover = isNarrowGapCall ? requirements : requirements.filter((r: { id: string }) => r.id !== "r2");
      return toCover.map((r: { id: string }) => ({
        requirement_ids: [r.id],
        prompt: `Q about ${r.id}`,
        answer_outline: "o",
        difficulty: 2,
      }));
    });

    const kit = await generateKit({ jd: "some JD", companyUrl: "https://acme.example/", days: 5 });

    expect(kit.coverage.uncovered_requirement_ids).toEqual([]);
    expect(kit.coverage.passes).toBe(2);
    const r2Questions = kit.questions.filter((q) => q.requirement_ids.includes("r2"));
    expect(r2Questions.length).toBeGreaterThan(0);
  });

  it("stops after MAX_COVERAGE_PASSES and reports the gap honestly rather than looping forever", async () => {
    // A persistently-uncooperative model: never generates a question
    // covering r2, in any category, on any pass.
    generateQuestionsForCategoryMock.mockImplementation(async ({ requirements }) => {
      return requirements
        .filter((r: { id: string }) => r.id !== "r2")
        .map((r: { id: string }) => ({ requirement_ids: [r.id], prompt: "q", answer_outline: "o", difficulty: 1 }));
    });

    const kit = await generateKit({ jd: "some JD", companyUrl: "https://acme.example/", days: 5 });

    expect(kit.coverage.uncovered_requirement_ids).toEqual(["r2"]);
    expect(kit.coverage.passes).toBe(3); // initial + 2 gap-fill passes
  });

  it("produces an honest company brief without calling the model when nothing was crawled", async () => {
    crawlCompanySiteMock.mockResolvedValue({ pages: [], aboutPage: null, hiringPage: null, skipped: [], failed: [{ url: "x", code: "TIMEOUT", message: "timed out" }] });
    generateQuestionsForCategoryMock.mockResolvedValue([]);

    const kit = await generateKit({ jd: "some JD", companyUrl: "https://acme.example/", days: 3 });

    expect(generateCompanyBriefMock).not.toHaveBeenCalled();
    expect(kit.company_brief.summary).toMatch(/could not retrieve/i);
    expect(kit.company_brief.sources).toEqual([]);
    // A brief this thin shouldn't trigger company-fit question generation either.
    expect(generateCompanyFitQuestionsMock).not.toHaveBeenCalled();
  });

  it("does not fabricate requirements when there are none to work with, and still returns a valid schedule", async () => {
    extractRequirementsMock.mockResolvedValue({
      title: "",
      seniority: "",
      location: "",
      responsibilities: [],
      requirements: [],
    });
    generateQuestionsForCategoryMock.mockResolvedValue([]);

    const kit = await generateKit({ jd: "Engineer wanted.", companyUrl: "https://acme.example/", days: 4 });

    expect(kit.role.requirements).toEqual([]);
    expect(kit.questions.filter((q) => q.category !== "company-fit")).toEqual([]);
    expect(kit.coverage.uncovered_requirement_ids).toEqual([]);
    expect(kit.schedule.days).toHaveLength(4);
  });
});
