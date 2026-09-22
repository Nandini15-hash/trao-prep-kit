import { describe, expect, it, vi, beforeEach } from "vitest";
import { Kit } from "@trao/shared";
import { HttpError } from "../lib/http-error";

/**
 * Exercises kit.service.ts — the persistence/orchestration layer — against
 * a mocked KitDocument model (this sandbox can't reach a real MongoDB; see
 * auth.routes.test.ts for the same tradeoff) and mocked generation/
 * kit-builder boundaries, so these tests are about kit.service.ts's own
 * logic: ownership checks, status-gating edits until a kit is ready, the
 * duplicate-submission dedupe, and dispatching each mutation to the right
 * kit-builder function — not about generation or edit-state logic itself,
 * which are covered by pipeline.test.ts and kit-builder.test.ts.
 */

const { docs, resetDocs, nextHexId } = vi.hoisted(() => {
  const store = new Map<string, any>();
  let n = 1;
  return {
    docs: store,
    resetDocs: () => {
      store.clear();
      n = 1;
    },
    nextHexId: () => (n++).toString(16).padStart(24, "0"),
  };
});

function matches(doc: any, query: Record<string, any>): boolean {
  return Object.entries(query).every(([key, val]) => {
    if (key === "status" && val && typeof val === "object" && "$in" in val) {
      return (val.$in as string[]).includes(doc.status);
    }
    if (key.startsWith("input.")) {
      const field = key.slice("input.".length);
      return doc.input?.[field] === val;
    }
    if (key === "_id" || key === "owner") {
      return String(doc[key]) === String(val);
    }
    return doc[key] === val;
  });
}

vi.mock("../models/Kit", () => ({
  KitDocument: {
    create: vi.fn(async (fields: any) => {
      const id = nextHexId();
      const doc = {
        _id: id,
        owner: fields.owner,
        status: fields.status,
        input: fields.input,
        data: fields.data ?? null,
        error: fields.error ?? null,
        progress: fields.progress ?? [],
        createdAt: new Date(),
        updatedAt: new Date(),
        markModified: vi.fn(),
        save: vi.fn(async function (this: any) {
          this.updatedAt = new Date();
          return this;
        }),
      };
      docs.set(id, doc);
      return doc;
    }),
    findOne: vi.fn(async (query: any) => [...docs.values()].find((d) => matches(d, query)) ?? null),
    findById: vi.fn(async (id: any) => docs.get(String(id)) ?? null),
    find: vi.fn((query: any) => ({
      sort: async () =>
        [...docs.values()]
          .filter((d) => matches(d, query))
          .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime()),
    })),
    deleteOne: vi.fn(async ({ _id }: any) => {
      docs.delete(String(_id));
    }),
  },
}));

const { generateKitMock } = vi.hoisted(() => ({ generateKitMock: vi.fn() }));
vi.mock("../services/generation/pipeline", () => ({ generateKit: generateKitMock }));

const builderMocks = vi.hoisted(() => ({
  editCompanyBrief: vi.fn((kit: any, ..._rest: any[]) => kit),
  regenerateCompanyBrief: vi.fn((kit: any, ..._rest: any[]) => kit),
  editQuestion: vi.fn((kit: any, ..._rest: any[]) => kit),
  addQuestion: vi.fn((kit: any, ..._rest: any[]) => kit),
  deleteQuestion: vi.fn((kit: any, ..._rest: any[]) => kit),
  moveQuestionToCategory: vi.fn((kit: any, ..._rest: any[]) => kit),
  reorderQuestionsInCategory: vi.fn((kit: any, ..._rest: any[]) => kit),
  regenerateQuestionCategory: vi.fn((kit: any, ..._rest: any[]) => kit),
  regenerateCompanyFitQuestions: vi.fn((kit: any, ..._rest: any[]) => kit),
  editFlashcard: vi.fn((kit: any, ..._rest: any[]) => kit),
  addFlashcard: vi.fn((kit: any, ..._rest: any[]) => kit),
  deleteFlashcard: vi.fn((kit: any, ..._rest: any[]) => kit),
  regenerateSchedule: vi.fn((kit: any, ..._rest: any[]) => kit),
}));
vi.mock("../services/kit-builder", () => builderMocks);

const practiceMocks = vi.hoisted(() => ({
  orderForPractice: vi.fn((flashcards: any) => flashcards),
  recordReview: vi.fn((kit: any) => kit),
  coverageSummary: vi.fn(() => ({ total: 0, reviewed: 0 })),
}));
vi.mock("../services/practice", () => practiceMocks);

// Static imports still pick up the mocks above — vi.mock factories are
// hoisted above these regardless of import style (see kit-builder.test.ts
// and the note on top-level await in generation/pipeline's tests: this
// file's tsconfig target disallows top-level await, so dynamic imports
// are avoided here too).
import * as kitService from "../services/kit.service";
import { KitDocument } from "../models/Kit";

