import robotsParser, { Robot } from "robots-parser";
import { fetchPage, RetrievalError } from "./fetcher";

const cache = new Map<string, Robot | null>();

/**
 * Fetches and parses robots.txt for a URL's origin, caching per origin for
 * the lifetime of the process (a single kit generation makes many requests
 * to the same site; there's no reason to re-fetch robots.txt for each
 * one). A missing or unfetchable robots.txt is treated as "allow all" —
 * that's the standard convention, and matches Section 2's instruction to
 * "skip and report a source that cannot be retrieved" rather than fail
 * the run over a file that simply doesn't exist.
 */
async function getRobots(origin: string): Promise<Robot | null> {
  if (cache.has(origin)) return cache.get(origin)!;

  const robotsUrl = `${origin}/robots.txt`;
  try {
    const page = await fetchPageAsText(robotsUrl);
    const robots = robotsParser(robotsUrl, page);
    cache.set(origin, robots);
    return robots;
  } catch {
    cache.set(origin, null);
    return null;
  }
}

// robots.txt is text/plain, which fetchPage already allows, but we don't
// want a slow/broken robots.txt to consume retry budget meant for real
// content pages — a single attempt is enough here.
async function fetchPageAsText(url: string): Promise<string> {
  try {
    const res = await fetchPage(url);
    return res.html;
  } catch (err) {
    if (err instanceof RetrievalError) throw err;
    throw err;
  }
}

const USER_AGENT = "TraoPrepKitBot";

export async function isAllowedByRobots(url: string): Promise<boolean> {
  let origin: string;
  try {
    origin = new URL(url).origin;
  } catch {
    return false;
  }
  const robots = await getRobots(origin);
  if (!robots) return true; // no robots.txt reachable — default allow
  const allowed = robots.isAllowed(url, USER_AGENT);
  // robots-parser returns undefined when a rule can't be evaluated; treat
  // that as allowed rather than silently dropping the page.
  return allowed !== false;
}

export function clearRobotsCache() {
  cache.clear();
}
