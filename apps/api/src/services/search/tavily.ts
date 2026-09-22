import { env } from "../../lib/env";

export interface DiscussionResult {
  title: string;
  url: string;
  snippet: string;
}

export interface SearchOutcome {
  /** false when we never made a request at all (no API key configured). */
  attempted: boolean;
  results: DiscussionResult[];
  error?: { code: string; message: string };
}

const TAVILY_URL = "https://api.tavily.com/search";
const TIMEOUT_MS = 10_000;
const MAX_RESULTS = 5;

/**
 * Section 3: "Look for public discussion of how the company interviews."
 * This is deliberately a *web* search, not another crawl of the company's
 * own site — Glassdoor/Blind/Reddit threads and blog posts about a
 * company's interview process live off-domain. Tavily was chosen over
 * Brave Search API (dropped its free tier in Feb 2026 — now bills after a
 * ~$5 credit) and Google's Custom Search JSON API (closed to new
 * customers, sunsetting by 2027): 1,000 free credits/month, no card, and
 * it returns pre-cleaned snippets meant for exactly this kind of
 * LLM-context use.
 *
 * Section 10's edge cases apply here as much as to the LLM: "Public
 * discussion of the company turns up nothing at all" and "Your ...
 * provider rate-limits you, or briefly fails" must both produce an honest
 * empty/partial result, never a thrown error that kills the whole kit.
 */
export async function searchPublicInterviewDiscussion(companyName: string): Promise<SearchOutcome> {
  if (!env.TAVILY_API_KEY) {
    return {
      attempted: false,
      results: [],
      error: { code: "NO_API_KEY", message: "TAVILY_API_KEY is not configured" },
    };
  }

  const query = `${companyName} interview process experience questions`;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);

  try {
    const res = await fetch(TAVILY_URL, {
      method: "POST",
      signal: controller.signal,
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${env.TAVILY_API_KEY}`,
      },
      body: JSON.stringify({
        query,
        search_depth: "basic",
        max_results: MAX_RESULTS,
        include_answer: false,
      }),
    });

    if (res.status === 429) {
      return {
        attempted: true,
        results: [],
        error: { code: "RATE_LIMITED", message: "Tavily rate-limited this request" },
      };
    }
    if (!res.ok) {
      return {
        attempted: true,
        results: [],
        error: { code: "HTTP_ERROR", message: `Tavily returned HTTP ${res.status}` },
      };
    }

    const body = (await res.json()) as {
      results?: { title: string; url: string; content: string }[];
    };

    const results: DiscussionResult[] = (body.results ?? []).map((r) => ({
      title: r.title,
      url: r.url,
      snippet: r.content,
    }));

    return { attempted: true, results };
  } catch (err) {
    const timedOut = (err as any)?.name === "AbortError";
    return {
      attempted: true,
      results: [],
      error: {
        code: timedOut ? "TIMEOUT" : "NETWORK_ERROR",
        message: timedOut ? "Tavily request timed out" : String(err),
      },
    };
  } finally {
    clearTimeout(timeout);
  }
}
