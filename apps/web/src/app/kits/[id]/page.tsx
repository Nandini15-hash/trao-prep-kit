"use client";

import { useCallback, useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { RequireAuth } from "@/components/RequireAuth";
import { KitStatusBadge } from "@/components/KitStatusBadge";
import { ProgressTimeline } from "@/components/kit/ProgressTimeline";
import { CoverageBanner } from "@/components/kit/CoverageBanner";
import { CompanyBriefSection } from "@/components/kit/CompanyBriefSection";
import { RoleSection } from "@/components/kit/RoleSection";
import { QuestionsSection } from "@/components/kit/QuestionsSection";
import { FlashcardsSection } from "@/components/kit/FlashcardsSection";
import { ScheduleSection } from "@/components/kit/ScheduleSection";
import * as api from "@/lib/api";

function KitDetail({ id }: { id: string }) {
  const router = useRouter();
  const [kit, setKit] = useState<api.KitRecord | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);

  const refresh = useCallback(async () => {
    try {
      const record = await api.getKit(id);
      setKit(record);
      setError(null);
    } catch (err) {
      setError(err instanceof api.ApiError ? err.message : "Could not load this kit.");
    }
  }, [id]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  useEffect(() => {
    if (!kit || (kit.status !== "pending" && kit.status !== "generating")) return;
    const interval = setInterval(refresh, 2500);
    return () => clearInterval(interval);
  }, [kit, refresh]);

  async function onDelete() {
    if (!confirm("Delete this kit? This can't be undone.")) return;
    setDeleting(true);
    try {
      await api.deleteKit(id);
      router.push("/kits");
    } catch (err) {
      setError(err instanceof api.ApiError ? err.message : "Couldn't delete this kit.");
      setDeleting(false);
    }
  }

  if (error && !kit) {
    return (
      <div className="flex flex-col gap-3">
        <p role="alert" className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </p>
        <Link href="/kits" className="text-sm text-brand hover:underline">
          ← Back to your kits
        </Link>
      </div>
    );
  }

  if (!kit) {
    return (
      <div className="flex min-h-[40vh] items-center justify-center text-slate-500" role="status" aria-live="polite">
        Loading kit...
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <Link href="/kits" className="text-sm text-slate-500 hover:underline">
            ← Your kits
          </Link>
          <h1 className="mt-1 text-2xl font-semibold tracking-tight">
            {kit.data ? `${kit.data.role.title} @ ${kit.data.source.company}` : kit.input.companyUrl}
          </h1>
        </div>
        <div className="flex items-center gap-3">
          <KitStatusBadge status={kit.status} />
          {kit.status === "ready" && (
            <Link
              href={`/kits/${id}/practice`}
              className="rounded-md bg-brand px-3 py-1.5 text-sm text-brand-foreground hover:bg-brand/90"
            >
              Practice
            </Link>
          )}
          <button
            type="button"
            onClick={onDelete}
            disabled={deleting}
            className="rounded-md border border-red-200 px-3 py-1.5 text-sm text-red-600 hover:bg-red-50 disabled:opacity-60"
          >
            {deleting ? "Deleting..." : "Delete"}
          </button>
        </div>
      </div>

      {(kit.status === "pending" || kit.status === "generating") && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 p-4 sm:p-6">
          <p className="mb-3 text-sm font-medium text-amber-800">
            Researching {kit.input.companyUrl} and generating your kit. This usually takes under a minute, but free-tier
            rate limits can slow it down — feel free to leave this page and come back.
          </p>
          <ProgressTimeline progress={kit.progress} />
        </div>
      )}

      {kit.status === "failed" && (
        <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700 sm:p-6">
          <p className="font-medium">Generation failed{kit.error ? `: ${kit.error.message}` : "."}</p>
          <p className="mt-1 text-red-600">
            You can delete this and try again — a transient provider error or rate limit is the most common cause.
          </p>
        </div>
      )}

      {kit.status === "ready" && kit.data && (
        <>
          {error && (
            <p role="alert" className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">
              {error}
            </p>
          )}
          <CoverageBanner coverage={kit.data.coverage} requirements={kit.data.role.requirements} />
          <CompanyBriefSection kitId={id} brief={kit.data.company_brief} onUpdated={setKit} />
          <RoleSection role={kit.data.role} />
          <QuestionsSection kitId={id} questions={kit.data.questions} onUpdated={setKit} />
          <FlashcardsSection kitId={id} flashcards={kit.data.flashcards} onUpdated={setKit} />
          <ScheduleSection kitId={id} schedule={kit.data.schedule} questions={kit.data.questions} onUpdated={setKit} />
        </>
      )}
    </div>
  );
}

export default function KitDetailPage() {
  const params = useParams<{ id: string }>();
  return (
    <RequireAuth>
      <KitDetail id={params.id} />
    </RequireAuth>
  );
}
