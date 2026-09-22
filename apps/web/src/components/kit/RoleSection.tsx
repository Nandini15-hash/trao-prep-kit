import type { Role } from "@trao/shared";

/**
 * Read-only by design: Section 6 scopes the builder to the company
 * brief, questions, flashcards and schedule. Requirements are the
 * foundation everything else (coverage, scheduling) is checked against,
 * so letting them drift out of sync with the extraction step would
 * undermine the one thing coverage-checking exists to guarantee.
 */
export function RoleSection({ role }: { role: Role }) {
  return (
    <section className="rounded-lg border border-slate-200 bg-white p-4 sm:p-6" aria-labelledby="role-heading">
      <h2 id="role-heading" className="mb-1 text-lg font-semibold tracking-tight">
        {role.title}
      </h2>
      <p className="mb-3 text-sm text-slate-500">{role.seniority}</p>

      {role.responsibilities.length > 0 && (
        <div className="mb-4">
          <span className="text-xs font-medium uppercase tracking-wide text-slate-400">Responsibilities</span>
          <ul className="mt-1 list-inside list-disc text-sm text-slate-700">
            {role.responsibilities.map((r, i) => (
              <li key={i}>{r}</li>
            ))}
          </ul>
        </div>
      )}

      <div>
        <span className="text-xs font-medium uppercase tracking-wide text-slate-400">Requirements</span>
        <ul className="mt-1 flex flex-col gap-1.5">
          {role.requirements.map((req) => (
            <li key={req.id} className="flex items-start gap-2 text-sm">
              <span
                className={`mt-0.5 shrink-0 rounded-full px-2 py-0.5 text-xs font-medium ${
                  req.priority === "must" ? "bg-slate-800 text-white" : "bg-slate-100 text-slate-600"
                }`}
              >
                {req.priority}
              </span>
              <span className="text-slate-700">
                {req.text} <span className="text-slate-400">({req.kind})</span>
              </span>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
