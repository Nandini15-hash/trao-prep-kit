"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { RequireAuth } from "@/components/RequireAuth";
import * as api from "@/lib/api";
import type { Flashcard } from "@trao/shared";

const CONFIDENCE_LABELS: Record<number, string> = {
  1: "No idea",
  2: "Shaky",
  3: "Okay",
  4: "Confident",
  5: "Nailed it",
};

function PracticeSession({ kitId }: { kitId: string }) {
  const [cards, setCards] = useState<Flashcard[] | null>(null);
  const [totalCount, setTotalCount] = useState(0);
  const [reviewedIds, setReviewedIds] = useState<Set<string>>(new Set());
  const [index, setIndex] = useState(0);
  const [revealed, setRevealed] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function loadSession() {
    setError(null);
    try {
      const session = await api.getPracticeSession(kitId);
      setCards(session.flashcards);
      setTotalCount(session.coverage.total);
      setReviewedIds(new Set());
      setIndex(0);
      setRevealed(false);
    } catch (err) {
      setError(err instanceof api.ApiError ? err.message : "Could not load flashcards for this kit.");
    }
  }

  useEffect(() => {
    loadSession();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [kitId]);

  async function recordConfidence(confidence: number) {
    if (!cards) return;
    const card = cards[index];
    setSubmitting(true);
    setError(null);
    try {
      await api.recordFlashcardReview(kitId, card.id, confidence);
      setReviewedIds((prev) => new Set(prev).add(card.id));
      setRevealed(false);
      setIndex((i) => i + 1);
    } catch (err) {
      setError(err instanceof api.ApiError ? err.message : "Couldn't save that review — try again.");
    } finally {
      setSubmitting(false);
    }
  }

  if (error && !cards) {
    return (
      <p role="alert" className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">
        {error}
      </p>
    );
  }

  if (!cards) {
    return (
      <div className="flex min-h-[40vh] items-center justify-center text-slate-500" role="status" aria-live="polite">
        Loading flashcards...
      </div>
    );
  }

  if (cards.length === 0) {
    return (
      <div className="rounded-lg border border-dashed border-slate-300 px-4 py-10 text-center text-sm text-slate-500">
        This kit has no flashcards yet — add some from the kit page first.
      </div>
    );
  }

  const done = index >= cards.length;
  const reviewedThisSession = reviewedIds.size;

  return (
    <div className="flex flex-col gap-4">
      <div>
        <div className="mb-1 flex items-center justify-between text-sm text-slate-600">
          <span>
            {Math.min(index + (done ? 0 : 1), cards.length)} of {cards.length} this session
          </span>
          <span>
            {reviewedThisSession > 0 ? `${reviewedThisSession} reviewed just now` : `${totalCount} card(s) total`}
          </span>
        </div>
        <div className="h-2 w-full overflow-hidden rounded-full bg-slate-200">
          <div
            className="h-full bg-brand transition-all"
            style={{ width: `${(Math.min(index, cards.length) / cards.length) * 100}%` }}
          />
        </div>
      </div>

      {error && (
        <p role="alert" className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </p>
      )}

      {done ? (
        <div className="flex flex-col items-center gap-3 rounded-lg border border-slate-200 bg-white p-8 text-center">
          <p className="text-lg font-medium text-slate-800">Session complete — nice work.</p>
          <p className="text-sm text-slate-500">Cards are re-ordered by confidence, so start a new session to focus on what needs the most work.</p>
          <button
            type="button"
            onClick={loadSession}
            className="rounded-md bg-brand px-4 py-2 text-brand-foreground hover:bg-brand/90"
          >
            Start a new session
          </button>
        </div>
      ) : (
        <div className="flex flex-col gap-4 rounded-lg border border-slate-200 bg-white p-6 sm:p-10">
          <div className="min-h-[8rem]">
            <span className="text-xs font-medium uppercase tracking-wide text-slate-400">Question</span>
            <p className="mt-1 text-lg text-slate-900">{cards[index].front}</p>
            {revealed && (
              <>
                <span className="mt-4 block text-xs font-medium uppercase tracking-wide text-slate-400">Answer</span>
                <p className="mt-1 text-slate-700">{cards[index].back}</p>
              </>
            )}
          </div>

          {!revealed ? (
            <button
              type="button"
              onClick={() => setRevealed(true)}
              className="self-start rounded-md border border-slate-300 px-4 py-2 text-sm text-slate-700 hover:bg-slate-50"
            >
              Reveal answer
            </button>
          ) : (
            <div>
              <p className="mb-2 text-sm text-slate-600">How confident did you feel?</p>
              <div className="flex flex-wrap gap-2">
                {[1, 2, 3, 4, 5].map((n) => (
                  <button
                    key={n}
                    type="button"
                    disabled={submitting}
                    onClick={() => recordConfidence(n)}
                    className="rounded-md border border-slate-300 px-3 py-2 text-sm hover:bg-slate-50 disabled:opacity-60"
                  >
                    {n} · {CONFIDENCE_LABELS[n]}
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export default function PracticePage() {
  const params = useParams<{ id: string }>();
  return (
    <RequireAuth>
      <div className="flex flex-col gap-4">
        <Link href={`/kits/${params.id}`} className="text-sm text-slate-500 hover:underline">
          ← Back to kit
        </Link>
        <h1 className="text-2xl font-semibold tracking-tight">Practice</h1>
        <PracticeSession kitId={params.id} />
      </div>
    </RequireAuth>
  );
}
