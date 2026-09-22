import dns from "node:dns/promises";
import ipaddr from "ipaddr.js";
import { env, isProd } from "../../lib/env";

export class UnsafeUrlError extends Error {
  code: string;
  constructor(message: string, code = "UNSAFE_URL") {
    super(message);
    this.code = code;
  }
}

/**
 * Section 11: "Validate external URLs before fetching them, and reject
 * private and loopback addresses in production."
 *
 * The "in production" carve-out matters for real use here, not just as a
 * technicality: Section 9's batch harness explicitly serves company sites
 * from a local address ("company_url": "http://localhost:8099/acme/"), so
 * rejecting loopback outright would break the mandatory evaluate command.
 * Outside production, only the protocol and hostname-resolvability are
 * checked; in production, every resolved IP is checked against the
 * private/loopback/link-local ranges.
 */
export function assertSafeUrlShape(rawUrl: string): URL {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new UnsafeUrlError(`"${rawUrl}" is not a valid URL`, "INVALID_URL");
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new UnsafeUrlError(`Unsupported protocol "${url.protocol}"`, "UNSUPPORTED_PROTOCOL");
  }
  return url;
}

const BLOCKED_RANGES = [
  "unspecified",
  "loopback",
  "private",
  "linkLocal",
  "uniqueLocal",
  "reserved",
] as const;

function isBlockedAddress(address: string): boolean {
  try {
    const addr = ipaddr.process(address);
    const range = addr.range();
    return (BLOCKED_RANGES as readonly string[]).includes(range);
  } catch {
    // Not a literal IP — fine, caller resolves hostnames separately.
    return false;
  }
}

/**
 * Resolves the URL's hostname and, in production, rejects it if any
 * resolved address is private/loopback/link-local (defends against
 * DNS-rebinding style SSRF, not just a literal "http://127.0.0.1/").
 * In non-production this still resolves the hostname (so a typo'd host
 * fails fast) but does not reject private ranges, so the batch command's
 * localhost fixtures keep working.
 */
export async function assertSafeUrl(rawUrl: string): Promise<URL> {
  const url = assertSafeUrlShape(rawUrl);
  const hostname = url.hostname;

  if (isBlockedAddress(hostname)) {
    if (isProd) {
      throw new UnsafeUrlError(`"${hostname}" is a private/loopback address`, "PRIVATE_ADDRESS");
    }
    return url; // literal loopback IP, allowed outside production
  }

  let addresses: string[];
  try {
    const results = await dns.lookup(hostname, { all: true });
    addresses = results.map((r) => r.address);
  } catch {
    throw new UnsafeUrlError(`Could not resolve host "${hostname}"`, "DNS_FAILURE");
  }

  if (isProd && addresses.some(isBlockedAddress)) {
    throw new UnsafeUrlError(
      `"${hostname}" resolves to a private/loopback address`,
      "PRIVATE_ADDRESS"
    );
  }

  return url;
}

/** Re-validates a redirect target the same way as the original URL. */
export async function assertSafeRedirect(location: string, base: URL): Promise<URL> {
  const resolved = new URL(location, base);
  return assertSafeUrl(resolved.toString());
}

export const crawlLimits = {
  maxPages: env.CRAWL_MAX_PAGES,
  timeoutMs: env.CRAWL_TIMEOUT_MS,
  rateLimitMs: env.CRAWL_RATE_LIMIT_MS,
};
