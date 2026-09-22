"use client";

import { useMemo, useState } from "react";
import type { Question, QuestionCategory } from "@trao/shared";
import type { KitRecord } from "@/lib/api";
import * as api from "@/lib/api";
import { EditableField } from "./EditableField";

const CATEGORIES: { value: QuestionCategory; label: string }[] = [
  { value: "technical", label: "Technical" },
  { value: "behavioural", label: "Behavioural" },
  { value: "system-design", label: "System design" },
  { value: "company-fit", label: "Company fit" },
];

function originBadge(question: Question) {
  const origin = question._meta?.origin ?? "generated";
  if (origin === "generated") return null;
  const label = origin === "user_added" ? "Added by you" : "Edited";
  return <span className="rounded-full bg-indigo-100 px-2 py-0.5 text-xs font-medium text-indigo-700">{label}</span>;
}

export function QuestionsSection({
  kitId,
  questions,
  onUpdated,
}: {
  kitId: string;
  questions: Question[];
  onUpdated: (kit: KitRecord) => void;
}) {
  const [activeCategory, setActiveCategory] = useState<QuestionCategory>("technical");
  const [busy, setBusy] = useState<string | null>(null); // a short tag naming what's in flight, for disabling controls
  const [error, setError] = useState<string | null>(null);
  const [showAddForm, setShowAddForm] = useState(false);
  const [draft, setDraft] = useState({ prompt: "", answer_outline: "", difficulty: 2 });

  const inCategory = useMemo(() => questions.filter((q) => q.category === activeCategory), [questions, activeCategory]);

  async function run(tag: string, action: () => Promise<KitRecord>) {
    setBusy(tag);
    setError(null);
    try {
      const kit = await action();
      onUpdated(kit);
    } catch (err) {
      setError(err instanceof api.ApiError ? err.message : "That action didn't go through — please try again.");
    } finally {
      setBusy(null);
    }
  }

  function move(id: string, delta: -1 | 1) {
    const ids = inCategory.map((q) => q.id);
    const idx = ids.indexOf(id);
    const swapWith = idx + delta;
    if (swapWith < 0 || swapWith >= ids.length) return;
    [ids[idx], ids[swapWith]] = [ids[swapWith], ids[idx]];
    run(`reorder-${id}`, () => api.reorderQuestions(kitId, activeCategory, ids));
  }

  return (
    <section className="rounded-lg border border-slate-200 bg-white p-4 sm:p-6" aria-labelledby="questions-heading">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <h2 id="questions-heading" className="text-lg font-semibold tracking-tight">
          Questions
        </h2>
        <button
          type="button"
          onClick={() => run(`regenerate-${activeCategory}`, () => api.regenerateQuestions(kitId, activeCategory))}
          disabled={busy !== null}
          className="rounded-md border border-slate-300 px-3 py-1.5 text-sm text-slate-700 hover:bg-slate-50 disabled:opacity-60"
        >
          {busy === `regenerate-${activeCategory}`
            ? "Regenerating... (this can take a minute)"
            : `Regenerate ${CATEGORIES.find((c) => c.value === activeCategory)?.label}`}
        </button>
      </div>

      <div className="mb-4 flex flex-wrap gap-1 border-b border-slate-200" role="tablist" aria-label="Question category">
        {CATEGORIES.map((c) => {
          const count = questions.filter((q) => q.category === c.value).length;
          return (
            <button
              key={c.value}
              type="button"
              role="tab"
              aria-selected={activeCategory === c.value}
              onClick={() => setActiveCategory(c.value)}
              className={`rounded-t-md px-3 py-2 text-sm ${
                activeCategory === c.value
                  ? "border-b-2 border-brand font-medium text-brand"
                  : "text-slate-500 hover:text-slate-700"
              }`}
            >
              {c.label} <span className="text-xs text-slate-400">({count})</span>
            </button>
          );
        })}
      </div>

      {error && (
        <p role="alert" className="mb-3 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </p>
      )}

      {inCategory.length === 0 ? (
        <p className="rounded-lg border border-dashed border-slate-300 px-4 py-6 text-center text-sm text-slate-500">
          No {CATEGORIES.find((c) => c.value === activeCategory)?.label.toLowerCase()} questions yet.
        </p>
      ) : (
        <ul className="flex flex-col gap-3">
          {inCategory.map((q, i) => (
            <li key={q.id} className="rounded-lg border border-slate-200 p-3">
              <div className="mb-2 flex items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  {originBadge(q)}
                  <span className="text-xs text-slate-400">Difficulty</span>
                  <select
                    aria-label="Difficulty"
                    value={q.difficulty}
                    disabled={busy !== null}
                    onChange={(e) =>
                      run(`difficulty-${q.id}`, () =>
                        api.updateQuestion(kitId, q.id, { difficulty: Number(e.target.value) as 1 | 2 | 3 })
                      )
                    }
                    className="rounded-md border border-slate-300 px-1.5 py-0.5 text-xs"
                  >
                    <option value={1}>1 — easy</option>
                    <option value={2}>2 — medium</option>
                    <option value={3}>3 — hard</option>
                  </select>
                </div>
                <div className="flex items-center gap-1">
                  <button
                    type="button"
                    aria-label="Move up"
                    disabled={i === 0 || busy !== null}
                    onClick={() => move(q.id, -1)}
                    className="rounded px-1.5 py-0.5 text-slate-500 hover:bg-slate-100 disabled:opacity-30"
                  >
                    ↑
                  </button>
                  <button
                    type="button"
                    aria-label="Move down"
                    disabled={i === inCategory.length - 1 || busy !== null}
                    onClick={() => move(q.id, 1)}
                    className="rounded px-1.5 py-0.5 text-slate-500 hover:bg-slate-100 disabled:opacity-30"
                  >
                    ↓
                  </button>
                  <select
                    aria-label="Move to category"
                    value={q.category}
                    disabled={busy !== null}
                    onChange={(e) =>
                      run(`move-${q.id}`, () => api.moveQuestion(kitId, q.id, e.target.value as QuestionCategory))
                    }
                    className="rounded-md border border-slate-300 px-1.5 py-0.5 text-xs"
                  >
                    {CATEGORIES.map((c) => (
                      <option key={c.value} value={c.value}>
                        {c.label}
                      </option>
                    ))}
                  </select>
                  <button
                    type="button"
                    disabled={busy !== null}
                    onClick={() => run(`delete-${q.id}`, () => api.deleteQuestion(kitId, q.id))}
                    className="rounded px-2 py-0.5 text-xs text-red-600 hover:bg-red-50 disabled:opacity-30"
                  >
                    Delete
                  </button>
                </div>
              </div>
              <EditableField
                value={q.prompt}
                multiline
                label="Question prompt"
                onSave={(next) => api.updateQuestion(kitId, q.id, { prompt: next }).then(onUpdated)}
              />
              <div className="mt-1">
                <span className="text-xs font-medium uppercase tracking-wide text-slate-400">Answer outline</span>
                <EditableField
                  value={q.answer_outline}
                  multiline
                  label="Answer outline"
                  onSave={(next) => api.updateQuestion(kitId, q.id, { answer_outline: next }).then(onUpdated)}
                />
              </div>
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
            + Add a question by hand
          </button>
        ) : (
          <form
            className="flex flex-col gap-2 rounded-lg border border-slate-200 p-3"
            onSubmit={(e) => {
              e.preventDefault();
              run("add", () =>
                api.addQuestion(kitId, { category: activeCategory, ...draft }).then((kit) => {
                  setDraft({ prompt: "", answer_outline: "", difficulty: 2 });
                  setShowAddForm(false);
                  return kit;
                })
              );
            }}
          >
            <textarea
              required
              rows={2}
              placeholder="Question prompt"
              value={draft.prompt}
              onChange={(e) => setDraft((d) => ({ ...d, prompt: e.target.value }))}
              className="rounded-md border border-slate-300 px-2 py-1 text-sm"
            />
            <textarea
              required
              rows={2}
              placeholder="Answer outline"
              value={draft.answer_outline}
              onChange={(e) => setDraft((d) => ({ ...d, answer_outline: e.target.value }))}
              className="rounded-md border border-slate-300 px-2 py-1 text-sm"
            />
            <div className="flex items-center gap-2">
              <label className="text-xs text-slate-500">
                Difficulty
                <select
                  value={draft.difficulty}
                  onChange={(e) => setDraft((d) => ({ ...d, difficulty: Number(e.target.value) }))}
                  className="ml-2 rounded-md border border-slate-300 px-1.5 py-0.5 text-xs"
                >
                  <option value={1}>1 — easy</option>
                  <option value={2}>2 — medium</option>
                  <option value={3}>3 — hard</option>
                </select>
              </label>
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
