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
  // Deployment (Section 12) almost always puts the frontend and backend
  // on two different free-tier hosts (e.g. Vercel + Render) — genuinely
  // cross-site from the cookie's point of view. A `lax` cookie is not
  // sent on a cross-site fetch/XHR (only a top-level navigation), so it
  // would silently break every authenticated request in production even
  // though local dev (same-site http://localhost) worked fine. `none`
  // requires `secure`, which requires https — true in every real
  // deployment, never true for local http dev, so the two are tied
  // together rather than independently configured.
  const crossSite = env.NODE_ENV === "production";
  return {
    httpOnly: true,
    secure: crossSite,
    sameSite: (crossSite ? "none" : "lax") as "none" | "lax",
    maxAge: env.SESSION_TTL_SECONDS * 1000,
    path: "/",
  };
}
