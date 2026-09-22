import type { Coverage, Requirement } from "@trao/shared";

export function CoverageBanner({ coverage, requirements }: { coverage: Coverage; requirements: Requirement[] }) {
  if (coverage.uncovered_requirement_ids.length === 0) return null;

  const uncovered = requirements.filter((r) => coverage.uncovered_requirement_ids.includes(r.id));

  return (
    <div role="alert" className="rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-800">
      <p className="font-medium">
        {uncovered.length} must-have requirement{uncovered.length === 1 ? "" : "s"} still {"aren't"} covered by any
        question, after {coverage.passes} generation pass{coverage.passes === 1 ? "" : "es"}:
      </p>
      <ul className="mt-1 list-inside list-disc">
        {uncovered.map((r) => (
          <li key={r.id}>{r.text}</li>
        ))}
      </ul>
      <p className="mt-1 text-amber-700">
        Add a question for these by hand, or try regenerating the matching category below.
      </p>
    </div>
  );
}
