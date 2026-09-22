import { describe, expect, it, vi } from "vitest";

// A separate file (vitest isolates modules per test file) so NODE_ENV can
// be stubbed to "production" before ../lib/env is ever imported — env.ts
// reads process.env once, at import time.
vi.stubEnv("NODE_ENV", "production");
vi.stubEnv("JWT_SECRET", "test-secret-please-ignore-1234");
vi.stubEnv("MONGODB_URI", "mongodb://localhost:27017/test");

describe("assertSafeUrl in production", () => {
  it("rejects loopback and private addresses", async () => {
    const { assertSafeUrl, UnsafeUrlError } = await import("../services/retrieval/url-safety");
    await expect(assertSafeUrl("http://127.0.0.1:8099/acme/")).rejects.toThrow(UnsafeUrlError);
    await expect(assertSafeUrl("http://localhost:8099/acme/")).rejects.toThrow(UnsafeUrlError);
    await expect(assertSafeUrl("http://10.0.0.5/")).rejects.toThrow(UnsafeUrlError);
    await expect(assertSafeUrl("http://192.168.1.1/")).rejects.toThrow(UnsafeUrlError);
  });

  it("still allows a normal public hostname", async () => {
    const { assertSafeUrl } = await import("../services/retrieval/url-safety");
    // example.com is a stable, always-resolvable public domain reserved
    // for documentation/testing use (RFC 2606) — safe to depend on here.
    await expect(assertSafeUrl("https://example.com")).resolves.toBeInstanceOf(URL);
  });
});
