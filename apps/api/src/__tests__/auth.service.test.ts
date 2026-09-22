import { describe, expect, it } from "vitest";
import { hashPassword, verifyPassword, signSession, verifySession, sessionCookieOptions } from "../services/auth.service";

describe("auth.service", () => {
  it("hashes a password so it cannot be compared as plain text, but verifies correctly", async () => {
    const hash = await hashPassword("correct-horse-battery-staple");
    expect(hash).not.toBe("correct-horse-battery-staple");
    expect(await verifyPassword("correct-horse-battery-staple", hash)).toBe(true);
    expect(await verifyPassword("wrong-password", hash)).toBe(false);
  });

  it("round-trips a session token", () => {
    const token = signSession({ sub: "user-123" });
    const payload = verifySession(token);
    expect(payload?.sub).toBe("user-123");
  });

  it("rejects a tampered or garbage token instead of throwing", () => {
    expect(verifySession("not-a-real-token")).toBeNull();
    const token = signSession({ sub: "user-123" });
    expect(verifySession(token.slice(0, -2) + "xx")).toBeNull();
  });

  it("uses SameSite=Lax and non-Secure outside production (plain http localhost)", () => {
    // The production case (SameSite=None + Secure, needed once frontend
    // and backend are on different hosts) is covered separately in
    // auth.service.production.test.ts — NODE_ENV is read once at import
    // time, so it can't be flipped within this file.
    const opts = sessionCookieOptions();
    expect(opts.sameSite).toBe("lax");
    expect(opts.secure).toBe(false);
  });
});
