import express, { NextFunction, Request, Response } from "express";
import cors from "cors";
import cookieParser from "cookie-parser";
import { env } from "./lib/env";
import { healthRouter } from "./routes/health";
import { authRouter } from "./routes/auth.routes";
import { kitRouter } from "./routes/kit.routes";

export function createApp() {
  const app = express();

  const allowedOrigins = env.CORS_ORIGIN.split(",").map((s) => s.trim());
  app.use(
    cors({
      origin: allowedOrigins,
      credentials: true,
    })
  );
  app.use(cookieParser());
  // Kits can include a full pasted JD plus crawled page text; keep the body
  // limit generous but bounded (see Section 11 — restrict handling to
  // expected content types and sizes).
  app.use(express.json({ limit: "2mb" }));

  app.use(healthRouter);
  app.use(authRouter);
  app.use(kitRouter);

  // 404
  app.use((req: Request, res: Response) => {
    res.status(404).json({ error: { code: "NOT_FOUND", message: "No such route" } });
  });

  // Central error handler — always return structured JSON, never leak
  // stack traces in production.
  app.use((err: any, _req: Request, res: Response, _next: NextFunction) => {
    const status = err.status || err.statusCode || 500;
    const code = err.code || "INTERNAL_ERROR";
    const message = err.publicMessage || (status === 500 ? "Something went wrong" : err.message);
    if (status === 500) {
      // eslint-disable-next-line no-console
      console.error(err);
    }
    res.status(status).json({ error: { code, message } });
  });

  return app;
}
