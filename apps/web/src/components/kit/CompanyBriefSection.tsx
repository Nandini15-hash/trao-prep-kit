"use client";

import { useState } from "react";
import type { CompanyBrief } from "@trao/shared";
import type { KitRecord } from "@/lib/api";
import * as api from "@/lib/api";
import { EditableField } from "./EditableField";

export function CompanyBriefSection({
  kitId,
  brief,
  onUpdated,
}: {
  kitId: string;
  brief: CompanyBrief;
  onUpdated: (kit: KitRecord) => void;
}) {
  const [regenerating, setRegenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function regenerate() {
    setRegenerating(true);
    setError(null);
    try {
      const kit = await api.regenerateCompanyBrief(kitId);
      onUpdated(kit);
    } catch (err) {
      setError(err instanceof api.ApiError ? err.message : "Couldn't regenerate the company brief.");
    } finally {
      setRegenerating(false);
    }
  }

  return (
    <section className="rounded-lg border border-slate-200 bg-white p-4 sm:p-6" aria-labelledby="company-brief-heading">
      <div className="mb-3 flex items-center justify-between gap-4">
        <h2 id="company-brief-heading" className="text-lg font-semibold tracking-tight">
          Company brief
        </h2>
        <button
          type="button"
          onClick={regenerate}
          disabled={regenerating}
          className="rounded-md border border-slate-300 px-3 py-1.5 text-sm text-slate-700 hover:bg-slate-50 disabled:opacity-60"
        >
          {regenerating ? "Regenerating... (this can take a minute)" : "Regenerate"}
        </button>
      </div>
      {error && (
        <p role="alert" className="mb-2 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </p>
      )}
      <div className="flex flex-col gap-3">
        <div>
          <span className="text-xs font-medium uppercase tracking-wide text-slate-400">Summary</span>
          <EditableField
            value={brief.summary}
            multiline
            label="Company summary"
            onSave={(next) => api.updateCompanyBrief(kitId, { summary: next }).then(onUpdated)}
          />
        </div>
        <div>
          <span className="text-xs font-medium uppercase tracking-wide text-slate-400">What they do</span>
          <EditableField
            value={brief.what_they_do}
            multiline
            label="What they do"
            onSave={(next) => api.updateCompanyBrief(kitId, { what_they_do: next }).then(onUpdated)}
          />
        </div>
        {brief.sources.length > 0 && (
          <div>
            <span className="text-xs font-medium uppercase tracking-wide text-slate-400">Sources</span>
            <ul className="mt-1 flex flex-col gap-0.5">
              {brief.sources.map((src) => (
                <li key={src}>
                  <a href={src} target="_blank" rel="noreferrer" className="text-sm text-brand hover:underline">
                    {src}
                  </a>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </section>
  );
}
