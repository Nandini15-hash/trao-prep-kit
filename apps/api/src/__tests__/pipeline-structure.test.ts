import { describe, expect, it, vi, beforeEach } from "vitest";
import { KitSchema, validateKitStructure } from "@trao/shared";
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

beforeEach(() => {
  vi.clearAllMocks();
  extractRequirementsMock.mockResolvedValue({
    title: "Senior Backend Engineer",
    seniority: "Senior",
    location: "Remote",
    responsibilities: ["Own the payments service"],
    requirements: [
      { id: "r1", text: "5+ years distributed systems", kind: "technical", priority: "must" },
      { id: "r2", text: "Mentoring", kind: "behavioural", priority: "nice" },
    ],
  });
  crawlCompanySiteMock.mockResolvedValue({
    pages: [{ url: "https://acme.example/", title: "Acme", text: "Acme builds infra.", links: [], hiringScore: 0, aboutScore: 1 }],
    aboutPage: { url: "https://acme.example/about", title: "About", text: "Acme builds developer infrastructure for banks.", links: [], hiringScore: 0, aboutScore: 2 },
    hiringPage: { url: "https://acme.example/careers", title: "Careers", text: "Take-home then system design.", links: [], hiringScore: 2, aboutScore: 0 },
    skipped: [],
    failed: [],
  });
  searchMock.mockResolvedValue({ attempted: true, results: [{ title: "Review", url: "https://blind.example/1", snippet: "3 rounds" }] });
  generateCompanyBriefMock.mockResolvedValue({
    summary: "Acme builds developer infrastructure for banks.",
    what_they_do: "They sell APIs for payments.",
  });
  generateQuestionsForCategoryMock.mockImplementation(async ({ requirements }) =>
    requirements.map((r: { id: string }) => ({
      requirement_ids: [r.id],
      prompt: `Q about ${r.id}`,
      answer_outline: "outline",
      difficulty: 2,
    }))
  );
  generateCompanyFitQuestionsMock.mockResolvedValue([
    { prompt: "Why Acme?", answer_outline: "...", difficulty: 1, requirement_ids: [] },
  ]);
  generateFlashcardsMock.mockResolvedValue([{ front: "f", back: "b", requirement_ids: ["r1"] }]);
});

describe("generateKit output", () => {
  it("produces a kit that validates against the Appendix A Zod schema with no structural issues", async () => {
    const kit = await generateKit({ jd: "some JD text", companyUrl: "https://acme.example/", days: 5 });

    const parsed = KitSchema.safeParse(kit);
    expect(parsed.success).toBe(true);

    const issues = validateKitStructure(kit);
    expect(issues).toEqual([]);
  });

  it("gives every requirement, question, and flashcard a stable, unique id", async () => {
    const kit = await generateKit({ jd: "some JD text", companyUrl: "https://acme.example/", days: 5 });

    const reqIds = kit.role.requirements.map((r) => r.id);
    expect(new Set(reqIds).size).toBe(reqIds.length);

    const qIds = kit.questions.map((q) => q.id);
    expect(new Set(qIds).size).toBe(qIds.length);

    const fIds = kit.flashcards.map((f) => f.id);
    expect(new Set(fIds).size).toBe(fIds.length);
  });
});
