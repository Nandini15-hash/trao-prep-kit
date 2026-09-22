"use client";

import { useState } from "react";
import type { Question, Schedule } from "@trao/shared";
import type { KitRecord } from "@/lib/api";
import * as api from "@/lib/api";

export function ScheduleSection({
  kitId,
  schedule,
  questions,
  onUpdated,
}: {
  kitId: string;
  schedule: Schedule;
  questions: Question[];
  onUpdated: (kit: KitRecord) => void;
}) {
  const [daysInput, setDaysInput] = useState(schedule.days_available);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const questionById = new Map(questions.map((q) => [q.id, q]));

  async function regenerate(days?: number) {
    setBusy(true);
    setError(null);
    try {
      onUpdated(await api.regenerateSchedule(kitId, days));
    } catch (err) {
      setError(err instanceof api.ApiError ? err.message : "Couldn't rebuild the schedule.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="rounded-lg border border-slate-200 bg-white p-4 sm:p-6" aria-labelledby="schedule-heading">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <h2 id="schedule-heading" className="text-lg font-semibold tracking-tight">
          Study schedule
        </h2>
        <form
          className="flex items-center gap-2 text-sm"
          onSubmit={(e) => {
            e.preventDefault();
            regenerate(daysInput);
          }}
        >
          <label htmlFor="days-available" className="text-slate-600">
            Days
          </label>
          <input
            id="days-available"
            type="number"
            min={1}
            max={365}
            value={daysInput}
            onChange={(e) => setDaysInput(Number(e.target.value))}
            className="w-16 rounded-md border border-slate-300 px-2 py-1"
          />
          <button
            type="submit"
            disabled={busy}
            className="rounded-md border border-slate-300 px-3 py-1.5 text-slate-700 hover:bg-slate-50 disabled:opacity-60"
          >
            {busy ? "Rebuilding..." : "Rebuild schedule"}
          </button>
        </form>
      </div>
      {error && (
        <p role="alert" className="mb-3 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </p>
      )}
      <ol className="flex flex-col gap-3">
        {schedule.days.map((day) => (
          <li key={day.day} className="rounded-lg border border-slate-200 p-3">
            <div className="mb-1 flex items-center justify-between">
              <span className="font-medium text-slate-800">
                Day {day.day} — {day.focus}
              </span>
              <span className="text-xs text-slate-500">{day.minutes} min</span>
            </div>
            {day.question_ids.length > 0 && (
              <ul className="list-inside list-disc text-sm text-slate-600">
                {day.question_ids.map((qid) => (
                  <li key={qid}>{questionById.get(qid)?.prompt ?? qid}</li>
                ))}
              </ul>
            )}
          </li>
        ))}
      </ol>
    </section>
  );
}
