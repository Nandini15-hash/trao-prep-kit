"use client";

import { useState } from "react";
import type { Flashcard } from "@trao/shared";
import type { KitRecord } from "@/lib/api";
import * as api from "@/lib/api";
import { EditableField } from "./EditableField";

export function FlashcardsSection({
  kitId,
  flashcards,
  onUpdated,
}: {
  kitId: string;
  flashcards: Flashcard[];
  onUpdated: (kit: KitRecord) => void;
}) {
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showAddForm, setShowAddForm] = useState(false);
  const [draft, setDraft] = useState({ front: "", back: "" });

  async function run(tag: string, action: () => Promise<KitRecord>) {
    setBusy(tag);
    setError(null);
    try {
      onUpdated(await action());
    } catch (err) {
      setError(err instanceof api.ApiError ? err.message : "That action didn't go through — please try again.");
    } finally {
      setBusy(null);
    }
  }

  return (
    <section className="rounded-lg border border-slate-200 bg-white p-4 sm:p-6" aria-labelledby="flashcards-heading">
      <h2 id="flashcards-heading" className="mb-3 text-lg font-semibold tracking-tight">
        Flashcards
      </h2>
      {error && (
        <p role="alert" className="mb-3 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </p>
      )}
      {flashcards.length === 0 ? (
        <p className="rounded-lg border border-dashed border-slate-300 px-4 py-6 text-center text-sm text-slate-500">
          No flashcards yet.
        </p>
      ) : (
        <ul className="grid gap-3 sm:grid-cols-2">
          {flashcards.map((f) => (
            <li key={f.id} className="rounded-lg border border-slate-200 p-3">
              <div className="mb-1 flex items-center justify-between">
                <span className="text-xs font-medium uppercase tracking-wide text-slate-400">Front</span>
                <button
                  type="button"
                  disabled={busy !== null}
                  onClick={() => run(`delete-${f.id}`, () => api.deleteFlashcard(kitId, f.id))}
                  className="rounded px-2 py-0.5 text-xs text-red-600 hover:bg-red-50 disabled:opacity-30"
                >
                  Delete
                </button>
              </div>
              <EditableField
                value={f.front}
                multiline
                label="Flashcard front"
                onSave={(next) => api.updateFlashcard(kitId, f.id, { front: next }).then(onUpdated)}
              />
              <span className="mt-2 block text-xs font-medium uppercase tracking-wide text-slate-400">Back</span>
              <EditableField
                value={f.back}
                multiline
                label="Flashcard back"
                onSave={(next) => api.updateFlashcard(kitId, f.id, { back: next }).then(onUpdated)}
              />
            </li>
          ))}
        </ul>
      )}

      <div className="mt-4">
        {!showAddForm ? (
          <button
            type="button"
            onClick={() => setShowAddForm(true)}
            className="rounded-md border border-dashed border-slate-300 px-3 py-1.5 text-sm text-slate-600 hover:bg-slate-50"
          >
            + Add a flashcard by hand
          </button>
        ) : (
          <form
            className="flex flex-col gap-2 rounded-lg border border-slate-200 p-3 sm:max-w-sm"
            onSubmit={(e) => {
              e.preventDefault();
              run("add", () =>
                api.addFlashcard(kitId, draft).then((kit) => {
                  setDraft({ front: "", back: "" });
                  setShowAddForm(false);
                  return kit;
                })
              );
            }}
          >
            <textarea
              required
              rows={2}
              placeholder="Front"
              value={draft.front}
              onChange={(e) => setDraft((d) => ({ ...d, front: e.target.value }))}
              className="rounded-md border border-slate-300 px-2 py-1 text-sm"
            />
            <textarea
              required
              rows={2}
              placeholder="Back"
              value={draft.back}
              onChange={(e) => setDraft((d) => ({ ...d, back: e.target.value }))}
              className="rounded-md border border-slate-300 px-2 py-1 text-sm"
            />
            <div className="flex items-center gap-2">
              <button
                type="submit"
                disabled={busy !== null}
                className="rounded-md bg-brand px-3 py-1 text-sm text-brand-foreground hover:bg-brand/90 disabled:opacity-60"
              >
                Add
              </button>
              <button
                type="button"
                onClick={() => setShowAddForm(false)}
                className="rounded-md px-3 py-1 text-sm text-slate-600 hover:bg-slate-100"
              >
                Cancel
              </button>
            </div>
          </form>
        )}
      </div>
    </section>
  );
}
