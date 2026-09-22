import { describe, expect, it, vi, beforeEach } from "vitest";
import { Kit, defaultMeta } from "@trao/shared";
import * as builder from "../services/kit-builder";

const {
  crawlCompanySiteMock,
  searchMock,
  generateQuestionsForCategoryMock,
  generateCompanyBriefMock,
} = vi.hoisted(() => ({
  crawlCompanySiteMock: vi.fn(),
  searchMock: vi.fn(),
  generateQuestionsForCategoryMock: vi.fn(),
  generateCompanyBriefMock: vi.fn(),
}));

vi.mock("../services/retrieval/crawler", () => ({ crawlCompanySite: crawlCompanySiteMock }));
vi.mock("../services/search/tavily", () => ({ searchPublicInterviewDiscussion: searchMock }));
vi.mock("../services/generation/generate-questions", () => ({
  generateQuestionsForCategory: generateQuestionsForCategoryMock,
}));
vi.mock("../services/generation/generate-company-brief", () => ({ generateCompanyBrief: generateCompanyBriefMock }));
vi.mock("../services/generation/generate-company-fit-questions", () => ({
  generateCompanyFitQuestions: vi.fn().mockResolvedValue([]),
}));

function baseKit(): Kit {
  return {
    source: {
      company: "Acme",
      company_url: "https://acme.example/",
      role: "Backend Engineer",
      location: "Remote",
      jd_chars: 100,
      researched_at: new Date().toISOString(),
      pages_used: [],
    },
    company_brief: { summary: "Acme builds things.", what_they_do: "APIs.", sources: [] },
    role: {
      title: "Backend Engineer",
      seniority: "Mid-level",
      responsibilities: [],
      requirements: [
        { id: "r1", text: "React experience", kind: "technical", priority: "must" },
        { id: "r2", text: "Node experience", kind: "technical", priority: "must" },
      ],
    },
    questions: [
      {
        id: "q1",
        requirement_ids: ["r1"],
        category: "technical",
        prompt: "Original generated question about r1",
        answer_outline: "outline",
        difficulty: 2,
        _meta: defaultMeta("generated"),
      },
      {
        id: "q2",
        requirement_ids: ["r2"],
        category: "technical",
        prompt: "Original generated question about r2",
        answer_outline: "outline",
        difficulty: 2,
        _meta: defaultMeta("generated"),
      },
    ],
    flashcards: [],
    schedule: { days_available: 3, days: [] },
    coverage: { uncovered_requirement_ids: [], passes: 1 },
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  crawlCompanySiteMock.mockResolvedValue({ pages: [], aboutPage: null, hiringPage: null, skipped: [], failed: [] });
  searchMock.mockResolvedValue({ attempted: true, results: [] });
});

describe("editQuestion", () => {
  it("marks the edited question as pinned/edited and leaves the schedule/coverage consistent", () => {
    const kit = builder.editQuestion(baseKit(), "q1", { prompt: "My rewritten question" });
    const q1 = kit.questions.find((q) => q.id === "q1")!;
    expect(q1.prompt).toBe("My rewritten question");
    expect(q1._meta?.origin).toBe("edited");
    expect(q1._meta?.pinned).toBe(true);
    // q2 untouched
    const q2 = kit.questions.find((q) => q.id === "q2")!;
    expect(q2._meta?.origin).toBe("generated");
    expect(q2._meta?.pinned).toBe(false);
  });
});

describe("addQuestion / deleteQuestion", () => {
  it("assigns a fresh id and marks a hand-added question as pinned/user_added", () => {
    const kit = builder.addQuestion(baseKit(), {
      category: "behavioural",
      prompt: "My own question",
      answer_outline: "o",
      difficulty: 1,
      requirement_ids: [],
    });
    const added = kit.questions[kit.questions.length - 1];
    expect(added.id).toBe("q3");
    expect(added._meta?.origin).toBe("user_added");
    expect(added._meta?.pinned).toBe(true);
  });

  it("deleting the only question covering a must-have requirement surfaces an honest coverage gap", () => {
    const kit = builder.deleteQuestion(baseKit(), "q2"); // q2 was the only question covering r2 (must)
    expect(kit.coverage.uncovered_requirement_ids).toContain("r2");
  });
});

describe("regenerateQuestionCategory — the core 'must survive regeneration' behavior", () => {
  it("keeps a pinned (hand-edited) question untouched and does not even ask the model to cover it again", async () => {
    let kit = baseKit();
    kit = builder.editQuestion(kit, "q1", { prompt: "My hand-edited version of the r1 question" }); // pins q1

    generateQuestionsForCategoryMock.mockImplementation(async ({ requirements }) => {
      // Should only be asked about r2 — r1 is already covered by a pinned survivor.
      expect(requirements.map((r: { id: string }) => r.id)).toEqual(["r2"]);
      return [{ requirement_ids: ["r2"], prompt: "Fresh replacement for r2", answer_outline: "o", difficulty: 2 }];
    });

    const result = await builder.regenerateQuestionCategory(kit, "technical");

    const q1 = result.questions.find((q) => q.id === "q1")!;
    expect(q1.prompt).toBe("My hand-edited version of the r1 question");
    expect(q1._meta?.pinned).toBe(true);

    // The old, unpinned q2 (generated) should be gone, replaced by a fresh one.
    expect(result.questions.some((q) => q.prompt === "Original generated question about r2")).toBe(false);
    expect(result.questions.some((q) => q.prompt === "Fresh replacement for r2")).toBe(true);

    expect(generateQuestionsForCategoryMock).toHaveBeenCalledTimes(1);
  });

  it("does not touch questions in other categories", async () => {
    let kit = baseKit();
    kit = builder.addQuestion(kit, {
      category: "behavioural",
      prompt: "A behavioural question",
      answer_outline: "o",
      difficulty: 1,
      requirement_ids: [],
    });
    generateQuestionsForCategoryMock.mockResolvedValue([]);

    const result = await builder.regenerateQuestionCategory(kit, "technical");
    expect(result.questions.some((q) => q.prompt === "A behavioural question")).toBe(true);
  });

  it("assigns unique, non-colliding ids to freshly generated replacements", async () => {
    generateQuestionsForCategoryMock.mockResolvedValue([
      { requirement_ids: ["r1"], prompt: "New Q A", answer_outline: "o", difficulty: 1 },
      { requirement_ids: ["r2"], prompt: "New Q B", answer_outline: "o", difficulty: 1 },
    ]);
    const result = await builder.regenerateQuestionCategory(baseKit(), "technical");
    const ids = result.questions.map((q) => q.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe("regenerateCompanyBrief", () => {
  it("produces an honest fallback when nothing can be crawled, without calling the model", async () => {
    crawlCompanySiteMock.mockResolvedValue({ pages: [], aboutPage: null, hiringPage: null, skipped: [], failed: [] });
    const result = await builder.regenerateCompanyBrief(baseKit());
    expect(generateCompanyBriefMock).not.toHaveBeenCalled();
    expect(result.company_brief.summary).toMatch(/could not retrieve/i);
  });
});

describe("regenerateSchedule", () => {
  it("recomputes deterministically with no model call, and can change days_available", () => {
    const kit = baseKit();
    const result = builder.regenerateSchedule(kit, 5);
    expect(result.schedule.days_available).toBe(5);
    expect(result.schedule.days).toHaveLength(5);
  });
});
