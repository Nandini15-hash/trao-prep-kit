"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { RequireAuth } from "@/components/RequireAuth";
import * as api from "@/lib/api";

/**
 * Optional creative feature (the brief names this as one of a few
 * reasonable directions): a printable one-pager.
 *
 * The problem it solves: everything else in this app is designed to be
 * used on a screen, mid-edit, with a live connection to the backend. The
 * day of the interview, someone doesn't want to be tabbing between
 * question categories on their phone in a waiting room — they want one
 * page (or a PDF of one) they can glance at, or have printed out. This
 * route is a plain, print-optimized rendering of the ready kit: no
 * editing controls, no polling, no interactivity beyond the browser's
 * own print dialog (which doubles as "Save as PDF" in every modern
 * browser, so this needed no PDF library on either side).
 *
 * It's intentionally a separate route rather than a print stylesheet
 * bolted onto the builder page: the builder's DOM is full of buttons,
 * inputs and tab panels that would need to be hidden one by one and
 * would still print each question's full editable state; a dedicated
 * read-only layout is simpler to get right and easier to keep looking
 * good as the builder's own layout changes.
 */
function PrintableKit({ id }: { id: string }) {
  const [kit, setKit] = useState<api.KitRecord | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api
      .getKit(id)
      .then(setKit)
      .catch((err) => setError(err instanceof api.ApiError ? err.message : "Could not load this kit."));
  }, [id]);

  if (error) {
    return (
      <p role="alert" className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">
        {error}
      </p>
    );
  }

  if (!kit) {
    return <p className="text-sm text-slate-500">Loading...</p>;
  }

  if (kit.status !== "ready" || !kit.data) {
    return <p className="text-sm text-slate-500">This kit isn&apos;t ready yet — come back once generation finishes.</p>;
  }

  const { data } = kit;
  const questionById = new Map(data.questions.map((q) => [q.id, q]));
  const categoryLabels: Record<string, string> = {
    technical: "Technical",
    behavioural: "Behavioural",
    "system-design": "System design",
    "company-fit": "Company fit",
  };

  return (
    <div className="mx-auto max-w-3xl">
      <div className="mb-6 flex items-center justify-between print:hidden">
        <Link href={`/kits/${id}`} className="text-sm text-slate-500 hover:underline">
          ← Back to kit
        </Link>
        <button
          type="button"
          onClick={() => window.print()}
          className="rounded-md bg-brand px-4 py-2 text-sm text-brand-foreground hover:bg-brand/90"
        >
          Print / Save as PDF
        </button>
      </div>

      <article className="flex flex-col gap-6 text-sm leading-relaxed text-slate-900 print:text-black">
        <header className="border-b border-slate-300 pb-3">
          <h1 className="text-2xl font-semibold tracking-tight">
            {data.role.title} @ {data.source.company}
          </h1>
          <p className="text-slate-500 print:text-black">
            {data.role.seniority} · {data.source.location} · {data.schedule.days_available}-day plan
          </p>
        </header>

        <section className="break-inside-avoid">
          <h2 className="mb-1 text-base font-semibold">Company brief</h2>
          <p>{data.company_brief.summary}</p>
          {data.company_brief.what_they_do && <p className="mt-1">{data.company_brief.what_they_do}</p>}
        </section>

        <section className="break-inside-avoid">
          <h2 className="mb-1 text-base font-semibold">Requirements</h2>
          <ul className="flex flex-col gap-0.5">
            {data.role.requirements.map((r) => (
              <li key={r.id}>
                <span className="font-medium">{r.priority === "must" ? "Must:" : "Nice:"}</span> {r.text}
              </li>
            ))}
          </ul>
        </section>

        <section>
          <h2 className="mb-2 text-base font-semibold">Questions</h2>
          {(["technical", "behavioural", "system-design", "company-fit"] as const).map((cat) => {
            const qs = data.questions.filter((q) => q.category === cat);
            if (qs.length === 0) return null;
            return (
              <div key={cat} className="mb-3 break-inside-avoid">
                <h3 className="mb-1 text-sm font-semibold text-slate-600 print:text-black">
                  {categoryLabels[cat]}
                </h3>
                <ol className="flex flex-col gap-2">
                  {qs.map((q) => (
                    <li key={q.id} className="break-inside-avoid">
                      <p className="font-medium">{q.prompt}</p>
                      <p className="text-slate-600 print:text-black">{q.answer_outline}</p>
                    </li>
                  ))}
                </ol>
              </div>
            );
          })}
        </section>

        <section className="break-inside-avoid">
          <h2 className="mb-2 text-base font-semibold">Flashcards</h2>
          <div className="grid grid-cols-2 gap-x-6 gap-y-1">
            {data.flashcards.map((f) => (
              <p key={f.id}>
                <span className="font-medium">{f.front}</span> — {f.back}
              </p>
            ))}
          </div>
        </section>

        <section>
          <h2 className="mb-2 text-base font-semibold">Study schedule</h2>
          {data.schedule.days.map((day) => (
            <div key={day.day} className="mb-2 break-inside-avoid">
              <p className="font-medium">
                Day {day.day} — {day.focus} ({day.minutes} min)
              </p>
              {day.question_ids.length > 0 && (
                <ul className="ml-4 list-disc text-slate-600 print:text-black">
                  {day.question_ids.map((qid) => (
                    <li key={qid}>{questionById.get(qid)?.prompt ?? qid}</li>
                  ))}
                </ul>
              )}
            </div>
          ))}
        </section>
      </article>
    </div>
  );
}

export default function PrintKitPage() {
  const params = useParams<{ id: string }>();
  return (
    <RequireAuth>
      <PrintableKit id={params.id} />
    </RequireAuth>
  );
}
