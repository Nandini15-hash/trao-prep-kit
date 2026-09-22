import { CompanyBrief, Coverage, Flashcard, Kit, Question, Requirement, Schedule, Source, defaultMeta } from "@trao/shared";
import { crawlCompanySite } from "../retrieval/crawler";
import { searchPublicInterviewDiscussion } from "../search/tavily";
import { extractRequirements } from "./extract-requirements";
import { generateCompanyBrief } from "./generate-company-brief";
import { generateQuestionsForCategory, QuestionDraft } from "./generate-questions";
import { generateCompanyFitQuestions } from "./generate-company-fit-questions";
import { generateFlashcards } from "./generate-flashcards";
import { detectHiringSignals } from "./hiring-signals";
import { planCategoryAssignments, shouldGenerateCompanyFit, RequirementCategory } from "./plan-categories";
import { findUncoveredRequirementIds } from "./coverage";
import { allocateSchedule } from "./schedule";
import { deriveCompanyName } from "./derive-company-name";
import { LlmError } from "../llm";

const MAX_TEXT_CHARS = 6000; // keeps prompts (and token spend) bounded per source
const MAX_COVERAGE_PASSES = 2; // initial generation (pass 0) + up to 2 gap-fill passes

export type ProgressStep =
  | "extract_requirements"
  | "crawl_company_site"
  | "search_public_discussion"
  | "company_brief"
  | "generate_questions"
  | "coverage_check"
  | "generate_flashcards"
  | "build_schedule";

export type ProgressStatus = "running" | "done" | "skipped" | "failed";
export type ProgressReporter = (step: ProgressStep, status: ProgressStatus, detail?: string) => void;

function truncate(text: string, max = MAX_TEXT_CHARS): string {
  return text.length > max ? `${text.slice(0, max)}\n...[truncated]` : text;
}

/**
 * The full research-and-generation sequence, Section 3: "The kit must be
 * produced through a sequence of deliberate steps that respond to what
 * has actually been found, not by a single prompt that returns
 * everything at once." Each step below only runs once the step before it
 * has produced something to respond to — the hiring-page findings feed
 * the question-category plan, the category plan feeds question
 * generation, the generated questions feed the coverage check, and the
 * coverage check can trigger a second, narrower generation pass before
 * anything is scheduled.
 */
