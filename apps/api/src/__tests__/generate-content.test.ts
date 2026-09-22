import { describe, expect, it, vi, beforeEach } from "vitest";
import { Requirement } from "@trao/shared";
import { generateQuestionsForCategory } from "../services/generation/generate-questions";
import { generateCompanyFitQuestions } from "../services/generation/generate-company-fit-questions";
import { generateFlashcards } from "../services/generation/generate-flashcards";
import { generateCompanyBrief } from "../services/generation/generate-company-brief";

const { generateStructuredMock } = vi.hoisted(() => ({ generateStructuredMock: vi.fn() }));
vi.mock("../services/llm", () => ({
  generateStructured: (...args: unknown[]) => generateStructuredMock(...args),
  wrapUntrusted: (label: string, text: string) => `<untrusted_${label}>${text}</untrusted_${label}>`,
}));

beforeEach(() => {
  generateStructuredMock.mockReset();
});

const r1: Requirement = { id: "r1", text: "5+ years React", kind: "technical", priority: "must" };
const r2: Requirement = { id: "r2", text: "Mentoring", kind: "behavioural", priority: "nice" };

describe("generateQuestionsForCategory", () => {
  it("short-circuits without calling the model when given no requirements", async () => {
    const result = await generateQuestionsForCategory({
      category: "technical",
      requirements: [],
      companyName: "Acme",
      hiringContext: "",
    });
    expect(result).toEqual([]);
    expect(generateStructuredMock).not.toHaveBeenCalled();
  });

  it("returns the model's question drafts and includes requirement ids + hiring context in the prompt", async () => {
    generateStructuredMock.mockResolvedValueOnce({
      questions: [
        { requirement_ids: ["r1"], prompt: "Describe a React project.", answer_outline: "...", difficulty: 2 },
      ],
    });

    const result = await generateQuestionsForCategory({
      category: "technical",
      requirements: [r1],
      companyName: "Acme",
      hiringContext: "They run a take-home then a system design round.",
    });

    expect(result).toHaveLength(1);
    expect(result[0].requirement_ids).toEqual(["r1"]);

    const call = generateStructuredMock.mock.calls[0][0];
    expect(call.prompt).toContain("[r1]");
    expect(call.prompt).toContain("<untrusted_hiring_context>");
    expect(call.prompt).toContain("take-home");
  });

  it("tells the model there's no known interview process when none was found", async () => {
    generateStructuredMock.mockResolvedValueOnce({ questions: [] });
    await generateQuestionsForCategory({
      category: "behavioural",
      requirements: [r2],
      companyName: "Acme",
      hiringContext: "",
    });
    const call = generateStructuredMock.mock.calls[0][0];
    expect(call.prompt).toMatch(/found no public information/);
  });
});

describe("generateCompanyFitQuestions", () => {
  it("attaches an empty requirement_ids array since these aren't tied to a specific requirement", async () => {
    generateStructuredMock.mockResolvedValueOnce({
      questions: [{ prompt: "Why Acme?", answer_outline: "...", difficulty: 1 }],
    });
    const result = await generateCompanyFitQuestions({
      companyName: "Acme",
      companyBriefText: "Acme builds developer tools.",
      hiringContext: "",
    });
    expect(result[0].requirement_ids).toEqual([]);
  });
});

describe("generateFlashcards", () => {
  it("short-circuits on an empty requirement list", async () => {
    const result = await generateFlashcards([]);
    expect(result).toEqual([]);
    expect(generateStructuredMock).not.toHaveBeenCalled();
  });

  it("returns flashcard drafts from the model", async () => {
    generateStructuredMock.mockResolvedValueOnce({
      flashcards: [{ front: "React hooks?", back: "useState/useEffect basics.", requirement_ids: ["r1"] }],
    });
    const result = await generateFlashcards([r1]);
    expect(result).toEqual([{ front: "React hooks?", back: "useState/useEffect basics.", requirement_ids: ["r1"] }]);
  });
});

describe("generateCompanyBrief", () => {
  it("passes page text through wrapUntrusted and returns the model's brief", async () => {
    generateStructuredMock.mockResolvedValueOnce({
      summary: "Acme is a dev tools company.",
      what_they_do: "They build CLIs for distributed teams.",
    });
    const result = await generateCompanyBrief({ companyName: "Acme", pagesText: "Acme builds CLIs." });
    expect(result.summary).toContain("Acme");
    const call = generateStructuredMock.mock.calls[0][0];
    expect(call.prompt).toContain("<untrusted_company_pages>");
  });
});
