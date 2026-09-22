import { Flashcard, FlashcardProgress, Kit, PracticeState } from "@trao/shared";

/**
 * Section 7: "Order the next session by what they were least confident
 * about ... deliberately open. A simple confidence-weighted sort is
 * fine; a proper spaced-repetition interval is fine. Pick one and defend
 * it."
 *
 * Chosen: confidence-weighted, not spaced-repetition. A never-reviewed
 * card is treated as maximally unconfident (sorts first — you haven't
 * proven you know it yet), then ascending stated confidence (1 = least
 * confident, sorts earliest), then least-recently-reviewed as a
 * tiebreak so two cards at the same confidence don't always resurface in
 * the same order. This is simpler to reason about and explain than an
 * interval scheduler, and for a 1-60 day interview prep window (not a
 * months-long retention program) the difference in practice is small —
 * see README for the full justification.
 */
export function orderForPractice(flashcards: Flashcard[], practice: PracticeState | undefined): Flashcard[] {
  const progressById = new Map((practice?.progress ?? []).map((p) => [p.flashcard_id, p]));

  return [...flashcards].sort((a, b) => {
    const pa = progressById.get(a.id);
    const pb = progressById.get(b.id);
    const confA = pa?.confidence ?? 0; // unreviewed sorts as least confident
    const confB = pb?.confidence ?? 0;
    if (confA !== confB) return confA - confB;

    const timeA = pa?.last_reviewed_at ? new Date(pa.last_reviewed_at).getTime() : 0;
    const timeB = pb?.last_reviewed_at ? new Date(pb.last_reviewed_at).getTime() : 0;
    return timeA - timeB; // least-recently-reviewed first
  });
}

export function recordReview(kit: Kit, flashcardId: string, confidence: number): Kit {
  const existing = kit.practice?.progress ?? [];
  const now = new Date().toISOString();

  const idx = existing.findIndex((p) => p.flashcard_id === flashcardId);
  const updated: FlashcardProgress =
    idx >= 0
      ? { ...existing[idx], confidence, last_reviewed_at: now, times_reviewed: existing[idx].times_reviewed + 1 }
      : { flashcard_id: flashcardId, confidence, last_reviewed_at: now, times_reviewed: 1 };

  const progress = idx >= 0 ? existing.map((p, i) => (i === idx ? updated : p)) : [...existing, updated];

  return { ...kit, practice: { progress } };
}

export function coverageSummary(flashcards: Flashcard[], practice: PracticeState | undefined) {
  const reviewed = new Set((practice?.progress ?? []).map((p) => p.flashcard_id));
  return {
    total: flashcards.length,
    reviewed: flashcards.filter((f) => reviewed.has(f.id)).length,
  };
}
