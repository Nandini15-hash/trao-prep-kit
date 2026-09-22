import { NextFunction, Request, Response } from "express";
import { SESSION_COOKIE, verifySession } from "../services/auth.service";
import { HttpError } from "../lib/http-error";

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      userId?: string;
    }
  }
}

/**
 * Requires a valid, unexpired session cookie. A signed-out visitor (no
 * cookie) or one with an expired/invalid token both get a plain 401 —
 * neither reaches a protected route or leaks which case it was.
 */
export function requireAuth(req: Request, _res: Response, next: NextFunction) {
  const token = req.cookies?.[SESSION_COOKIE];
  const payload = token ? verifySession(token) : null;
  if (!payload) {
    return next(HttpError.unauthorized());
  }
  req.userId = payload.sub;
  next();
}
