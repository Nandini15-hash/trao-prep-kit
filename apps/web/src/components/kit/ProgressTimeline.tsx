import type { ProgressEntry } from "@/lib/api";

const STEP_LABELS: Record<string, string> = {
  extract_requirements: "Reading the job description",
  crawl_company_site: "Crawling the company site",
  search_public_discussion: "Searching for public interview discussion",
  company_brief: "Writing the company brief",
  generate_questions: "Generating questions",
  coverage_check: "Checking requirement coverage",
  generate_flashcards: "Building flashcards",
  build_schedule: "Building the study schedule",
};

const ICON: Record<ProgressEntry["status"], string> = {
  running: "●", // ●
  done: "✓", // ✓
  skipped: "–", // –
  failed: "✕", // ✕
};

const COLOR: Record<ProgressEntry["status"], string> = {
  running: "text-amber-600 animate-pulse",
  done: "text-emerald-600",
  skipped: "text-slate-400",
  failed: "text-red-600",
};

/** Section 12: "watch the kit being generated, with visible progress."
 *  Renders the pipeline's onProgress trail (services/generation/
 *  pipeline.ts) as a simple step list rather than a bare spinner, so a
 *  slow or partially-failed run is legible while it's still in flight. */
export function ProgressTimeline({ progress }: { progress: ProgressEntry[] }) {
  if (progress.length === 0) {
    return <p className="text-sm text-slate-500">Starting up...</p>;
  }
  return (
    <ol className="flex flex-col gap-2" aria-live="polite">
      {progress.map((entry, i) => (
        <li key={`${entry.step}-${i}`} className="flex items-start gap-2 text-sm">
          <span className={`mt-0.5 ${COLOR[entry.status]}`} aria-hidden="true">
            {ICON[entry.status]}
          </span>
          <span className="flex-1">
            <span className="text-slate-800">{STEP_LABELS[entry.step] ?? entry.step}</span>
            {entry.detail && <span className="text-slate-500"> — {entry.detail}</span>}
          </span>
        </li>
      ))}
    </ol>
  );
}