const OWNER = "5f0000000000000000000001";
const OTHER_OWNER = "5f0000000000000000000002";

function validKit(): Kit {
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
      requirements: [{ id: "r1", text: "React experience", kind: "technical", priority: "must" }],
    },
    questions: [
      {
        id: "q1",
        requirement_ids: ["r1"],
        category: "technical",
        prompt: "Tell me about React",
        answer_outline: "outline",
        difficulty: 2,
      },
    ],
    flashcards: [{ id: "f1", front: "front", back: "back", requirement_ids: ["r1"] }],
    schedule: { days_available: 1, days: [{ day: 1, focus: "React", question_ids: ["q1"], minutes: 30 }] },
    coverage: { uncovered_requirement_ids: [], passes: 1 },
  };
}

async function createReadyDoc(owner = OWNER) {
  const doc = await KitDocument.create({
    owner,
    status: "ready",
    input: { jd: "some jd", companyUrl: "https://acme.example/", days: 5 },
    data: validKit(),
    progress: [],
  });
  return doc;
}

beforeEach(() => {
  resetDocs();
  vi.clearAllMocks();
  Object.values(builderMocks).forEach((fn) => fn.mockImplementation((kit: any) => kit));
});

describe("createKit", () => {
  it("creates a pending doc and transitions it to ready once generation resolves", async () => {
    generateKitMock.mockResolvedValue(validKit());

    const doc = await kitService.createKit(OWNER, { jd: "jd text", companyUrl: "https://acme.example/", days: 5 });
    // createKit returns without waiting for generation to finish — with
    // these instant mocks, background generation may already have
    // flipped the shared doc to "generating" by the time control returns
    // here, so either in-flight status is a valid observation; what
    // matters is that it isn't "ready" yet.
    expect(["pending", "generating"]).toContain(doc.status);

    await vi.waitFor(() => {
      expect(docs.get(String((doc as any)._id)).status).toBe("ready");
    });
    const finished = docs.get(String((doc as any)._id));
    expect(finished.data.source.company).toBe("Acme");
  });

  it("marks the doc failed, with an error message, when generation throws", async () => {
    generateKitMock.mockRejectedValue(new Error("crawl exploded"));

    const doc = await kitService.createKit(OWNER, { jd: "jd text", companyUrl: "https://acme.example/", days: 5 });

    await vi.waitFor(() => {
      expect(docs.get(String((doc as any)._id)).status).toBe("failed");
    });
    const finished = docs.get(String((doc as any)._id));
    expect(finished.error.message).toMatch(/crawl exploded/);
  });

  it("returns the existing in-flight job instead of creating a second one for an identical resubmission", async () => {
    let resolveGeneration!: (k: Kit) => void;
    generateKitMock.mockReturnValue(new Promise((resolve) => (resolveGeneration = resolve)));

    const input = { jd: "same jd", companyUrl: "https://acme.example/", days: 5 };
    const first = await kitService.createKit(OWNER, input);
    const second = await kitService.createKit(OWNER, input);

    expect(String((second as any)._id)).toBe(String((first as any)._id));
    expect(KitDocument.create).toHaveBeenCalledTimes(1);

    resolveGeneration(validKit());
    await vi.waitFor(() => {
      expect(docs.get(String((first as any)._id)).status).toBe("ready");
    });
  });

  it("does not dedupe across different owners", async () => {
    generateKitMock.mockReturnValue(new Promise(() => {})); // never resolves
    const input = { jd: "same jd", companyUrl: "https://acme.example/", days: 5 };
    const first = await kitService.createKit(OWNER, input);
    const second = await kitService.createKit(OTHER_OWNER, input);
    expect(String((second as any)._id)).not.toBe(String((first as any)._id));
  });
});

describe("getKit / listKits / deleteKit — ownership", () => {
  it("404s for a kit that belongs to a different owner", async () => {
    const doc = await createReadyDoc(OWNER);
    await expect(kitService.getKit(OTHER_OWNER, String((doc as any)._id))).rejects.toMatchObject({
      status: 404,
      code: "KIT_NOT_FOUND",
    });
  });

  it("404s for a syntactically invalid id rather than throwing a raw CastError", async () => {
    await expect(kitService.getKit(OWNER, "not-an-object-id")).rejects.toBeInstanceOf(HttpError);
  });

  it("lists only the requesting owner's kits", async () => {
    await createReadyDoc(OWNER);
    await createReadyDoc(OTHER_OWNER);
    const mine = await kitService.listKits(OWNER);
    expect(mine).toHaveLength(1);
  });

  it("deletes a kit the owner owns", async () => {
    const doc = await createReadyDoc(OWNER);
    await kitService.deleteKit(OWNER, String((doc as any)._id));
    expect(docs.has(String((doc as any)._id))).toBe(false);
  });

  it("refuses to delete another owner's kit", async () => {
    const doc = await createReadyDoc(OWNER);
    await expect(kitService.deleteKit(OTHER_OWNER, String((doc as any)._id))).rejects.toMatchObject({ status: 404 });
    expect(docs.has(String((doc as any)._id))).toBe(true);
  });
});

