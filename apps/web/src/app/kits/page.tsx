"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { RequireAuth } from "@/components/RequireAuth";
import { CreateKitForm } from "@/components/CreateKitForm";
import { KitStatusBadge } from "@/components/KitStatusBadge";
import * as api from "@/lib/api";

function KitsDashboard() {
  const [kits, setKits] = useState<api.KitRecord[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const { kits } = await api.listKits();
      setKits(kits);
      setError(null);
    } catch (err) {
      setError(err instanceof api.ApiError ? err.message : "Could not load your kits.");
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  // Poll while anything is still in flight, so a kit's status/progress on
  // this list updates without a manual refresh (Section 12: "watch the
  // kit being generated, with visible progress"). Stops polling once
  // nothing is pending/generating.
  useEffect(() => {
    if (!kits || !kits.some((k) => k.status === "pending" || k.status === "generating")) return;
    const id = setInterval(refresh, 3000);
    return () => clearInterval(id);
  }, [kits, refresh]);

  return (
    <div className="flex flex-col gap-6">
      <CreateKitForm onCreated={refresh} />

      <div>
        <h2 className="mb-3 text-lg font-semibold tracking-tight">Your kits</h2>
        {error && (
          <p role="alert" className="mb-3 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">
            {error}
          </p>
        )}
        {kits === null && !error ? (
          <p className="text-sm text-slate-500">Loading your kits...</p>
        ) : kits && kits.length === 0 ? (
          <p className="rounded-lg border border-dashed border-slate-300 px-4 py-8 text-center text-sm text-slate-500">
            No kits yet — paste a job description above to generate your first one.
          </p>
        ) : (
          <ul className="flex flex-col gap-2">
            {kits?.map((kit) => (
              <li key={kit.id}>
                <Link
                  href={`/kits/${kit.id}`}
                  className="flex items-center justify-between gap-4 rounded-lg border border-slate-200 bg-white px-4 py-3 hover:border-brand focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand"
                >
                  <div className="min-w-0">
                    <p className="truncate font-medium text-slate-900">
                      {kit.data ? `${kit.data.role.title} @ ${kit.data.source.company}` : kit.input.companyUrl}
                    </p>
                    <p className="text-xs text-slate-500">
                      {kit.status === "failed" && kit.error ? kit.error.message : `${kit.input.days} day schedule`}
                    </p>
                  </div>
                  <KitStatusBadge status={kit.status} />
                </Link>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

export default function KitsPage() {
  return (
    <RequireAuth>
      <KitsDashboard />
    </RequireAuth>
  );
}
