import "dotenv/config";
import { z } from "zod";

const EnvSchema = z.object({
  PORT: z.coerce.number().int().default(4000),
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  CORS_ORIGIN: z.string().default("http://localhost:3000"),
  MONGODB_URI: z.string().min(1, "MONGODB_URI is required"),
  JWT_SECRET: z.string().min(16, "JWT_SECRET must be at least 16 characters"),
  SESSION_TTL_SECONDS: z.coerce.number().int().default(604800),
  GEMINI_API_KEY: z.string().optional().default(""),
  GEMINI_MODEL: z.string().default("gemini-2.0-flash"),
  SEARCH_PROVIDER: z.string().optional().default(""),
  SEARCH_API_KEY: z.string().optional().default(""),
  CRAWL_MAX_PAGES: z.coerce.number().int().default(8),
  CRAWL_TIMEOUT_MS: z.coerce.number().int().default(8000),
  CRAWL_RATE_LIMIT_MS: z.coerce.number().int().default(500),
});

const parsed = EnvSchema.safeParse(process.env);

if (!parsed.success) {
  console.error("Invalid environment configuration:");
  console.error(parsed.error.flatten().fieldErrors);
  throw new Error("Invalid environment configuration — see .env.example");
}

export const env = parsed.data;
export const isProd = env.NODE_ENV === "production";