describe("edits are gated on the kit being ready", () => {
  it("refuses to edit a kit that's still generating", async () => {
    const doc = await KitDocument.create({
      owner: OWNER,
      status: "generating",
      input: { jd: "j", companyUrl: "https://acme.example/", days: 3 },
      data: null,
      progress: [],
    });
    await expect(kitService.updateCompanyBrief(OWNER, String((doc as any)._id), { summary: "new" })).rejects.toMatchObject({
      status: 409,
      code: "KIT_NOT_READY",
    });
  });

  it("refuses to edit a kit whose generation failed", async () => {
    const doc = await KitDocument.create({
      owner: OWNER,
      status: "failed",
      input: { jd: "j", companyUrl: "https://acme.example/", days: 3 },
      data: null,
      error: { code: "GENERATION_FAILED", message: "boom" },
      progress: [],
    });
    await expect(kitService.updateCompanyBrief(OWNER, String((doc as any)._id), { summary: "new" })).rejects.toMatchObject({
      status: 409,
      code: "KIT_GENERATION_FAILED",
    });
  });
});

describe("mutations — dispatch to the right kit-builder function and persist the result", () => {
  it("updateCompanyBrief calls builder.editCompanyBrief and saves the patched kit", async () => {
    const doc = await createReadyDoc();
    builderMocks.editCompanyBrief.mockImplementation((kit: any, patch: any) => ({
      ...kit,
      company_brief: { ...kit.company_brief, ...patch },
    }));
    const updated = await kitService.updateCompanyBrief(OWNER, String((doc as any)._id), { summary: "New summary" });
    expect(builderMocks.editCompanyBrief).toHaveBeenCalledWith(expect.any(Object), { summary: "New summary" });
    expect((updated as any).data.company_brief.summary).toBe("New summary");
  });

  it("regenerateQuestions dispatches 'company-fit' to regenerateCompanyFitQuestions", async () => {
    const doc = await createReadyDoc();
    await kitService.regenerateQuestions(OWNER, String((doc as any)._id), "company-fit");
    expect(builderMocks.regenerateCompanyFitQuestions).toHaveBeenCalledTimes(1);
    expect(builderMocks.regenerateQuestionCategory).not.toHaveBeenCalled();
  });

  it("regenerateQuestions dispatches a requirement category to regenerateQuestionCategory", async () => {
    const doc = await createReadyDoc();
    await kitService.regenerateQuestions(OWNER, String((doc as any)._id), "technical");
    expect(builderMocks.regenerateQuestionCategory).toHaveBeenCalledWith(expect.any(Object), "technical");
    expect(builderMocks.regenerateCompanyFitQuestions).not.toHaveBeenCalled();
  });

  it("addQuestion persists a kit that fails schema validation with a thrown error (bug in kit-builder, not a bad request)", async () => {
    const doc = await createReadyDoc();
    builderMocks.addQuestion.mockImplementation((kit: any) => ({
      ...kit,
      questions: [...kit.questions, { id: "q2", requirement_ids: ["does-not-exist"], category: "technical" }], // missing required fields
    }));
    await expect(
      kitService.addQuestion(OWNER, String((doc as any)._id), {
        category: "technical",
        prompt: "p",
        answer_outline: "o",
        difficulty: 1,
        requirement_ids: [],
      })
    ).rejects.toThrow();
  });

  it("recordFlashcardReview 404s for a flashcard id that isn't in the kit", async () => {
    const doc = await createReadyDoc();
    await expect(kitService.recordFlashcardReview(OWNER, String((doc as any)._id), "no-such-card", 3)).rejects.toMatchObject({
      status: 404,
      code: "FLASHCARD_NOT_FOUND",
    });
  });

  it("recordFlashcardReview calls practice.recordReview for a real flashcard id", async () => {
    const doc = await createReadyDoc();
    await kitService.recordFlashcardReview(OWNER, String((doc as any)._id), "f1", 4);
    expect(practiceMocks.recordReview).toHaveBeenCalledWith(expect.any(Object), "f1", 4);
  });
});

describe("getPracticeSession", () => {
  it("returns ordered flashcards and a coverage summary sourced from practice.ts", async () => {
    const doc = await createReadyDoc();
    practiceMocks.coverageSummary.mockReturnValue({ total: 1, reviewed: 0 });
    const session = await kitService.getPracticeSession(OWNER, String((doc as any)._id));
    expect(session.coverage).toEqual({ total: 1, reviewed: 0 });
    expect(practiceMocks.orderForPractice).toHaveBeenCalled();
  });
});
