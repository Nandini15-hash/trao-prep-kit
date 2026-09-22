import {
  CompanyBrief,
  defaultMeta,
  EditMeta,
  Flashcard,
  Kit,
  Question,
  QuestionCategory,
} from "@trao/shared";
import { crawlCompanySite } from "./retrieval/crawler";
import { searchPublicInterviewDiscussion } from "./search/tavily";
import { generateCompanyBrief } from "./generation/generate-company-brief";
import { generateQuestionsForCategory } from "./generation/generate-questions";
import { generateCompanyFitQuestions } from "./generation/generate-company-fit-questions";
import { detectHiringSignals } from "./generation/hiring-signals";
import { planCategoryAssignments, RequirementCategory, shouldGenerateCompanyFit } from "./generation/plan-categories";
import { findUncoveredRequirementIds } from "./generation/coverage";
import { allocateSchedule } from "./generation/schedule";
import { deriveCompanyName } from "./generation/derive-company-name";

/**
 * Section 6: "Decide how you represent generated, edited and pinned
 * state ... This is the hardest state problem in the assessment."
 *
 * The representation: every question, flashcard, and the company brief
 * carries an optional `_meta: { origin, pinned }` (defined in
 * @trao/shared, additive to Appendix A). `pinned` is the whole
 * mechanism — it starts false on anything the model generated, and flips
 * to true the moment a user edits it, adds it by hand, or (implicitly)
 * once it survives being explicitly kept. A regeneration of a section
 * only ever replaces items where pinned === false; anything pinned is
 * left untouched and excluded from what's re-requested from the model,
 * so a user's hand-written question doesn't just survive numerically —
 * the regeneration doesn't even ask the model to redo that ground.
 *
 * All functions here return a NEW Kit object (Appendix A fields are
 * plain data, so this stays simple and avoids partially-mutated state on
 * a thrown error mid-edit) rather than mutating in place.
 */

function touch(meta: EditMeta | undefined, origin: EditMeta["origin"]): EditMeta {
  return { origin, pinned: true, generation_pass: meta?.generation_pass, updated_at: new Date().toISOString() };
}

function nextNumericId(ids: string[], prefix: string): string {
  let max = 0;
  for (const id of ids) {
    if (!id.startsWith(prefix)) continue;
    const n = Number(id.slice(prefix.length));
    if (Number.isFinite(n)) max = Math.max(max, n);
  }
  return `${prefix}${max + 1}`;
}

/** Recomputes coverage + schedule from the kit's current questions —
 *  called after every mutation, since both are pure derivations of
 *  (requirements, questions, days_available) and must never go stale
 *  relative to a question that was just edited, added, or deleted. */
function finalize(kit: Kit): Kit {
  const { mustHaveGaps } = findUncoveredRequirementIds(kit.role.requirements, kit.questions);
  return {
    ...kit,
    coverage: { uncovered_requirement_ids: mustHaveGaps, passes: kit.coverage.passes },
    schedule: allocateSchedule(kit.role.requirements, kit.questions, kit.schedule.days_available),
  };
}

// ---- direct edits (mark pinned, no regeneration) ---------------------

export function editQuestion(
  kit: Kit,
  questionId: string,
  patch: Partial<Pick<Question, "prompt" | "answer_outline" | "difficulty" | "category" | "requirement_ids">>
): Kit {
  const questions = kit.questions.map((q) =>
    q.id === questionId ? { ...q, ...patch, _meta: touch(q._meta, "edited") } : q
  );
  return finalize({ ...kit, questions });
}

export function addQuestion(
  kit: Kit,
  draft: Pick<Question, "category" | "prompt" | "answer_outline" | "difficulty" | "requirement_ids">
): Kit {
  const id = nextNumericId(kit.questions.map((q) => q.id), "q");
  const question: Question = { id, ...draft, _meta: touch(undefined, "user_added") };
  return finalize({ ...kit, questions: [...kit.questions, question] });
}

export function deleteQuestion(kit: Kit, questionId: string): Kit {
  return finalize({ ...kit, questions: kit.questions.filter((q) => q.id !== questionId) });
}

export function moveQuestionToCategory(kit: Kit, questionId: string, category: QuestionCategory): Kit {
  return editQuestion(kit, questionId, { category });
}

export function reorderQuestionsInCategory(kit: Kit, category: QuestionCategory, orderedIds: string[]): Kit {
  const inCategory = kit.questions.filter((q) => q.category === category);
  const others = kit.questions.filter((q) => q.category !== category);
  const byId = new Map(inCategory.map((q) => [q.id, q]));
  const reordered = orderedIds.map((id) => byId.get(id)).filter((q): q is Question => Boolean(q));
  const missing = inCategory.filter((q) => !orderedIds.includes(q.id));
  return { ...kit, questions: [...others, ...reordered, ...missing] };
}

export function editFlashcard(kit: Kit, flashcardId: string, patch: Partial<Pick<Flashcard, "front" | "back" | "requirement_ids">>): Kit {
  const flashcards = kit.flashcards.map((f) =>
    f.id === flashcardId ? { ...f, ...patch, _meta: touch(f._meta, "edited") } : f
  );
  return { ...kit, flashcards };
}

export function addFlashcard(kit: Kit, draft: Pick<Flashcard, "front" | "back" | "requirement_ids">): Kit {
  const id = nextNumericId(kit.flashcards.map((f) => f.id), "f");
  const flashcard: Flashcard = { id, ...draft, _meta: touch(undefined, "user_added") };
  return { ...kit, flashcards: [...kit.flashcards, flashcard] };
}

