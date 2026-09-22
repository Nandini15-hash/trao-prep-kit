import { z } from "zod";

/**
 * Kit structure — Appendix A of the Trao assessment brief.
 *
 * The brief is explicit: "Field names must match exactly." Every field
 * below that appears in Appendix A keeps its exact name and shape. The
 * only additions are optional `_meta` blocks on the items a user can hand-
 * edit (questions, flashcards, the company brief) — these exist purely to
 * solve the "regenerate a section without clobbering edits" requirement in
 * Section 6, and are additive: stripping them still leaves a kit that
 * matches Appendix A.
 */

// ---- Edit-state tracking (extension, not part of Appendix A) ----------

/**
 * origin: was this item produced by the model ("generated"), hand-edited
 * by the user after being generated ("edited"), or created by the user
 * from scratch ("user_added")?
 *
 * pinned: true once an item has ever been touched by a user. A regenerate
 * pass only replaces items where pinned === false. This is the mechanism
 * behind "a question the user wrote or edited by hand must survive a
 * regeneration of its category" (Section 6).
 */
export const EditMetaSchema = z.object({
  origin: z.enum(["generated", "edited", "user_added"]),
  pinned: z.boolean(),
  generation_pass: z.number().int().min(0).optional(),
  updated_at: z.string().optional(),
});
export type EditMeta = z.infer<typeof EditMetaSchema>;

function defaultMeta(origin: EditMeta["origin"] = "generated"): EditMeta {
  return { origin, pinned: origin !== "generated", generation_pass: 0 };
}
export { defaultMeta };

// ---- source -------------------------------------------------------------

export const SourceSchema = z.object({
  company: z.string(),
  company_url: z.string(),
  role: z.string(),
  location: z.string(),
  jd_chars: z.number().int().min(0),
  researched_at: z.string(),
  pages_used: z.array(z.string()),
});
export type Source = z.infer<typeof SourceSchema>;

// ---- company_brief --------------------------------------------------------

export const CompanyBriefSchema = z.object({
  summary: z.string(),
  what_they_do: z.string(),
  sources: z.array(z.string()),
  _meta: EditMetaSchema.optional(),
});
export type CompanyBrief = z.infer<typeof CompanyBriefSchema>;

// ---- role.requirements ---------------------------------------------------

export const RequirementKind = z.enum(["technical", "behavioural", "domain"]);
export const RequirementPriority = z.enum(["must", "nice"]);

export const RequirementSchema = z.object({
  id: z.string(),
  text: z.string(),
  kind: RequirementKind,
  priority: RequirementPriority,
});
export type Requirement = z.infer<typeof RequirementSchema>;

export const RoleSchema = z.object({
  title: z.string(),
  seniority: z.string(),
  responsibilities: z.array(z.string()),
  requirements: z.array(RequirementSchema),
});
export type Role = z.infer<typeof RoleSchema>;

// ---- questions -------------------------------------------------------------

export const QuestionCategory = z.enum([
  "technical",
  "behavioural",
  "system-design",
  "company-fit",
]);
export type QuestionCategory = z.infer<typeof QuestionCategory>;

export const QuestionSchema = z.object({
  id: z.string(),
  requirement_ids: z.array(z.string()),
  category: QuestionCategory,
  prompt: z.string(),
  answer_outline: z.string(),
  difficulty: z.number().int().min(1).max(3),
  _meta: EditMetaSchema.optional(),
});
export type Question = z.infer<typeof QuestionSchema>;

// ---- flashcards -------------------------------------------------------------

export const FlashcardSchema = z.object({
  id: z.string(),
  front: z.string(),
  back: z.string(),
  requirement_ids: z.array(z.string()),
  _meta: EditMetaSchema.optional(),
});
export type Flashcard = z.infer<typeof FlashcardSchema>;

// ---- schedule -------------------------------------------------------------

export const ScheduleDaySchema = z.object({
  day: z.number().int().min(1),
  focus: z.string(),
  question_ids: z.array(z.string()),
  minutes: z.number().int().min(0),
});
export type ScheduleDay = z.infer<typeof ScheduleDaySchema>;

export const ScheduleSchema = z.object({
  days_available: z.number().int().min(1),
  days: z.array(ScheduleDaySchema),
});
export type Schedule = z.infer<typeof ScheduleSchema>;

// ---- coverage -------------------------------------------------------------

export const CoverageSchema = z.object({
  uncovered_requirement_ids: z.array(z.string()),
  passes: z.number().int().min(0),
});
export type Coverage = z.infer<typeof CoverageSchema>;

