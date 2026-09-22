import { z } from "zod";
import { callGemini } from "./gemini-client";
import { LlmError } from "./errors";

const MAX_REPAIR_ATTEMPTS = 2;

function extractJson(text: string): unknown {
  // responseMimeType: "application/json" should already give us clean
  // JSON, but models occasionally wrap it in a ```json fence anyway —
  // strip that defensively before parsing.
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fenced ? fenced[1] : text;
  return JSON.parse(candidate);
}

/**
 * Calls Gemini, parses the response as JSON, and validates it against a
 * Zod schema — Section 10: "The model returns invalid JSON or an
 * incomplete kit" must be handled, not crash the run. If parsing or
 * validation fails, one more request is made asking the model to correct
 * its own output against the specific Zod error, up to
 * MAX_REPAIR_ATTEMPTS times, before giving up with a clear LlmError.
 *
 * This is intentionally generic (schema in, typed data out) so every
 * generation step — requirement extraction, questions, flashcards, the
 * company brief — shares one place where "is this actually usable" is
 * decided, rather than each step re-implementing its own JSON coaxing.
 */
export async function generateStructured<T>(params: {
  schema: z.ZodType<T>;
  systemInstruction: string;
  prompt: string;
  temperature?: number;
}): Promise<T> {
  let lastRawText = "";
  let lastErrorSummary = "";

  for (let attempt = 0; attempt <= MAX_REPAIR_ATTEMPTS; attempt++) {
    const prompt =
      attempt === 0
        ? params.prompt
        : `${params.prompt}\n\n---\nYour previous response could not be used:\n${lastErrorSummary}\n\nYour previous response was:\n${lastRawText.slice(0, 2000)}\n\nReturn ONLY corrected JSON matching the required shape. No prose, no markdown fences.`;

    const text = await callGemini(prompt, {
      systemInstruction: params.systemInstruction,
      temperature: params.temperature,
      jsonMode: true,
    });
    lastRawText = text;

    let parsed: unknown;
    try {
      parsed = extractJson(text);
    } catch (err) {
      lastErrorSummary = `Response was not valid JSON: ${(err as Error).message}`;
      continue;
    }

    const result = params.schema.safeParse(parsed);
    if (result.success) {
      return result.data;
    }
    lastErrorSummary = result.error.issues
      .slice(0, 10)
      .map((i) => `- ${i.path.join(".")}: ${i.message}`)
      .join("\n");
  }

  throw new LlmError(
    `Model output did not match the expected schema after ${MAX_REPAIR_ATTEMPTS + 1} attempts: ${lastErrorSummary}`,
    "SCHEMA_INVALID"
  );
}
