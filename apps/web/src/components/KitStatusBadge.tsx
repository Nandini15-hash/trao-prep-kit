import type { KitStatus } from "@/lib/api";

const STYLES: Record<KitStatus, string> = {
  pending: "bg-slate-100 text-slate-600",
  generating: "bg-amber-100 text-amber-700",
  ready: "bg-emerald-100 text-emerald-700",
  failed: "bg-red-100 text-red-700",
};

const LABELS: Record<KitStatus, string> = {
  pending: "Queued",
  generating: "Generating...",
  ready: "Ready",
  failed: "Failed",
};

export function KitStatusBadge({ status }: { status: KitStatus }) {
  return (
    <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${STYLES[status]}`}>
      {LABELS[status]}
    </span>
  );
}
