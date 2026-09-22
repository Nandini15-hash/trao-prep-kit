export default function HomePage() {
  return (
    <main className="mx-auto flex max-w-2xl flex-col items-start gap-4 px-6 py-16">
      <h1 className="text-2xl font-semibold tracking-tight">Interview Prep Kit</h1>
      <p className="text-slate-600">
        Paste a job description and a company URL, and get a research-backed
        prep kit: a company brief, role breakdown, question bank,
        flashcards, and a day-by-day study schedule.
      </p>
      <p className="text-sm text-slate-400">Scaffold in progress — sign-in and the kit builder land next.</p>
    </main>
  );
}
