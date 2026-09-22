import { describe, expect, it } from "vitest";
import { hashPassword, verifyPassword, signSession, verifySession } from "../services/auth.service";

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
});
