import { Types } from "mongoose";
import { Flashcard, Kit, KitSchema, QuestionCategory, validateKitStructure } from "@trao/shared";
import { KitDocument, KitDoc } from "../models/Kit";
import { HttpError } from "../lib/http-error";
import { generateKit, ProgressStatus, ProgressStep } from "./generation/pipeline";
import * as builder from "./kit-builder";
import { RequirementCategory } from "./generation/plan-categories";
import { coverageSummary, orderForPractice, recordReview } from "./practice";

/**
 * Persistence + orchestration around the pure pieces built in
 * generation/pipeline.ts (kit creation) and kit-builder.ts (edits and
 * per-section regeneration). Every write to `data` is re-validated
 * against the Appendix A Zod schema before it's saved — kit-builder.ts's
 * functions are trusted to produce well-typed Kit objects, but the save
 * path re-checks anyway so a bug there fails loudly (500) instead of
 * quietly writing a malformed kit a client would later choke on.
 */

const QUESTION_CATEGORIES: readonly RequirementCategory[] = ["technical", "behavioural", "system-design"];

function assertValidId(id: string): void {
  if (!Types.ObjectId.isValid(id)) {
    throw HttpError.notFound("No such kit", "KIT_NOT_FOUND");
  }
}

async function loadOwned(ownerId: string, kitId: string): Promise<KitDoc> {
  assertValidId(kitId);
  const doc = await KitDocument.findOne({ _id: kitId, owner: ownerId });
  if (!doc) {
    throw HttpError.notFound("No such kit", "KIT_NOT_FOUND");
  }
  return doc as unknown as KitDoc;
}

/** Same as loadOwned, but requires the kit to have finished generating
 *  successfully — every edit/regenerate action operates on `data`, which
 *  is null until status reaches "ready". */
async function loadReady(ownerId: string, kitId: string): Promise<{ doc: any; kit: Kit }> {
  const doc = await loadOwned(ownerId, kitId);
  if (doc.status === "pending" || doc.status === "generating") {
    throw new HttpError(409, "KIT_NOT_READY", "This kit is still being generated");
  }
  if (doc.status === "failed" || !doc.data) {
    throw new HttpError(409, "KIT_GENERATION_FAILED", doc.error?.message ?? "Generation failed for this kit");
  }
  return { doc, kit: doc.data as Kit };
}

/** Validates a Kit produced by a mutation before it's persisted. Throws a
 *  500 (via a plain Error, not HttpError) if the mutation produced
 *  something invalid — that's a bug in kit-builder.ts, not a bad request. */
function assertSavable(kit: Kit): Kit {
  const parsed = KitSchema.parse(kit);
  const issues = validateKitStructure(parsed);
  if (issues.length > 0) {
    throw new Error(`Mutation produced a structurally invalid kit: ${JSON.stringify(issues)}`);
  }
  return parsed;
}

async function save(doc: any, kit: Kit): Promise<KitDoc> {
  doc.data = assertSavable(kit);
  doc.markModified("data");
  await doc.save();
  return doc as KitDoc;
}

/** Applies a (possibly async) kit-builder mutation and persists the result. */
async function mutate(
  ownerId: string,
  kitId: string,
  fn: (kit: Kit) => Kit | Promise<Kit>
): Promise<KitDoc> {
  const { doc, kit } = await loadReady(ownerId, kitId);
  const next = await fn(kit);
  return save(doc, next);
}

// ---- creation ---------------------------------------------------------

export interface CreateKitInput {
  jd: string;
  companyUrl: string;
  days: number;
}

/**
 * Section 10 edge case: the same user resubmitting the same JD/company/
 * timeline before the first run finishes should not spin up a second,
 * redundant generation job. Rather than rejecting the resubmission
 * outright (which would force the client to go look up the earlier
 * job), this returns the already-in-flight document.
 */
export async function createKit(ownerId: string, input: CreateKitInput): Promise<KitDoc> {
  const existing = await KitDocument.findOne({
    owner: ownerId,
    status: { $in: ["pending", "generating"] },
    "input.jd": input.jd,
    "input.companyUrl": input.companyUrl,
    "input.days": input.days,
  });
  if (existing) {
    return existing as unknown as KitDoc;
  }

  const doc = await KitDocument.create({
    owner: ownerId,
    status: "pending",
    input,
    data: null,
    progress: [],
  });

  // Fire-and-forget: generation runs in the background so the route can
  // return immediately (Section 12 — "show clear loading states while a
  // kit is being generated" implies polling a status, not a single
  // request blocking for the full pipeline). Errors are handled inside
  // runGeneration itself; this catch only guards against a truly
  // unexpected rejection (e.g. a DB write failing) so it can't become an
  // unhandled promise rejection that crashes the process.
  runGeneration(String(doc._id)).catch((err) => {
    // eslint-disable-next-line no-console
    console.error(`Kit ${doc._id} generation crashed outside its own error handling:`, err);
  });

  return doc as unknown as KitDoc;
}

async function runGeneration(kitId: string): Promise<void> {
  const doc = await KitDocument.findById(kitId);
  if (!doc) return;

  doc.status = "generating";
  await doc.save();

  const onProgress = (step: ProgressStep, status: ProgressStatus, detail?: string) => {
    doc.progress.push({ step, status, detail, at: new Date() });
  };

  // `input` is always set at creation time (see createKit) — Mongoose's
  // InferSchemaType only marks the nested object itself as optional
  // because the subdocument path has no top-level `required`, even
  // though every field inside it does.
  const input = doc.input!;

  try {
    const kit = await generateKit({
      jd: input.jd,
      companyUrl: input.companyUrl,
      days: input.days,
      onProgress,
    });
    doc.data = assertSavable(kit);
    doc.status = "ready";
    doc.markModified("data");
    await doc.save();
  } catch (err) {
    doc.status = "failed";
    doc.error = {
      code: "GENERATION_FAILED",
      message: err instanceof Error ? err.message : String(err),
    };
    await doc.save();
  }
}

