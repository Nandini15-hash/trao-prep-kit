import { Router } from "express";
import { z } from "zod";
import { QuestionCategory } from "@trao/shared";
import { requireAuth } from "../middleware/auth.middleware";
import { HttpError, asyncHandler } from "../lib/http-error";
import * as kitService from "../services/kit.service";
import { KitDoc } from "../models/Kit";

export const kitRouter = Router();
kitRouter.use(requireAuth);

/**
 * All routes here assume `requireAuth` already ran (mounted above) and
 * scope every read/write to `req.userId` — kit.service.ts's ownership
 * check (owner match + valid id) is what actually prevents one user from
 * reading or editing another's kit; a bad/foreign id gets the same 404 a
 * missing one would, so existence isn't leaked either.
 */

function serialize(doc: KitDoc) {
  const d = doc as any;
  return {
    id: String(d._id),
    status: d.status,
    input: d.input,
    data: d.data,
    error: d.error ?? null,
    progress: d.progress ?? [],
    createdAt: d.createdAt,
    updatedAt: d.updatedAt,
  };
}

// ---- creation / lifecycle --------------------------------------------------

const CreateKitSchema = z.object({
  jd: z.string().trim().min(1, "Paste a job description first"),
  companyUrl: z.string().trim().min(1, "A company website URL is required"),
  // Bounded above 365 so a typo (e.g. "3650") can't allocate a schedule
  // no one will ever use; the brief's own examples top out around a month.
  days: z.number().int().min(1).max(365),
});

kitRouter.post(
  "/kits",
  asyncHandler(async (req, res) => {
    const parsed = CreateKitSchema.safeParse(req.body);
    if (!parsed.success) {
      throw HttpError.badRequest(parsed.error.issues[0]?.message ?? "Invalid input", "VALIDATION_ERROR");
    }
    const doc = await kitService.createKit(req.userId!, parsed.data);
    // 202: generation runs in the background (see kit.service.ts) — the
    // client polls GET /kits/:id and watches `status`/`progress`.
    res.status(202).json(serialize(doc));
  })
);

kitRouter.get(
  "/kits",
  asyncHandler(async (req, res) => {
    const docs = await kitService.listKits(req.userId!);
    res.json({ kits: docs.map(serialize) });
  })
);

kitRouter.get(
  "/kits/:id",
  asyncHandler(async (req, res) => {
    const doc = await kitService.getKit(req.userId!, req.params.id);
    res.json(serialize(doc));
  })
);

kitRouter.delete(
  "/kits/:id",
  asyncHandler(async (req, res) => {
    await kitService.deleteKit(req.userId!, req.params.id);
    res.status(204).end();
  })
);

// ---- company brief --------------------------------------------------------

const CompanyBriefPatchSchema = z
  .object({ summary: z.string().min(1).optional(), what_they_do: z.string().min(1).optional() })
  .refine((v) => v.summary !== undefined || v.what_they_do !== undefined, {
    message: "Provide at least one field to update",
  });

kitRouter.patch(
  "/kits/:id/company-brief",
  asyncHandler(async (req, res) => {
    const parsed = CompanyBriefPatchSchema.safeParse(req.body);
    if (!parsed.success) {
      throw HttpError.badRequest(parsed.error.issues[0]?.message ?? "Invalid input", "VALIDATION_ERROR");
    }
    const doc = await kitService.updateCompanyBrief(req.userId!, req.params.id, parsed.data);
    res.json(serialize(doc));
  })
);

kitRouter.post(
  "/kits/:id/company-brief/regenerate",
  asyncHandler(async (req, res) => {
    // Synchronous: this re-crawls the company site and calls the model,
    // so it can take a while. Documented as a known limitation in the
    // README rather than made async — an edit/regenerate action is a
    // much smaller unit of work than the initial pipeline, and giving it
    // its own job/polling machinery wasn't worth the complexity here.
    const doc = await kitService.regenerateCompanyBrief(req.userId!, req.params.id);
    res.json(serialize(doc));
  })
);

// ---- questions --------------------------------------------------------

const QuestionPatchSchema = z.object({
  prompt: z.string().min(1).optional(),
  answer_outline: z.string().min(1).optional(),
  difficulty: z.number().int().min(1).max(3).optional(),
  category: QuestionCategory.optional(),
  requirement_ids: z.array(z.string()).optional(),
});

kitRouter.patch(
  "/kits/:id/questions/:questionId",
  asyncHandler(async (req, res) => {
    const parsed = QuestionPatchSchema.safeParse(req.body);
    if (!parsed.success) {
      throw HttpError.badRequest(parsed.error.issues[0]?.message ?? "Invalid input", "VALIDATION_ERROR");
    }
    const doc = await kitService.updateQuestion(req.userId!, req.params.id, req.params.questionId, parsed.data);
    res.json(serialize(doc));
  })
);

const AddQuestionSchema = z.object({
  category: QuestionCategory,
  prompt: z.string().min(1),
  answer_outline: z.string().min(1),
  difficulty: z.number().int().min(1).max(3),
  requirement_ids: z.array(z.string()).default([]),
});

kitRouter.post(
  "/kits/:id/questions",
  asyncHandler(async (req, res) => {
    const parsed = AddQuestionSchema.safeParse(req.body);
    if (!parsed.success) {
      throw HttpError.badRequest(parsed.error.issues[0]?.message ?? "Invalid input", "VALIDATION_ERROR");
    }
    const doc = await kitService.addQuestion(req.userId!, req.params.id, parsed.data);
    res.status(201).json(serialize(doc));
  })
);

