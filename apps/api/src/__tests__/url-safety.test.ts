import { describe, expect, it } from "vitest";
import { assertSafeUrlShape, UnsafeUrlError } from "../services/retrieval/url-safety";

describe("assertSafeUrlShape", () => {
  it("accepts http and https URLs", () => {
    expect(assertSafeUrlShape("https://example.com").protocol).toBe("https:");
    expect(assertSafeUrlShape("http://example.com").protocol).toBe("http:");
  });

  it("rejects non-http(s) schemes so a crawl can't be redirected into file:// or worse", () => {
    expect(() => assertSafeUrlShape("file:///etc/passwd")).toThrow(UnsafeUrlError);
    expect(() => assertSafeUrlShape("ftp://example.com")).toThrow(UnsafeUrlError);
  });

  it("rejects garbage input instead of throwing an unrelated error", () => {
    expect(() => assertSafeUrlShape("not a url")).toThrow(UnsafeUrlError);
  });
});

// The production SSRF guard (rejecting private/loopback addresses) is
// covered separately in url-safety.production.test.ts, which stubs
// NODE_ENV=production before importing the module — env.ts reads
// process.env once at import time, so that has to happen in its own
// test file rather than here.
