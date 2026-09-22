import { z } from "zod";
import { Requirement } from "@trao/shared";
import { generateStructured, wrapUntrusted } from "../llm";

const FlashcardDraftSchema = z.object({
  front: z.string().min(1),
  back: z.string().min(1),
  requirement_ids: z.array(z.string()),
});
export type FlashcardDraft = z.infer<typeof FlashcardDraftSchema>;

const ResponseSchema = z.object({ flashcards: z.array(FlashcardDraftSchema) });

/**
 * One batched call across every requirement (rather than one call per
 * requirement) — same rate-limit reasoning as generate-questions.ts.
 * Every must-have requirement gets at least one flashcard; nice-to-haves
 * are included when there's room, so the deck stays focused rather than
 * huge.
 */
export async function generateFlashcards(requirements: Requirement[]): Promise<FlashcardDraft[]> {
  if (requirements.length === 0) return [];

  const requirementList = requirements
    .map((r) => `- [${r.id}] (${r.priority}, ${r.kind}) ${r.text}`)
    .join("\n");

  const prompt = `Generate flashcards to help someone prepare for these job requirements:\n${wrapUntrusted(
    "requirements",
    requirementList
  )}\n\nEvery "must" requirement needs at least one flashcard. "nice" requirements can get one if it's genuinely useful, but don't pad the deck.`;

  const systemInstruction = `You write flashcards for interview preparation. Each flashcard:
- front: a short prompt, term, or question (a few words to one sentence)
- back: a concise, concrete answer or explanation (1-3 sentences) — not vague ("know your stuff"), an actual usable fact or talking point
- requirement_ids: which requirement id(s) (from the list given) this flashcard prepares the candidate for. Never invent an id that wasn't given.

Respond with ONLY JSON: { "flashcards": [{ "front": string, "back": string, "requirement_ids": string[] }] }`;

  const result = await generateStructured({
    schema: ResponseSchema,
    systemInstruction,
    prompt,
    temperature: 0.4,
  });

  return result.flashcards;
}