export function deleteFlashcard(kit: Kit, flashcardId: string): Kit {
  return { ...kit, flashcards: kit.flashcards.filter((f) => f.id !== flashcardId) };
}

export function editCompanyBrief(kit: Kit, patch: Partial<Pick<CompanyBrief, "summary" | "what_they_do">>): Kit {
  return { ...kit, company_brief: { ...kit.company_brief, ...patch, _meta: touch(kit.company_brief._meta, "edited") } };
}

// ---- regeneration (re-fetches research context, preserves pinned items) --

async function researchContext(companyUrl: string) {
  const crawl = await crawlCompanySite(companyUrl).catch(() => ({
    pages: [],
    aboutPage: null,
    hiringPage: null,
    skipped: [],
    failed: [],
  }));
  const companyName = deriveCompanyName(companyUrl, crawl.pages);
  const discussion = await searchPublicInterviewDiscussion(companyName);
  const hiringContext = [
    crawl.hiringPage?.text,
    ...discussion.results.map((r) => `${r.title}: ${r.snippet}`),
  ]
    .filter(Boolean)
    .join("\n\n");
  const pagesText = [crawl.aboutPage?.text, crawl.pages[0]?.text].filter(Boolean).join("\n\n");
  return { crawl, companyName, hiringContext, signals: detectHiringSignals(hiringContext), pagesText };
}

/** Section 6: regenerating the brief is a whole-section replace — there's
 *  no itemized list to partially preserve the way there is for
 *  questions, so an explicit regenerate always produces a fresh brief. */
export async function regenerateCompanyBrief(kit: Kit): Promise<Kit> {
  const { companyName, pagesText, crawl } = await researchContext(kit.source.company_url);
  if (!pagesText.trim()) {
    return {
      ...kit,
      company_brief: {
        summary: `We could not retrieve any usable pages from ${kit.source.company_url}, so this brief is based only on the job description.`,
        what_they_do: "",
        sources: [],
      },
    };
  }
  const brief = await generateCompanyBrief({ companyName, pagesText });
  return {
    ...kit,
    company_brief: {
      ...brief,
      sources: [crawl.aboutPage?.url, crawl.pages[0]?.url].filter((u): u is string => Boolean(u)),
    },
  };
}

/**
 * Section 6's central requirement: "a question the user wrote or edited
 * by hand must survive a regeneration of its category." Pinned questions
 * in this category are left exactly as they are and are not
 * re-requested from the model; only the requirements not already covered
 * by a pinned survivor go back to the model for fresh questions.
 */
export async function regenerateQuestionCategory(kit: Kit, category: RequirementCategory): Promise<Kit> {
  const { companyName, hiringContext } = await researchContext(kit.source.company_url);

  const pinnedInCategory = kit.questions.filter((q) => q.category === category && q._meta?.pinned);
  const otherQuestions = kit.questions.filter((q) => q.category !== category);
  const coveredByPinned = new Set(pinnedInCategory.flatMap((q) => q.requirement_ids));

  const plan = planCategoryAssignments(
    kit.role.requirements,
    detectHiringSignals(hiringContext),
    kit.role.seniority
  );
  const requirementsNeeded = plan[category].filter((r) => !coveredByPinned.has(r.id));

  const drafts = await generateQuestionsForCategory({
    category,
    requirements: requirementsNeeded,
    companyName,
    hiringContext,
  });

  const usedIds = new Set(kit.questions.map((q) => q.id));
  const fresh: Question[] = drafts.map((d) => {
    const id = nextNumericId([...usedIds], "q");
    usedIds.add(id);
    return {
      id,
      requirement_ids: d.requirement_ids,
      category,
      prompt: d.prompt,
      answer_outline: d.answer_outline,
      difficulty: d.difficulty,
      _meta: defaultMeta("generated"),
    };
  });

  return finalize({ ...kit, questions: [...otherQuestions, ...pinnedInCategory, ...fresh] });
}

/** Section 6: regenerating "company-fit" questions the same way as a
 *  requirement-driven category, just sourced from the brief instead. */
export async function regenerateCompanyFitQuestions(kit: Kit): Promise<Kit> {
  const { companyName, hiringContext } = await researchContext(kit.source.company_url);
  const briefText = `${kit.company_brief.summary}\n${kit.company_brief.what_they_do}`;

  const pinned = kit.questions.filter((q) => q.category === "company-fit" && q._meta?.pinned);
  const others = kit.questions.filter((q) => q.category !== "company-fit");

  if (!shouldGenerateCompanyFit(briefText)) {
    return finalize({ ...kit, questions: [...others, ...pinned] });
  }

  const drafts = await generateCompanyFitQuestions({ companyName, companyBriefText: briefText, hiringContext });
  const usedIds = new Set(kit.questions.map((q) => q.id));
  const fresh: Question[] = drafts.map((d) => {
    let id = nextNumericId([...usedIds], "q");
    usedIds.add(id);
    return {
      id,
      requirement_ids: [],
      category: "company-fit",
      prompt: d.prompt,
      answer_outline: d.answer_outline,
      difficulty: d.difficulty,
      _meta: defaultMeta("generated"),
    };
  });

  return finalize({ ...kit, questions: [...others, ...pinned, ...fresh] });
}

/** Pure recompute — no model call. Also lets days_available change. */
export function regenerateSchedule(kit: Kit, daysAvailable?: number): Kit {
  const days = daysAvailable ?? kit.schedule.days_available;
  return { ...kit, schedule: allocateSchedule(kit.role.requirements, kit.questions, days) };
}