// ---- practice (extension — supports Section 7, not in Appendix A) --------

export const FlashcardProgressSchema = z.object({
  flashcard_id: z.string(),
  confidence: z.number().int().min(1).max(5).nullable(),
  last_reviewed_at: z.string().nullable(),
  times_reviewed: z.number().int().min(0),
});
export type FlashcardProgress = z.infer<typeof FlashcardProgressSchema>;

export const PracticeStateSchema = z.object({
  progress: z.array(FlashcardProgressSchema),
});
export type PracticeState = z.infer<typeof PracticeStateSchema>;

// ---- full kit -------------------------------------------------------------

export const KitSchema = z.object({
  source: SourceSchema,
  company_brief: CompanyBriefSchema,
  role: RoleSchema,
  questions: z.array(QuestionSchema),
  flashcards: z.array(FlashcardSchema),
  schedule: ScheduleSchema,
  coverage: CoverageSchema,
  practice: PracticeStateSchema.optional(),
});
export type Kit = z.infer<typeof KitSchema>;

// ---- structural (cross-field) validation ----------------------------------

export interface StructuralIssue {
  path: string;
  message: string;
}

/**
 * Checks the relational invariants Appendix A implies but a plain Zod
 * shape can't express: ids are unique and stable, every requirement_ids
 * reference resolves to a real requirement, every schedule question_ids
 * entry resolves to a real question, schedule.days.length matches
 * days_available, and difficulty/minutes really are integers in range.
 * Zod already enforces the integer/range parts; this layer enforces the
 * cross-references.
 */
export function validateKitStructure(kit: Kit): StructuralIssue[] {
  const issues: StructuralIssue[] = [];

  const requirementIds = new Set(kit.role.requirements.map((r) => r.id));
  if (requirementIds.size !== kit.role.requirements.length) {
    issues.push({ path: "role.requirements", message: "duplicate requirement ids" });
  }

  const questionIds = new Set(kit.questions.map((q) => q.id));
  if (questionIds.size !== kit.questions.length) {
    issues.push({ path: "questions", message: "duplicate question ids" });
  }

  const flashcardIds = new Set(kit.flashcards.map((f) => f.id));
  if (flashcardIds.size !== kit.flashcards.length) {
    issues.push({ path: "flashcards", message: "duplicate flashcard ids" });
  }

  kit.questions.forEach((q, i) => {
    q.requirement_ids.forEach((rid) => {
      if (!requirementIds.has(rid)) {
        issues.push({
          path: `questions[${i}].requirement_ids`,
          message: `references unknown requirement id "${rid}"`,
        });
      }
    });
  });

  kit.flashcards.forEach((f, i) => {
    f.requirement_ids.forEach((rid) => {
      if (!requirementIds.has(rid)) {
        issues.push({
          path: `flashcards[${i}].requirement_ids`,
          message: `references unknown requirement id "${rid}"`,
        });
      }
    });
  });

  if (kit.schedule.days.length !== kit.schedule.days_available) {
    issues.push({
      path: "schedule.days",
      message: `schedule has ${kit.schedule.days.length} day(s) but days_available is ${kit.schedule.days_available}`,
    });
  }

  kit.schedule.days.forEach((day, i) => {
    day.question_ids.forEach((qid) => {
      if (!questionIds.has(qid)) {
        issues.push({
          path: `schedule.days[${i}].question_ids`,
          message: `references unknown question id "${qid}"`,
        });
      }
    });
  });

  const mustIds = kit.role.requirements
    .filter((r) => r.priority === "must")
    .map((r) => r.id);
  const scheduledIds = new Set(kit.schedule.days.flatMap((d) => d.question_ids));
  const coveredByScheduledQuestions = new Set(
    kit.questions
      .filter((q) => scheduledIds.has(q.id))
      .flatMap((q) => q.requirement_ids)
  );
  mustIds.forEach((rid) => {
    if (!coveredByScheduledQuestions.has(rid)) {
      issues.push({
        path: "schedule",
        message: `must-have requirement "${rid}" is not represented by any scheduled question`,
      });
    }
  });

  return issues;
}

/** Parses + structurally validates in one call. Throws on schema failure. */
export function parseKit(data: unknown): { kit: Kit; issues: StructuralIssue[] } {
  const kit = KitSchema.parse(data);
  return { kit, issues: validateKitStructure(kit) };
}