kitRouter.delete(
  "/kits/:id/questions/:questionId",
  asyncHandler(async (req, res) => {
    const doc = await kitService.deleteQuestion(req.userId!, req.params.id, req.params.questionId);
    res.json(serialize(doc));
  })
);

const MoveQuestionSchema = z.object({ category: QuestionCategory });

kitRouter.post(
  "/kits/:id/questions/:questionId/move",
  asyncHandler(async (req, res) => {
    const parsed = MoveQuestionSchema.safeParse(req.body);
    if (!parsed.success) {
      throw HttpError.badRequest(parsed.error.issues[0]?.message ?? "Invalid input", "VALIDATION_ERROR");
    }
    const doc = await kitService.moveQuestion(req.userId!, req.params.id, req.params.questionId, parsed.data.category);
    res.json(serialize(doc));
  })
);

const ReorderQuestionsSchema = z.object({
  category: QuestionCategory,
  orderedIds: z.array(z.string()),
});

kitRouter.post(
  "/kits/:id/questions/reorder",
  asyncHandler(async (req, res) => {
    const parsed = ReorderQuestionsSchema.safeParse(req.body);
    if (!parsed.success) {
      throw HttpError.badRequest(parsed.error.issues[0]?.message ?? "Invalid input", "VALIDATION_ERROR");
    }
    const doc = await kitService.reorderQuestions(req.userId!, req.params.id, parsed.data.category, parsed.data.orderedIds);
    res.json(serialize(doc));
  })
);

const RegenerateQuestionsSchema = z.object({ category: QuestionCategory });

kitRouter.post(
  "/kits/:id/questions/regenerate",
  asyncHandler(async (req, res) => {
    const parsed = RegenerateQuestionsSchema.safeParse(req.body);
    if (!parsed.success) {
      throw HttpError.badRequest(parsed.error.issues[0]?.message ?? "Invalid input", "VALIDATION_ERROR");
    }
    // Synchronous — see the note on the company-brief regenerate route.
    const doc = await kitService.regenerateQuestions(req.userId!, req.params.id, parsed.data.category);
    res.json(serialize(doc));
  })
);

// ---- flashcards --------------------------------------------------------

const FlashcardPatchSchema = z
  .object({ front: z.string().min(1).optional(), back: z.string().min(1).optional(), requirement_ids: z.array(z.string()).optional() })
  .refine((v) => v.front !== undefined || v.back !== undefined || v.requirement_ids !== undefined, {
    message: "Provide at least one field to update",
  });

kitRouter.patch(
  "/kits/:id/flashcards/:flashcardId",
  asyncHandler(async (req, res) => {
    const parsed = FlashcardPatchSchema.safeParse(req.body);
    if (!parsed.success) {
      throw HttpError.badRequest(parsed.error.issues[0]?.message ?? "Invalid input", "VALIDATION_ERROR");
    }
    const doc = await kitService.updateFlashcard(req.userId!, req.params.id, req.params.flashcardId, parsed.data);
    res.json(serialize(doc));
  })
);

const AddFlashcardSchema = z.object({
  front: z.string().min(1),
  back: z.string().min(1),
  requirement_ids: z.array(z.string()).default([]),
});

kitRouter.post(
  "/kits/:id/flashcards",
  asyncHandler(async (req, res) => {
    const parsed = AddFlashcardSchema.safeParse(req.body);
    if (!parsed.success) {
      throw HttpError.badRequest(parsed.error.issues[0]?.message ?? "Invalid input", "VALIDATION_ERROR");
    }
    const doc = await kitService.addFlashcard(req.userId!, req.params.id, parsed.data);
    res.status(201).json(serialize(doc));
  })
);

kitRouter.delete(
  "/kits/:id/flashcards/:flashcardId",
  asyncHandler(async (req, res) => {
    const doc = await kitService.deleteFlashcard(req.userId!, req.params.id, req.params.flashcardId);
    res.json(serialize(doc));
  })
);

// ---- schedule --------------------------------------------------------

const RegenerateScheduleSchema = z.object({ daysAvailable: z.number().int().min(1).max(365).optional() });

kitRouter.post(
  "/kits/:id/schedule/regenerate",
  asyncHandler(async (req, res) => {
    const parsed = RegenerateScheduleSchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      throw HttpError.badRequest(parsed.error.issues[0]?.message ?? "Invalid input", "VALIDATION_ERROR");
    }
    // Pure recompute, no model call — safe to run synchronously and fast.
    const doc = await kitService.regenerateSchedule(req.userId!, req.params.id, parsed.data.daysAvailable);
    res.json(serialize(doc));
  })
);

// ---- practice (Section 7) --------------------------------------------------

kitRouter.get(
  "/kits/:id/practice",
  asyncHandler(async (req, res) => {
    const session = await kitService.getPracticeSession(req.userId!, req.params.id);
    res.json(session);
  })
);

const ReviewSchema = z.object({
  flashcardId: z.string().min(1),
  confidence: z.number().int().min(1).max(5),
});

kitRouter.post(
  "/kits/:id/practice/review",
  asyncHandler(async (req, res) => {
    const parsed = ReviewSchema.safeParse(req.body);
    if (!parsed.success) {
      throw HttpError.badRequest(parsed.error.issues[0]?.message ?? "Invalid input", "VALIDATION_ERROR");
    }
    const doc = await kitService.recordFlashcardReview(
      req.userId!,
      req.params.id,
      parsed.data.flashcardId,
      parsed.data.confidence
    );
    res.json(serialize(doc));
  })
);
