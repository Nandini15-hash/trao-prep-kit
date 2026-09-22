import { env } from "../../lib/env";
import { LlmError } from "./errors";

const TIMEOUT_MS = 30_000;
const MAX_RETRIES = 3;

export interface GeminiCallOptions {
  systemInstruction?: string;
  temperature?: number;
  /** Force valid-JSON output. Combined with a strict prompt + our own
   *  Zod validation, this doesn't require mapping every schema into
   *  Gemini's OpenAPI-flavoured responseSchema format. */
  jsonMode?: boolean;
}

interface GeminiResponse {
  candidates?: {
    content?: { parts?: { text?: string }[] };
    finishReason?: string;
  }[];
  promptFeedback?: { blockReason?: string };
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * A single call to Gemini's generateContent REST endpoint, returning the
 * raw text of the first candidate. Retries 429/5xx/timeout with backoff
 * (Section 2/9: "free tiers limit tokens per minute ... a pipeline that
 * falls over the first time a provider says 'slow down' is the most
 * common way to lose points here"); anything else (bad request, blocked
 * prompt) fails immediately since retrying won't change the outcome.
 *
 * Model naming here moves fast — GEMINI_MODEL is an env var rather than
 * hardcoded so it's a one-line change, not a redeploy, when a model is
 * retired or a better default appears. See README for how to check what's
 * current at ai.google.dev.
 */
export async function callGemini(prompt: string, options: GeminiCallOptions = {}): Promise<string> {
  if (!env.GEMINI_API_KEY) {
    throw new LlmError("GEMINI_API_KEY is not configured", "NO_API_KEY");
  }

  const url = `https://generativelanguage.googleapis.com/v1beta/models/${env.GEMINI_MODEL}:generateContent`;

  const body: Record<string, unknown> = {
    contents: [{ role: "user", parts: [{ text: prompt }] }],
    generationConfig: {
      temperature: options.temperature ?? 0.4,
      ...(options.jsonMode ? { responseMimeType: "application/json" } : {}),
    },
  };
  if (options.systemInstruction) {
    body.systemInstruction = { parts: [{ text: options.systemInstruction }] };
  }

  let lastErr: unknown;
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);
    try {
      const res = await fetch(url, {
        method: "POST",
        signal: controller.signal,
        headers: {
          "Content-Type": "application/json",
          "x-goog-api-key": env.GEMINI_API_KEY,
        },
        body: JSON.stringify(body),
      });

      if (res.status === 429) {
        throw new LlmError("Gemini rate-limited this request", "RATE_LIMITED");
      }
      if (res.status >= 500) {
        throw new LlmError(`Gemini returned HTTP ${res.status}`, "HTTP_ERROR");
      }
      if (!res.ok) {
        const detail = await res.text().catch(() => "");
        // Any other 4xx (400, 401, 403...) is a property of *this*
        // request — a malformed body, a bad key — not a transient
        // server condition, so it goes in the same non-retryable bucket
        // as BLOCKED above rather than HTTP_ERROR: retrying an
        // unmodified request wouldn't change the outcome, just burn the
        // retry budget and delay a fix the caller actually needs to make.
        throw new LlmError(`Gemini returned HTTP ${res.status}: ${detail.slice(0, 300)}`, "BAD_REQUEST");
      }

      const data = (await res.json()) as GeminiResponse;
      if (data.promptFeedback?.blockReason) {
        // Distinct from HTTP_ERROR deliberately: a safety-filter block is
        // a property of the prompt/content, not a transient server
        // condition, so retrying the identical prompt would just burn
        // the retry budget waiting for the same block again.
        throw new LlmError(`Prompt blocked: ${data.promptFeedback.blockReason}`, "BLOCKED");
      }
      const text = data.candidates?.[0]?.content?.parts?.map((p) => p.text ?? "").join("") ?? "";
      if (!text.trim()) {
        throw new LlmError("Gemini returned an empty response", "EMPTY_RESPONSE");
      }
      return text;
    } catch (err) {
      lastErr = err;
      const isTimeout = (err as any)?.name === "AbortError";
      const code = err instanceof LlmError ? err.code : isTimeout ? "TIMEOUT" : "NETWORK_ERROR";
      const retryable = code === "RATE_LIMITED" || code === "HTTP_ERROR" || code === "TIMEOUT" || code === "NETWORK_ERROR";
      if (attempt < MAX_RETRIES && retryable) {
        await sleep(500 * 2 ** attempt);
        continue;
      }
      if (err instanceof LlmError) throw err;
      throw new LlmError(isTimeout ? "Gemini request timed out" : String(err), isTimeout ? "TIMEOUT" : "NETWORK_ERROR");
    } finally {
      clearTimeout(timeout);
    }
  }
  // Unreachable, but keeps TS happy about the return type.
  throw lastErr instanceof LlmError ? lastErr : new LlmError("Gemini call failed", "NETWORK_ERROR");
}
