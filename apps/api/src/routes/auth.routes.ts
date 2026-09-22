import { Router } from "express";
import { z } from "zod";
import { User } from "../models/User";
import {
  hashPassword,
  verifyPassword,
  signSession,
  sessionCookieOptions,
  SESSION_COOKIE,
} from "../services/auth.service";
import { requireAuth } from "../middleware/auth.middleware";
import { HttpError, asyncHandler } from "../lib/http-error";

export const authRouter = Router();

const CredentialsSchema = z.object({
  email: z.string().trim().toLowerCase().email(),
  // Keep this layer minimal per the brief (no email verification / reset),
  // but still enforce a floor so accounts aren't trivially guessable.
  password: z.string().min(8).max(200),
});

authRouter.post(
  "/auth/register",
  asyncHandler(async (req, res) => {
    const parsed = CredentialsSchema.safeParse(req.body);
    if (!parsed.success) {
      throw HttpError.badRequest(parsed.error.issues[0]?.message ?? "Invalid input", "VALIDATION_ERROR");
    }
    const { email, password } = parsed.data;

    const existing = await User.findOne({ email });
    if (existing) {
      throw HttpError.conflict("An account with that email already exists", "EMAIL_TAKEN");
    }

    const passwordHash = await hashPassword(password);
    const user = await User.create({ email, passwordHash });

    const token = signSession({ sub: user._id.toString() });
    res.cookie(SESSION_COOKIE, token, sessionCookieOptions());
    res.status(201).json({ user: { id: user._id, email: user.email } });
  })
);

authRouter.post(
  "/auth/login",
  asyncHandler(async (req, res) => {
    const parsed = CredentialsSchema.safeParse(req.body);
    if (!parsed.success) {
      throw HttpError.badRequest("Invalid email or password", "VALIDATION_ERROR");
    }
    const { email, password } = parsed.data;

    const user = await User.findOne({ email });
    // Same error for "no such user" and "wrong password" — don't leak
    // which one it was.
    const ok = user ? await verifyPassword(password, user.passwordHash) : false;
    if (!user || !ok) {
      throw HttpError.unauthorized("Incorrect email or password", "INVALID_CREDENTIALS");
    }

    const token = signSession({ sub: user._id.toString() });
    res.cookie(SESSION_COOKIE, token, sessionCookieOptions());
    res.json({ user: { id: user._id, email: user.email } });
  })
);

authRouter.post("/auth/logout", (_req, res) => {
  res.clearCookie(SESSION_COOKIE, { path: "/" });
  res.status(204).end();
});

authRouter.get(
  "/auth/me",
  requireAuth,
  asyncHandler(async (req, res) => {
    const user = await User.findById(req.userId).select("email");
    if (!user) {
      // Session was valid but the user no longer exists (deleted account).
      res.clearCookie(SESSION_COOKIE, { path: "/" });
      throw HttpError.unauthorized();
    }
    res.json({ user: { id: user._id, email: user.email } });
  })
);
