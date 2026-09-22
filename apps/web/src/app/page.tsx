"use client";

import Link from "next/link";
import { useAuth } from "@/contexts/AuthContext";

export default function HomePage() {
  const { user, loading } = useAuth();

  return (
    <div className="mx-auto flex max-w-2xl flex-col items-start gap-4 py-10">
      <h1 className="text-2xl font-semibold tracking-tight">Interview Prep Kit</h1>
      <p className="text-slate-600">
        Paste a job description and a company URL, and get a research-backed prep kit: a company
        brief, role breakdown, categorised question bank, flashcards, and a day-by-day study
        schedule — built by actually crawling the company site and looking for public discussion
        of how they interview, not a single canned prompt.
      </p>
      <p className="text-slate-600">Edit anything, regenerate a single section without losing your edits, and practise against the flashcards inside the app.</p>
      {!loading && (
        <Link
          href={user ? "/kits" : "/register"}
          className="mt-2 rounded-md bg-brand px-4 py-2 text-brand-foreground hover:bg-brand/90 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand"
        >
          {user ? "Go to your kits" : "Get started"}
        </Link>
      )}
    </div>
  );
}
