import { z } from "zod";
import { generateStructured, wrapUntrusted } from "../llm";
import { QuestionDraft } from "./generate-questions";

const QuestionDraftSchema = z.object({
  prompt: z.string().min(1),
  answer_outline: z.string().min(1),
  difficulty: z.number().int().min(1).max(3),
});

const ResponseSchema = z.object({ questions: z.array(QuestionDraftSchema) });

/**
 * "company-fit" questions aren't tied to a specific requirement (Appendix
 * A's requirement_ids is an array, so an empty one is valid) — they come
 * from the company brief and hiring-process research as a whole. Only
 * called when plan-categories.shouldGenerateCompanyFit() says there's
 * real content to draw from; an empty/thin brief should not produce
 * generic "why do you want to work here" filler with nothing behind it.
 */
export async function generateCompanyFitQuestions(params: {
  companyName: string;
  companyBriefText: string;
  hiringContext: string;
}): Promise<QuestionDraft[]> {
  const prompt = `Generate 2-3 "company-fit" interview questions for a candidate interviewing at ${params.companyName}, grounded specifically in what's actually known about this company below — not generic "why do you want to work here" questions that could apply to any company.\n\n${wrapUntrusted(
    "company_brief",
    params.companyBriefText
  )}\n\n${params.hiringContext.trim() ? wrapUntrusted("hiring_context", params.hiringContext) : ""}`;

  const systemInstruction = `You write company-fit interview questions that reference specific, real details about the company (its actual product, stated mission, engineering culture, or hiring process) rather than generic questions. If the provided material is too thin to ground a specific question, generate fewer questions rather than falling back to generic ones.

Respond with ONLY JSON: { "questions": [{ "prompt": string, "answer_outline": string, "difficulty": 1|2|3 }] }`;

  const result = await generateStructured({
    schema: ResponseSchema,
    systemInstruction,
    prompt,
    temperature: 0.6,
  });

  return result.questions.map((q) => ({ ...q, requirement_ids: [] as string[] }));
}