// ---- reads / lifecycle --------------------------------------------------

export async function listKits(ownerId: string): Promise<KitDoc[]> {
  const docs = await KitDocument.find({ owner: ownerId }).sort({ createdAt: -1 });
  return docs as unknown as KitDoc[];
}

export async function getKit(ownerId: string, kitId: string): Promise<KitDoc> {
  return loadOwned(ownerId, kitId);
}

export async function deleteKit(ownerId: string, kitId: string): Promise<void> {
  const doc = await loadOwned(ownerId, kitId);
  await KitDocument.deleteOne({ _id: (doc as any)._id });
}

// ---- company brief --------------------------------------------------------

export function updateCompanyBrief(
  ownerId: string,
  kitId: string,
  patch: Parameters<typeof builder.editCompanyBrief>[1]
): Promise<KitDoc> {
  return mutate(ownerId, kitId, (kit) => builder.editCompanyBrief(kit, patch));
}

export function regenerateCompanyBrief(ownerId: string, kitId: string): Promise<KitDoc> {
  return mutate(ownerId, kitId, (kit) => builder.regenerateCompanyBrief(kit));
}

// ---- questions --------------------------------------------------------

export function updateQuestion(
  ownerId: string,
  kitId: string,
  questionId: string,
  patch: Parameters<typeof builder.editQuestion>[2]
): Promise<KitDoc> {
  return mutate(ownerId, kitId, (kit) => builder.editQuestion(kit, questionId, patch));
}

export function addQuestion(
  ownerId: string,
  kitId: string,
  draft: Parameters<typeof builder.addQuestion>[1]
): Promise<KitDoc> {
  return mutate(ownerId, kitId, (kit) => builder.addQuestion(kit, draft));
}

export function deleteQuestion(ownerId: string, kitId: string, questionId: string): Promise<KitDoc> {
  return mutate(ownerId, kitId, (kit) => builder.deleteQuestion(kit, questionId));
}

export function moveQuestion(
  ownerId: string,
  kitId: string,
  questionId: string,
  category: QuestionCategory
): Promise<KitDoc> {
  return mutate(ownerId, kitId, (kit) => builder.moveQuestionToCategory(kit, questionId, category));
}

export function reorderQuestions(
  ownerId: string,
  kitId: string,
  category: QuestionCategory,
  orderedIds: string[]
): Promise<KitDoc> {
  return mutate(ownerId, kitId, (kit) => builder.reorderQuestionsInCategory(kit, category, orderedIds));
}

/** Dispatches to the requirement-driven regenerator for technical/
 *  behavioural/system-design, or the company-fit regenerator — the two
 *  are different functions in kit-builder.ts because company-fit
 *  questions are sourced from the brief, not from `role.requirements`. */
export function regenerateQuestions(ownerId: string, kitId: string, category: QuestionCategory): Promise<KitDoc> {
  if (category === "company-fit") {
    return mutate(ownerId, kitId, (kit) => builder.regenerateCompanyFitQuestions(kit));
  }
  if (!QUESTION_CATEGORIES.includes(category as RequirementCategory)) {
    throw HttpError.badRequest(`Unknown question category "${category}"`, "VALIDATION_ERROR");
  }
  return mutate(ownerId, kitId, (kit) => builder.regenerateQuestionCategory(kit, category as RequirementCategory));
}

// ---- flashcards --------------------------------------------------------

export function updateFlashcard(
  ownerId: string,
  kitId: string,
  flashcardId: string,
  patch: Parameters<typeof builder.editFlashcard>[2]
): Promise<KitDoc> {
  return mutate(ownerId, kitId, (kit) => builder.editFlashcard(kit, flashcardId, patch));
}

export function addFlashcard(
  ownerId: string,
  kitId: string,
  draft: Parameters<typeof builder.addFlashcard>[1]
): Promise<KitDoc> {
  return mutate(ownerId, kitId, (kit) => builder.addFlashcard(kit, draft));
}

export function deleteFlashcard(ownerId: string, kitId: string, flashcardId: string): Promise<KitDoc> {
  return mutate(ownerId, kitId, (kit) => builder.deleteFlashcard(kit, flashcardId));
}

// ---- schedule --------------------------------------------------------

export function regenerateSchedule(ownerId: string, kitId: string, daysAvailable?: number): Promise<KitDoc> {
  return mutate(ownerId, kitId, (kit) => builder.regenerateSchedule(kit, daysAvailable));
}

// ---- practice (Section 7) --------------------------------------------------

export async function getPracticeSession(
  ownerId: string,
  kitId: string
): Promise<{ flashcards: Flashcard[]; coverage: { total: number; reviewed: number } }> {
  const { kit } = await loadReady(ownerId, kitId);
  return {
    flashcards: orderForPractice(kit.flashcards, kit.practice),
    coverage: coverageSummary(kit.flashcards, kit.practice),
  };
}

export function recordFlashcardReview(
  ownerId: string,
  kitId: string,
  flashcardId: string,
  confidence: number
): Promise<KitDoc> {
  return mutate(ownerId, kitId, (kit) => {
    if (!kit.flashcards.some((f) => f.id === flashcardId)) {
      throw HttpError.notFound("No such flashcard in this kit", "FLASHCARD_NOT_FOUND");
    }
    return recordReview(kit, flashcardId, confidence);
  });
}
