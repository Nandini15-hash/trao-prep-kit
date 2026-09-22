import { describe, expect, it } from "vitest";
import { Flashcard, Kit, PracticeState } from "@trao/shared";
import { coverageSummary, orderForPractice, recordReview } from "../services/practice";

function card(id: string): Flashcard {
  return { id, front: `front ${id}`, back: `back ${id}`, requirement_ids: [] };
}

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
    company_brief: { summary: "s", what_they_do: "w", sources: [] },
    role: { title: "Backend Engineer", seniority: "Mid-level", responsibilities: [], requirements: [] },
    questions: [],
    flashcards: [card("f1"), card("f2"), card("f3")],
    schedule: { days_available: 3, days: [] },
    coverage: { uncovered_requirement_ids: [], passes: 1 },
  };
}

describe("orderForPractice", () => {
  it("sorts unreviewed cards first (treated as least confident)", () => {
    const flashcards = [card("f1"), card("f2")];
    const practice: PracticeState = {
      progress: [{ flashcard_id: "f1", confidence: 5, last_reviewed_at: new Date().toISOString(), times_reviewed: 1 }],
    };
    const ordered = orderForPractice(flashcards, practice);
    expect(ordered.map((c) => c.id)).toEqual(["f2", "f1"]);
  });

  it("sorts ascending by stated confidence (least confident first)", () => {
    const flashcards = [card("f1"), card("f2"), card("f3")];
    const practice: PracticeState = {
      progress: [
        { flashcard_id: "f1", confidence: 4, last_reviewed_at: new Date().toISOString(), times_reviewed: 1 },
        { flashcard_id: "f2", confidence: 1, last_reviewed_at: new Date().toISOString(), times_reviewed: 1 },
        { flashcard_id: "f3", confidence: 3, last_reviewed_at: new Date().toISOString(), times_reviewed: 1 },
      ],
    };
    const ordered = orderForPractice(flashcards, practice);
    expect(ordered.map((c) => c.id)).toEqual(["f2", "f3", "f1"]);
  });

  it("breaks ties at equal confidence by least-recently-reviewed first", () => {
    const flashcards = [card("f1"), card("f2")];
    const practice: PracticeState = {
      progress: [
        { flashcard_id: "f1", confidence: 3, last_reviewed_at: "2026-09-20T00:00:00.000Z", times_reviewed: 1 },
        { flashcard_id: "f2", confidence: 3, last_reviewed_at: "2026-09-10T00:00:00.000Z", times_reviewed: 1 },
      ],
    };
    const ordered = orderForPractice(flashcards, practice);
    expect(ordered.map((c) => c.id)).toEqual(["f2", "f1"]);
  });

  it("treats undefined practice state as all-unreviewed without throwing", () => {
    const flashcards = [card("f1"), card("f2")];
    expect(() => orderForPractice(flashcards, undefined)).not.toThrow();
    expect(orderForPractice(flashcards, undefined)).toHaveLength(2);
  });

  it("does not mutate the input array", () => {
    const flashcards = [card("f1"), card("f2")];
    const practice: PracticeState = {
      progress: [{ flashcard_id: "f2", confidence: 1, last_reviewed_at: null, times_reviewed: 0 }],
    };
    orderForPractice(flashcards, practice);
    expect(flashcards.map((c) => c.id)).toEqual(["f1", "f2"]);
  });
});

describe("recordReview", () => {
  it("creates a new progress entry on first review of a card", () => {
    const kit = baseKit();
    const result = recordReview(kit, "f1", 4);
    expect(result.practice?.progress).toHaveLength(1);
    const p = result.practice!.progress[0];
    expect(p.flashcard_id).toBe("f1");
    expect(p.confidence).toBe(4);
    expect(p.times_reviewed).toBe(1);
    expect(p.last_reviewed_at).not.toBeNull();
  });

  it("upserts and increments times_reviewed on a subsequent review of the same card", () => {
    let kit = baseKit();
    kit = recordReview(kit, "f1", 2);
    kit = recordReview(kit, "f1", 5);
    expect(kit.practice?.progress).toHaveLength(1);
    const p = kit.practice!.progress[0];
    expect(p.confidence).toBe(5);
    expect(p.times_reviewed).toBe(2);
  });

  it("leaves other cards' progress untouched", () => {
    let kit = baseKit();
    kit = recordReview(kit, "f1", 2);
    kit = recordReview(kit, "f2", 3);
    expect(kit.practice?.progress).toHaveLength(2);
    const p1 = kit.practice!.progress.find((p) => p.flashcard_id === "f1")!;
    expect(p1.confidence).toBe(2);
    expect(p1.times_reviewed).toBe(1);
  });

  it("does not mutate the input kit", () => {
    const kit = baseKit();
    recordReview(kit, "f1", 2);
    expect(kit.practice).toBeUndefined();
  });
});

describe("coverageSummary", () => {
  it("counts total flashcards and how many have been reviewed at least once", () => {
    const flashcards = [card("f1"), card("f2"), card("f3")];
    const practice: PracticeState = {
      progress: [
        { flashcard_id: "f1", confidence: 3, last_reviewed_at: new Date().toISOString(), times_reviewed: 1 },
      ],
    };
    expect(coverageSummary(flashcards, practice)).toEqual({ total: 3, reviewed: 1 });
  });

  it("treats undefined practice state as zero reviewed", () => {
    const flashcards = [card("f1"), card("f2")];
    expect(coverageSummary(flashcards, undefined)).toEqual({ total: 2, reviewed: 0 });
  });
});