export async function generateKit(params: {
  jd: string;
  companyUrl: string;
  days: number;
  onProgress?: ProgressReporter;
}): Promise<Kit> {
  const report: ProgressReporter = params.onProgress ?? (() => {});

  // Step 1 — pasted text needs no retrieval at all (Section 3).
  report("extract_requirements", "running");
  const extracted = await extractRequirements(params.jd);
  report("extract_requirements", "done", `${extracted.requirements.length} requirement(s) found`);

  // Step 2 — crawl the company's own site for "what they do" + a hiring page.
  report("crawl_company_site", "running");
  const crawl = await crawlCompanySite(params.companyUrl).catch((err) => {
    report("crawl_company_site", "failed", String(err));
    return {
      pages: [],
      aboutPage: null,
      hiringPage: null,
      skipped: [],
      failed: [{ url: params.companyUrl, code: "CRAWL_FAILED", message: String(err) }],
    };
  });
  if (crawl.pages.length > 0) {
    report(
      "crawl_company_site",
      "done",
      `${crawl.pages.length} page(s) fetched; hiring page ${crawl.hiringPage ? "found" : "not found"}`
    );
  } else {
    report("crawl_company_site", "skipped", "no pages could be retrieved from the company site");
  }

  const companyName = deriveCompanyName(params.companyUrl, crawl.pages);

  // Step 3 — public discussion of the interview process, off the company's own domain.
  report("search_public_discussion", "running");
  const discussion = await searchPublicInterviewDiscussion(companyName);
  report(
    "search_public_discussion",
    discussion.results.length > 0 ? "done" : "skipped",
    discussion.error ? discussion.error.message : `${discussion.results.length} result(s)`
  );

  const hiringContext = truncate(
    [crawl.hiringPage?.text, ...discussion.results.map((r) => `${r.title}: ${r.snippet}`)]
      .filter(Boolean)
      .join("\n\n")
  );
  const signals = detectHiringSignals(hiringContext);

  // Step 4 — company brief, from crawled page text only (never fabricated
  // when nothing was found — Section 10).
  report("company_brief", "running");
  const pagesText = truncate(
    [crawl.aboutPage?.text, crawl.pages[0]?.text].filter(Boolean).join("\n\n")
  );
  let companyBrief: CompanyBrief;
  // Tracked separately from the brief's own text: the honest fallback
  // message below is long enough to pass a naive "is there content"
  // length check, which would wrongly let it trigger company-fit
  // question generation grounded in nothing.
  let hasRealCompanyContent = false;
  if (!pagesText.trim()) {
    companyBrief = {
      summary: `We could not retrieve any usable pages from ${params.companyUrl}, so this brief is based only on the job description.`,
      what_they_do: "",
      sources: [],
    };
    report("company_brief", "skipped", "no page content to summarize");
  } else {
    try {
      const brief = await generateCompanyBrief({ companyName, pagesText });
      companyBrief = {
        ...brief,
        sources: [crawl.aboutPage?.url, crawl.pages[0]?.url].filter((u): u is string => Boolean(u)),
      };
      hasRealCompanyContent = true;
      report("company_brief", "done");
    } catch (err) {
      companyBrief = {
        summary: `We found pages about ${companyName} but could not summarize them (${
          err instanceof LlmError ? err.code : "generation error"
        }).`,
        what_they_do: "",
        sources: [],
      };
      report("company_brief", "failed", String(err));
    }
  }

  // Step 5 — generate questions per (requirement-set, category), one call
  // per category rather than per requirement (Section 9's free-tier
  // rate-limit warning), sequenced so the hiring-page/discussion findings
  // (captured above in `signals` and `hiringContext`) genuinely shape
  // which categories get generated at all.
  report("generate_questions", "running");
  let questions: Question[] = [];
  let nextQuestionN = 1;

  const genCategory = async (category: RequirementCategory, reqs: Requirement[], pass: number) => {
    if (reqs.length === 0) return;
    let drafts: QuestionDraft[];
    try {
      drafts = await generateQuestionsForCategory({ category, requirements: reqs, companyName, hiringContext });
    } catch (err) {
      report("generate_questions", "failed", `${category}: ${String(err)}`);
      return;
    }
    for (const d of drafts) {
      questions.push({
        id: `q${nextQuestionN++}`,
        requirement_ids: d.requirement_ids.filter((id) => reqs.some((r) => r.id === id)),
        category,
        prompt: d.prompt,
        answer_outline: d.answer_outline,
        difficulty: d.difficulty,
        _meta: defaultMeta("generated"),
      });
    }
  };

  const initialPlan = planCategoryAssignments(extracted.requirements, signals, extracted.seniority);
  await genCategory("technical", initialPlan.technical, 0);
  await genCategory("behavioural", initialPlan.behavioural, 0);
  await genCategory("system-design", initialPlan["system-design"], 0);

  if (hasRealCompanyContent && shouldGenerateCompanyFit(`${companyBrief.summary} ${companyBrief.what_they_do}`)) {
    try {
      const fitDrafts = await generateCompanyFitQuestions({
        companyName,
        companyBriefText: `${companyBrief.summary}\n${companyBrief.what_they_do}`,
        hiringContext,
      });
      for (const d of fitDrafts) {
        questions.push({
          id: `q${nextQuestionN++}`,
          requirement_ids: [],
          category: "company-fit",
          prompt: d.prompt,
          answer_outline: d.answer_outline,
          difficulty: d.difficulty,
          _meta: defaultMeta("generated"),
        });
      }
    } catch (err) {
      report("generate_questions", "failed", `company-fit: ${String(err)}`);
    }
  }
  report("generate_questions", "done", `${questions.length} question(s) generated`);

  // Step 6 — the coverage-driven second pass (Section 4): compare
  // generated questions against requirements, and for any must-have gap,
  // run one more narrowly-scoped generation call, then recheck. Bounded
  // so a persistently-uncooperative model can't loop forever — see
  // README for why MAX_COVERAGE_PASSES is 2.
  report("coverage_check", "running");
  let pass = 0;
  let { mustHaveGaps } = findUncoveredRequirementIds(extracted.requirements, questions);
  while (mustHaveGaps.length > 0 && pass < MAX_COVERAGE_PASSES) {
    pass += 1;
    const gapRequirements = extracted.requirements.filter((r) => mustHaveGaps.includes(r.id));
    const gapPlan = planCategoryAssignments(gapRequirements, signals, extracted.seniority);
    await genCategory("technical", gapPlan.technical, pass);
    await genCategory("behavioural", gapPlan.behavioural, pass);
    await genCategory("system-design", gapPlan["system-design"], pass);
    ({ mustHaveGaps } = findUncoveredRequirementIds(extracted.requirements, questions));
  }
  const coverage: Coverage = { uncovered_requirement_ids: mustHaveGaps, passes: pass + 1 };
  report(
    "coverage_check",
    mustHaveGaps.length === 0 ? "done" : "done",
    mustHaveGaps.length === 0
      ? `full coverage after ${pass + 1} pass(es)`
      : `${mustHaveGaps.length} must-have requirement(s) still uncovered after ${pass + 1} pass(es)`
  );

  // Step 7 — flashcards, one batched call across all requirements.
  report("generate_flashcards", "running");
  let flashcards: Flashcard[] = [];
  try {
    const drafts = await generateFlashcards(extracted.requirements);
    flashcards = drafts.map((d, i) => ({
      id: `f${i + 1}`,
      front: d.front,
      back: d.back,
      requirement_ids: d.requirement_ids.filter((id) => extracted.requirements.some((r) => r.id === id)),
      _meta: defaultMeta("generated"),
    }));
    report("generate_flashcards", "done", `${flashcards.length} flashcard(s)`);
  } catch (err) {
    report("generate_flashcards", "failed", String(err));
  }

  // Step 8 — schedule allocation: pure code, no model call (Section 8).
  report("build_schedule", "running");
  const schedule: Schedule = allocateSchedule(extracted.requirements, questions, params.days);
  report("build_schedule", "done");

  const source: Source = {
    company: companyName,
    company_url: params.companyUrl,
    role: extracted.title,
    location: extracted.location,
    jd_chars: params.jd.length,
    researched_at: new Date().toISOString(),
    pages_used: [
      ...crawl.pages.map((p) => p.url),
      ...discussion.results.map((r) => r.url),
    ],
  };

  return {
    source,
    company_brief: companyBrief,
    role: {
      title: extracted.title,
      seniority: extracted.seniority,
      responsibilities: extracted.responsibilities,
      requirements: extracted.requirements,
    },
    questions,
    flashcards,
    schedule,
    coverage,
  };
}
