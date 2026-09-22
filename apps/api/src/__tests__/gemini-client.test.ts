import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";

/**
 * Section 10: "Your LLM provider rate-limits you, or briefly fails."
 * generate-structured.test.ts mocks callGemini() itself, so its own
 * retry/backoff — the thing that actually protects the pipeline from a
 * free-tier "slow down" (Section 2's explicit warning) — was previously
 * untested. These tests drive the real function against a mocked
 * `fetch`, with fake timers so the exponential backoff doesn't make the
 * suite slow.
 */

function jsonResponse(body: unknown, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
    text: async () => JSON.stringify(body),
  } as Response;
}

function candidateBody(text: string) {
  return { candidates: [{ content: { parts: [{ text }] } }] };
}

beforeEach(() => {
  vi.useFakeTimers();
  // A fresh module registry per test, since env.ts (a dependency of
  // gemini-client.ts) reads process.env once at import time — without
  // this, whichever GEMINI_API_KEY the first test's import saw would
  // stay cached (env.ts's module-level `parsed.data`) for every test
  // after it, regardless of what a later test stubs.
  vi.resetModules();
  vi.stubEnv("GEMINI_API_KEY", "test-key");
  vi.stubEnv("GEMINI_MODEL", "gemini-test-model");
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("callGemini", () => {
  it("fails fast with NO_API_KEY when the key isn't configured, without calling fetch", async () => {
    vi.stubEnv("GEMINI_API_KEY", "");
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const { callGemini } = await import("../services/llm/gemini-client");
    const { LlmError } = await import("../services/llm/errors");

    await expect(callGemini("prompt")).rejects.toThrow(LlmError);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("returns the candidate text on a clean first response", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(candidateBody("hello")));
    vi.stubGlobal("fetch", fetchMock);
    const { callGemini } = await import("../services/llm/gemini-client");

    await expect(callGemini("prompt")).resolves.toBe("hello");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("retries a 429 with backoff, then succeeds", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({}, 429))
      .mockResolvedValueOnce(jsonResponse(candidateBody("ok")));
    vi.stubGlobal("fetch", fetchMock);
    const { callGemini } = await import("../services/llm/gemini-client");

    const pending = callGemini("prompt");
    await vi.runAllTimersAsync();
    await expect(pending).resolves.toBe("ok");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("retries a 5xx, then succeeds", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({}, 503))
      .mockResolvedValueOnce(jsonResponse(candidateBody("ok")));
    vi.stubGlobal("fetch", fetchMock);
    const { callGemini } = await import("../services/llm/gemini-client");

    const pending = callGemini("prompt");
    await vi.runAllTimersAsync();
    await expect(pending).resolves.toBe("ok");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("retries a network-level failure (e.g. a dropped connection), then succeeds", async () => {
    const fetchMock = vi
      .fn()
      .mockRejectedValueOnce(new TypeError("fetch failed"))
      .mockResolvedValueOnce(jsonResponse(candidateBody("ok")));
    vi.stubGlobal("fetch", fetchMock);
    const { callGemini } = await import("../services/llm/gemini-client");

    const pending = callGemini("prompt");
    await vi.runAllTimersAsync();
    await expect(pending).resolves.toBe("ok");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("does not retry a non-retryable 4xx (e.g. a malformed request)", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ error: "bad request" }, 400));
    vi.stubGlobal("fetch", fetchMock);
    const { callGemini } = await import("../services/llm/gemini-client");
    const { LlmError } = await import("../services/llm/errors");

    await expect(callGemini("prompt")).rejects.toThrow(LlmError);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("does not retry a safety-filter block — retrying the same prompt can't unblock it", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ promptFeedback: { blockReason: "SAFETY" } }));
    vi.stubGlobal("fetch", fetchMock);
    const { callGemini } = await import("../services/llm/gemini-client");
    const { LlmError } = await import("../services/llm/errors");

    const err = await callGemini("prompt").catch((e) => e);
    expect(err).toBeInstanceOf(LlmError);
    expect(err.code).toBe("BLOCKED");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("gives up after exhausting retries and throws a typed LlmError", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({}, 503));
    vi.stubGlobal("fetch", fetchMock);
    const { callGemini } = await import("../services/llm/gemini-client");
    const { LlmError } = await import("../services/llm/errors");

    const pending = callGemini("prompt").catch((e) => e);
    await vi.runAllTimersAsync();
    const err = await pending;
    expect(err).toBeInstanceOf(LlmError);
    // 1 initial + 3 retries = 4 total attempts.
    expect(fetchMock).toHaveBeenCalledTimes(4);
  });
});
