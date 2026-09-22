#!/usr/bin/env node
import { promises as fs } from "fs";
import path from "path";
import pLimit from "p-limit";
import {
  BatchCase,
  BatchInputSchema,
  BatchOutput,
  BatchResult,
  KitSchema,
  makeFailedResult,
  makeOkResult,
  validateKitStructure,
} from "@trao/shared";
import { generateKit } from "../services/generation/pipeline";

/**
 * Section 9 (Mandatory Batch Entry Point):
 *
 *   npm run evaluate -- --input cases.json --output kits.json
 *
 * This reuses generateKit() from services/generation/pipeline.ts —
 * exactly the function apps/api/src/services/kit.service.ts calls for a
 * kit created through the interface — rather than a parallel
 * implementation, so this command genuinely exercises the same
 * retrieval/generation/validation path the app uses, not a lookalike.
 *
 * No database or HTTP server involved: batch mode reads cases straight
 * from disk and writes kits straight back to disk, so it has no
 * dependency on Mongo being reachable or the API being up. It still
 * imports lib/env.ts (via the pipeline's own imports), which means
 * MONGODB_URI and JWT_SECRET must be *present* in .env — see
 * .env.example — even though batch mode never touches either; they can
 * be left as placeholder values if you're only ever running this
 * command. GEMINI_API_KEY and TAVILY_API_KEY are the ones that actually
 * matter here.
 */

// Bounds worst-case wall-clock so a single wedged case (a provider that
// never responds, a company site that hangs past its own fetch timeouts
// in some unexpected way) can't consume the whole 15-minute budget
// Section 9 sets for 5 cases. If a case blows through this, it's
// recorded as a normal "failed" result — same as any other case the
// pipeline couldn't produce a kit for — and the run continues.
const CASE_TIMEOUT_MS = 4 * 60_000;

// Cases run with bounded concurrency rather than fully serial or fully
// parallel. Serial risks the 15-minute budget if any case needs a
// retried/backed-off call; fully parallel multiplies how fast a free-tier
// per-minute rate limit gets hit, which just pushes the slowdown from
// wall-clock into more retries. 2 is a middle ground: with the
// CASE_TIMEOUT_MS above, 5 cases at concurrency 2 complete in at most
// 3 batches x 4 minutes = 12 minutes even if every single case times out,
// comfortably inside the 15-minute budget, while still parallelizing the
// common case where most cases finish in well under a minute.
const CONCURRENCY = 2;

interface ParsedArgs {
  input: string;
  output: string;
}

export function parseArgs(argv: string[]): ParsedArgs {
  let input: string | undefined;
  let output: string | undefined;

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--input" || arg === "-i") {
      input = argv[++i];
    } else if (arg.startsWith("--input=")) {
      input = arg.slice("--input=".length);
    } else if (arg === "--output" || arg === "-o") {
      output = argv[++i];
    } else if (arg.startsWith("--output=")) {
      output = arg.slice("--output=".length);
    }
  }

  if (!input || !output) {
    // eslint-disable-next-line no-console
    console.error("Usage: npm run evaluate -- --input <cases.json> --output <kits.json>");
    process.exit(1);
  }

  return { input, output };
}

function describeError(err: unknown): { code: string; message: string } {
  if (err instanceof Error) {
    // LlmError (services/llm/errors.ts) and RetrievalError (services/
    // retrieval/fetcher.ts) both carry a typed `code`; anything else
    // (a plain thrown Error) falls back to a generic one.
    const code = typeof (err as any).code === "string" ? (err as any).code : "GENERATION_FAILED";
    return { code, message: err.message };
  }
  return { code: "GENERATION_FAILED", message: String(err) };
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(Object.assign(new Error(`Timed out after ${Math.round(ms / 1000)}s`), { code: "TIMEOUT" }));
    }, ms);
    promise.then(
      (v) => {
        clearTimeout(timer);
        resolve(v);
      },
      (e) => {
        clearTimeout(timer);
        reject(e);
      }
    );
  });
}

