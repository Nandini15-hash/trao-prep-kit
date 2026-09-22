import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { env } from "../lib/env";

const SALT_ROUNDS = 10;

export function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, SALT_ROUNDS);
}

export function verifyPassword(password: string, hash: string): Promise<boolean> {
  return bcrypt.compare(password, hash);
}

export interface SessionPayload {
  sub: string; // user id
}

export function signSession(payload: SessionPayload): string {
  return jwt.sign(payload, env.JWT_SECRET, { expiresIn: env.SESSION_TTL_SECONDS });
}

/** Returns the payload, or null for a missing/expired/tampered token — never throws. */
export function verifySession(token: string): SessionPayload | null {
  try {
    const decoded = jwt.verify(token, env.JWT_SECRET);
    if (typeof decoded === "object" && decoded && "sub" in decoded) {
      return { sub: String((decoded as any).sub) };
    }
    return null;
  } catch {
    return null;
  }
}

export const SESSION_COOKIE = "session";

export function sessionCookieOptions() {
  return {
    httpOnly: true,
    secure: env.NODE_ENV === "production",
    sameSite: "lax" as const,
    maxAge: env.SESSION_TTL_SECONDS * 1000,
    path: "/",
  };
}
