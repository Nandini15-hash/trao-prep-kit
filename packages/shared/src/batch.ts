import { z } from "zod";
import { Kit, KitSchema } from "./schema";

/**
 * Appendix B — batch input/output shapes for the mandatory
 * `npm run evaluate -- --input cases.json --output kits.json` command
 * (Section 9). Field names match the brief exactly.
 */

export const BatchCaseSchema = z.object({
  id: z.string(),
  jd: z.string(),
  company_url: z.string(),
  days: z.number().int().min(1),
});
export type BatchCase = z.infer<typeof BatchCaseSchema>;

export const BatchInputSchema = z.array(BatchCaseSchema);
export type BatchInput = z.infer<typeof BatchInputSchema>;

export const BatchErrorSchema = z.object({
  code: z.string(),
  message: z.string(),
});
export type BatchError = z.infer<typeof BatchErrorSchema>;

export const BatchResultSchema = z.object({
  id: z.string(),
  status: z.enum(["ok", "failed"]),
  kit: KitSchema.nullable(),
  error: BatchErrorSchema.nullable(),
});
export type BatchResult = z.infer<typeof BatchResultSchema>;

export const BatchOutputSchema = z.object({
  version: z.string(),
  generated_at: z.string(),
  kits: z.array(BatchResultSchema),
});
export type BatchOutput = z.infer<typeof BatchOutputSchema>;

export function makeOkResult(id: string, kit: Kit): BatchResult {
  return { id, status: "ok", kit, error: null };
}

export function makeFailedResult(id: string, code: string, message: string): BatchResult {
  return { id, status: "failed", kit: null, error: { code, message } };
}