/** Runs one case end to end and always resolves — never rejects — with a
 *  BatchResult, so a single bad case can't take down Promise.all for the
 *  rest of the run (Section 9: "continues after one case fails"). */
export async function runCase(kase: BatchCase): Promise<BatchResult> {
  const startedAt = Date.now();
  // eslint-disable-next-line no-console
  console.error(`[${kase.id}] starting (days=${kase.days}, company_url=${kase.company_url})`);
  try {
    const kit = await withTimeout(
      generateKit({ jd: kase.jd, companyUrl: kase.company_url, days: kase.days }),
      CASE_TIMEOUT_MS
    );

    // Section 13: "validate a generated kit against the expected
    // structure before saving it" — applies here exactly as it does to
    // kit.service.ts's save path. generateKit() is expected to always
    // produce a schema-valid kit; if it somehow didn't, that's a bug
    // worth failing loudly on rather than writing a malformed kit into
    // kits.json and calling it "ok".
    const parsed = KitSchema.parse(kit);
    const issues = validateKitStructure(parsed);
    if (issues.length > 0) {
      throw new Error(`Generated kit failed structural validation: ${JSON.stringify(issues)}`);
    }

    const elapsed = ((Date.now() - startedAt) / 1000).toFixed(1);
    // eslint-disable-next-line no-console
    console.error(`[${kase.id}] ok (${elapsed}s)`);
    return makeOkResult(kase.id, parsed);
  } catch (err) {
    const { code, message } = describeError(err);
    const elapsed = ((Date.now() - startedAt) / 1000).toFixed(1);
    // eslint-disable-next-line no-console
    console.error(`[${kase.id}] failed after ${elapsed}s: ${code} — ${message}`);
    return makeFailedResult(kase.id, code, message);
  }
}

export async function main(argv: string[] = process.argv.slice(2)) {
  const { input, output } = parseArgs(argv);

  let raw: string;
  try {
    raw = await fs.readFile(path.resolve(input), "utf-8");
  } catch (err) {
    console.error(`Could not read input file "${input}": ${err instanceof Error ? err.message : String(err)}`);
    process.exit(1);
    return;
  }

  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch (err) {
    console.error(`Input file "${input}" is not valid JSON: ${err instanceof Error ? err.message : String(err)}`);
    process.exit(1);
    return;
  }

  const parsedInput = BatchInputSchema.safeParse(json);
  if (!parsedInput.success) {
    console.error(`Input file "${input}" does not match the expected case shape (Appendix B):`);
    console.error(parsedInput.error.issues.map((i) => `  - ${i.path.join(".")}: ${i.message}`).join("\n"));
    process.exit(1);
    return;
  }
  const cases = parsedInput.data;

  console.error(`Running ${cases.length} case(s) at concurrency ${CONCURRENCY}...`);
  const limit = pLimit(CONCURRENCY);
  const started = Date.now();
  const results = await Promise.all(cases.map((kase) => limit(() => runCase(kase))));
  const totalElapsed = ((Date.now() - started) / 1000).toFixed(1);

  const okCount = results.filter((r) => r.status === "ok").length;
  console.error(`Done in ${totalElapsed}s — ${okCount}/${results.length} ok.`);

  const batchOutput: BatchOutput = {
    version: "1.0",
    generated_at: new Date().toISOString(),
    kits: results,
  };

  await fs.mkdir(path.dirname(path.resolve(output)), { recursive: true });
  await fs.writeFile(path.resolve(output), JSON.stringify(batchOutput, null, 2), "utf-8");
  console.error(`Wrote ${output}`);
}

// Only run when invoked directly (`npm run evaluate` / `tsx
// src/scripts/evaluate.ts`), not when this module is imported by tests.
if (require.main === module) {
  main().catch((err) => {
    console.error("evaluate failed:", err);
    process.exit(1);
  });
}
