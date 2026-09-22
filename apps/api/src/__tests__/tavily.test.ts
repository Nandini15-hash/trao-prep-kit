import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

describe("searchPublicInterviewDiscussion", () => {
  const realFetch = global.fetch;

  afterEach(() => {
    global.fetch = realFetch;
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it("does not attempt a request when no API key is configured", async () => {
    vi.stubEnv("TAVILY_API_KEY", "");
    vi.resetModules();
    const { searchPublicInterviewDiscussion } = await import("../services/search/tavily");

    const fetchSpy = vi.fn();
    global.fetch = fetchSpy as any;

    const outcome = await searchPublicInterviewDiscussion("Acme Corp");
    expect(outcome.attempted).toBe(false);
    expect(outcome.results).toEqual([]);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("maps Tavily results into DiscussionResult shape", async () => {
    vi.stubEnv("TAVILY_API_KEY", "tvly-test-key");
    vi.resetModules();
    const { searchPublicInterviewDiscussion } = await import("../services/search/tavily");

    global.fetch = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        results: [
          { title: "Acme interview review", url: "https://example.com/a", content: "Took 3 rounds." },
        ],
      }),
    })) as any;

    const outcome = await searchPublicInterviewDiscussion("Acme Corp");
    expect(outcome.attempted).toBe(true);
    expect(outcome.results).toEqual([
      { title: "Acme interview review", url: "https://example.com/a", snippet: "Took 3 rounds." },
    ]);
  });

  it("reports a rate limit without throwing", async () => {
    vi.stubEnv("TAVILY_API_KEY", "tvly-test-key");
    vi.resetModules();
    const { searchPublicInterviewDiscussion } = await import("../services/search/tavily");

    global.fetch = vi.fn(async () => ({ ok: false, status: 429 })) as any;

    const outcome = await searchPublicInterviewDiscussion("Acme Corp");
    expect(outcome.attempted).toBe(true);
    expect(outcome.results).toEqual([]);
    expect(outcome.error?.code).toBe("RATE_LIMITED");
  });

  it("reports 'nothing found' honestly rather than fabricating results", async () => {
    vi.stubEnv("TAVILY_API_KEY", "tvly-test-key");
    vi.resetModules();
    const { searchPublicInterviewDiscussion } = await import("../services/search/tavily");

    global.fetch = vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ results: [] }) })) as any;

    const outcome = await searchPublicInterviewDiscussion("A Company Nobody Has Reviewed");
    expect(outcome.attempted).toBe(true);
    expect(outcome.results).toEqual([]);
    expect(outcome.error).toBeUndefined();
  });
});
