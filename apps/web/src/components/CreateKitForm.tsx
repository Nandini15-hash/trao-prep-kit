"use client";

import { FormEvent, useRef, useState } from "react";
import * as api from "@/lib/api";
import { ApiError } from "@/lib/api";

/**
 * Section 2: "a textarea for the job description, and a field for the
 * company website" plus "a way to prepare for more than one role —
 * pasting again, or uploading a file of description-and-company pairs."
 * Both live here: the default single form, and a bulk-upload mode that
 * accepts a JSON array of {jd, company_url, days} objects (the same
 * shape Appendix B's batch cases use) and submits each through the same
 * single-kit endpoint the form itself uses — no separate backend path.
 */
export function CreateKitForm({ onCreated }: { onCreated: () => void }) {
  const [mode, setMode] = useState<"single" | "bulk">("single");
  const [jd, setJd] = useState("");
  const [companyUrl, setCompanyUrl] = useState("");
  const [days, setDays] = useState(7);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [bulkStatus, setBulkStatus] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  async function onSubmitSingle(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      await api.createKit({ jd, companyUrl, days });
      setJd("");
      setCompanyUrl("");
      setDays(7);
      onCreated();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not create the kit. Please try again.");
    } finally {
      setSubmitting(false);
    }
  }

  async function onBulkFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setError(null);
    setBulkStatus(null);

    let entries: { jd: string; company_url: string; days: number }[];
    try {
      const text = await file.text();
      const parsed = JSON.parse(text);
      if (!Array.isArray(parsed)) throw new Error("Expected a JSON array");
      entries = parsed;
    } catch (err) {
      setError(
        `Couldn't read that file — expected a JSON array of { jd, company_url, days } objects. (${
          err instanceof Error ? err.message : String(err)
        })`
      );
      if (fileInputRef.current) fileInputRef.current.value = "";
      return;
    }

    setSubmitting(true);
    let ok = 0;
    let failed = 0;
    for (const [i, entry] of entries.entries()) {
      setBulkStatus(`Submitting ${i + 1} of ${entries.length}...`);
      try {
        await api.createKit({ jd: entry.jd, companyUrl: entry.company_url, days: entry.days });
        ok += 1;
      } catch {
        failed += 1;
      }
    }
    setBulkStatus(`Done — ${ok} submitted${failed > 0 ? `, ${failed} failed to submit` : ""}.`);
    setSubmitting(false);
    if (fileInputRef.current) fileInputRef.current.value = "";
    onCreated();
  }

  return (
    <div className="rounded-lg border border-slate-200 bg-white p-4 sm:p-6">
      <div className="mb-4 flex gap-2 text-sm" role="tablist" aria-label="Kit creation mode">
        <button
          type="button"
          role="tab"
          aria-selected={mode === "single"}
          onClick={() => setMode("single")}
          className={`rounded-md px-3 py-1.5 ${mode === "single" ? "bg-brand text-brand-foreground" : "text-slate-600 hover:bg-slate-100"}`}
        >
          New kit
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={mode === "bulk"}
          onClick={() => setMode("bulk")}
          className={`rounded-md px-3 py-1.5 ${mode === "bulk" ? "bg-brand text-brand-foreground" : "text-slate-600 hover:bg-slate-100"}`}
        >
          Bulk upload
        </button>
      </div>

      {mode === "single" ? (
        <form onSubmit={onSubmitSingle} className="flex flex-col gap-4" noValidate>
          <div className="flex flex-col gap-1">
            <label htmlFor="jd" className="text-sm font-medium text-slate-700">
              Job description
            </label>
            <textarea
              id="jd"
              required
              rows={6}
              value={jd}
              onChange={(e) => setJd(e.target.value)}
              placeholder="Paste the full job description here..."
              className="rounded-md border border-slate-300 px-3 py-2 focus:border-brand focus:outline-none focus:ring-1 focus:ring-brand"
            />
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="flex flex-col gap-1">
              <label htmlFor="companyUrl" className="text-sm font-medium text-slate-700">
                Company website
              </label>
              <input
                id="companyUrl"
                type="text"
                required
                value={companyUrl}
                onChange={(e) => setCompanyUrl(e.target.value)}
                placeholder="https://acme.example"
                className="rounded-md border border-slate-300 px-3 py-2 focus:border-brand focus:outline-none focus:ring-1 focus:ring-brand"
              />
            </div>
            <div className="flex flex-col gap-1">
              <label htmlFor="days" className="text-sm font-medium text-slate-700">
                Days until the interview
              </label>
              <input
                id="days"
                type="number"
                required
                min={1}
                max={365}
                value={days}
                onChange={(e) => setDays(Number(e.target.value))}
                className="rounded-md border border-slate-300 px-3 py-2 focus:border-brand focus:outline-none focus:ring-1 focus:ring-brand"
              />
            </div>
          </div>
          {error && (
            <p role="alert" className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">
              {error}
            </p>
          )}
          <button
            type="submit"
            disabled={submitting}
            className="self-start rounded-md bg-brand px-4 py-2 text-brand-foreground hover:bg-brand/90 disabled:opacity-60 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand"
          >
            {submitting ? "Starting..." : "Generate kit"}
          </button>
        </form>
      ) : (
        <div className="flex flex-col gap-3">
          <p className="text-sm text-slate-600">
            Upload a JSON file with an array of postings to prepare for at once, each shaped like{" "}
            <code className="rounded bg-slate-100 px-1 py-0.5 text-xs">
              {"{ \"jd\": \"...\", \"company_url\": \"https://...\", \"days\": 7 }"}
            </code>
            .
          </p>
          <input
            ref={fileInputRef}
            type="file"
            accept="application/json"
            onChange={onBulkFile}
            disabled={submitting}
            className="text-sm"
          />
          {bulkStatus && <p className="text-sm text-slate-600">{bulkStatus}</p>}
          {error && (
            <p role="alert" className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">
              {error}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
