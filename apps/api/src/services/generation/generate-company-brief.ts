import { z } from "zod";
import { generateStructured, wrapUntrusted } from "../llm";

const ResponseSchema = z.object({
  summary: z.string(),
  what_they_do: z.string(),
});
export type CompanyBriefDraft = z.infer<typeof ResponseSchema>;

/**
 * Section 10: "A company you can find nothing about should produce an
 * honest brief rather than a fabricated one." If the crawl found no
 * usable page text at all, this isn't called — the pipeline sets an
 * explicit "we couldn't find information about this company" summary in
 * code instead of asking the model to write around an empty prompt.
 */
export async function generateCompanyBrief(params: {
  companyName: string;
  pagesText: string; // concatenated cleaned text from the crawled about/homepage
}): Promise<CompanyBriefDraft> {
  const prompt = `Summarize what ${params.companyName} does, based only on the page content below.\n\n${wrapUntrusted(
    "company_pages",
    params.pagesText
  )}`;

  const systemInstruction = `You write a short, factual company brief for someone preparing for a job interview there. Use only what the provided page content actually says — do not add outside knowledge about the company, and do not guess at details the text doesn't support. If the provided content is thin, write a short, honest brief that reflects that rather than padding it out.

Respond with ONLY JSON:
{
  "summary": string (2-4 sentences: what the company is, roughly),
  "what_they_do": string (2-4 sentences: their product/service and who it's for)
}`;

  return generateStructured({
    schema: ResponseSchema,
    systemInstruction,
    prompt,
    temperature: 0.3,
  });
}
