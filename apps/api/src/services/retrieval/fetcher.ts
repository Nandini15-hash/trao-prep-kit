import { assertSafeUrl, assertSafeRedirect, crawlLimits, UnsafeUrlError } from "./url-safety";
import { HostRateLimiter, sleep } from "./rate-limiter";

export class RetrievalError extends Error {
  code: string;
  constructor(message: string, code: string) {
    super(message);
    this.code = code;
  }
}

const ALLOWED_CONTENT_TYPES = ["text/html", "text/plain", "application/xhtml+xml"];
const MAX_BODY_BYTES = 3_000_000; // 3MB — a page, not a video
const MAX_REDIRECTS = 5;
const MAX_RETRIES = 2;

const rateLimiter = new HostRateLimiter();

export interface FetchedPage {
  url: string; // final URL after redirects
  status: number;
  contentType: string;
  html: string;
}

async function fetchOnce(url: URL): Promise<FetchedPage> {
  await rateLimiter.wait(url.host, crawlLimits.rateLimitMs);

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), crawlLimits.timeoutMs);

  let current = url;
  try {
    for (let redirects = 0; redirects <= MAX_REDIRECTS; redirects++) {
      const res = await fetch(current, {
        redirect: "manual",
        signal: controller.signal,
        headers: {
          "User-Agent": "TraoPrepKitBot/1.0 (+interview prep kit assessment; respects robots.txt)",
          Accept: "text/html,application/xhtml+xml",
        },
      });

      if (res.status >= 300 && res.status < 400 && res.headers.get("location")) {
        const location = res.headers.get("location")!;
        try {
          current = await assertSafeRedirect(location, current);
        } catch (err) {
          if (err instanceof UnsafeUrlError) {
            throw new RetrievalError(`Redirect target rejected: ${err.message}`, err.code);
          }
          throw err;
        }
        continue;
      }

      if (res.status >= 500 || res.status === 429) {
        throw new RetrievalError(`HTTP ${res.status} from ${current}`, "HTTP_TRANSIENT");
      }
      if (!res.ok) {
        throw new RetrievalError(`HTTP ${res.status} from ${current}`, "HTTP_ERROR");
      }

      const contentType = (res.headers.get("content-type") ?? "").split(";")[0].trim().toLowerCase();
      if (!ALLOWED_CONTENT_TYPES.includes(contentType)) {
        throw new RetrievalError(`Unsupported content-type "${contentType}"`, "BAD_CONTENT_TYPE");
      }

      const contentLength = Number(res.headers.get("content-length") ?? "0");
      if (contentLength > MAX_BODY_BYTES) {
        throw new RetrievalError("Response exceeds size limit", "TOO_LARGE");
      }

      const html = await readBodyWithCap(res, MAX_BODY_BYTES);
      return { url: current.toString(), status: res.status, contentType, html };
    }
    throw new RetrievalError("Too many redirects", "TOO_MANY_REDIRECTS");
  } catch (err) {
    if ((err as any)?.name === "AbortError") {
      throw new RetrievalError(`Timed out fetching ${current}`, "TIMEOUT");
    }
    throw err;
  } finally {
    clearTimeout(timeout);
  }
}

async function readBodyWithCap(res: Response, maxBytes: number): Promise<string> {
  if (!res.body) return res.text();
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel();
      throw new RetrievalError("Response exceeds size limit", "TOO_LARGE");
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks.map((c) => Buffer.from(c))).toString("utf-8");
}

const RETRYABLE_CODES = new Set(["HTTP_TRANSIENT", "TIMEOUT", "DNS_FAILURE"]);

/**
 * Fetches one page, validating the URL for SSRF safety first. Retries
 * transient failures (5xx, 429, timeout) with backoff; anything else
 * (bad content type, too large, non-retryable HTTP error, unsafe URL)
 * fails immediately since retrying wouldn't change the outcome.
 */
export async function fetchPage(rawUrl: string): Promise<FetchedPage> {
  const url = await assertSafeUrl(rawUrl).catch((err) => {
    if (err instanceof UnsafeUrlError) {
      throw new RetrievalError(err.message, err.code);
    }
    throw err;
  });

  let lastErr: unknown;
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      return await fetchOnce(url);
    } catch (err) {
      lastErr = err;
      const code = err instanceof RetrievalError ? err.code : undefined;
      if (attempt < MAX_RETRIES && code && RETRYABLE_CODES.has(code)) {
        await sleep(300 * 2 ** attempt);
        continue;
      }
      break;
    }
  }
  throw lastErr;
}
