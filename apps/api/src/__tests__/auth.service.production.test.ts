import { describe, expect, it, vi } from "vitest";

// Separate file so NODE_ENV can be stubbed to "production" before ../lib/env
// is ever imported (env.ts reads process.env once, at import time) — same
// approach as url-safety.production.test.ts.
vi.stubEnv("NODE_ENV", "production");
vi.stubEnv("JWT_SECRET", "test-secret-please-ignore-1234");
vi.stubEnv("MONGODB_URI", "mongodb://localhost:27017/test");

describe("sessionCookieOptions in production", () => {
  it("uses SameSite=None + Secure, required for a cross-site frontend/backend deploy", async () => {
    const { sessionCookieOptions } = await import("../services/auth.service");
    const opts = sessionCookieOptions();
    expect(opts.sameSite).toBe("none");
    expect(opts.secure).toBe(true);
  });
});
