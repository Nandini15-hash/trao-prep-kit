import { fetchPage, RetrievalError } from "./fetcher";
import { cleanPage, CleanedPage } from "./clean";
import { isAllowedByRobots } from "./robots";
import { scoreLink } from "./rank-links";
import { assertSafeUrl, crawlLimits, UnsafeUrlError } from "./url-safety";

export interface CrawledPage extends CleanedPage {
  url: string;
  hiringScore: number;
  aboutScore: number;
}

export interface SkippedSource {
  url: string;
  reason: string;
}

export interface FailedSource {
  url: string;
  code: string;
  message: string;
}

export interface CrawlResult {
  pages: CrawledPage[];
  aboutPage: CrawledPage | null;
  hiringPage: CrawledPage | null;
  skipped: SkippedSource[];
  failed: FailedSource[];
}

/**
 * A dedup KEY only — never used as the URL actually fetched. Stripping
 * the trailing slash here is purely so "/acme" and "/acme/" collapse to
 * one frontier entry; using this normalized form as the real fetch
 * target is a bug (it silently turns a valid URL into a different one —
 * "/acme/" and "/acme" are not guaranteed to be the same resource).
 */
function dedupeKey(url: string): string {
  const u = new URL(url);
  u.hash = "";
  if (u.pathname !== "/" && u.pathname.endsWith("/")) u.pathname = u.pathname.slice(0, -1);
  return u.toString();
}

interface FrontierItem {
  url: string; // the exact URL to fetch — never rewritten
  key: string; // dedup key
  priority: number; // Infinity for the seed URL, else max(hiring, about) score
}

/**
 * Crawls a company's site starting from its homepage, looking for the
 * "what they do" content (about/company pages) and, separately, a hiring
 * page — without a hard-coded path list (Section 2 is explicit that a
 * fixed list of paths is not sufficient; we tested this against real
 * sites that put it at /careers, /jobs, a handbook, or an engineering
 * blog).
 *
 * This is a bounded best-first search: the homepage is always fetched,
 * every same-origin link it exposes is scored (see rank-links.ts), and
 * the highest-scoring unvisited links are fetched next, discovering and
 * scoring their own links in turn, until crawlLimits.maxPages pages have
 * been fetched or nothing promising is left in the frontier. A source
 * that fails to fetch (404, timeout, blocked by robots.txt, rejected as
 * an unsafe URL) is recorded and the crawl continues — Section 2: "Skip
 * and report a source that cannot be retrieved, rather than failing the
 * whole run."
 */
export async function crawlCompanySite(companyUrl: string): Promise<CrawlResult> {
  const seed = await assertSafeUrl(companyUrl).catch((err) => {
    if (err instanceof UnsafeUrlError) {
      throw new RetrievalError(err.message, err.code);
    }
    throw err;
  });
  const origin = seed.origin;

  const visited = new Set<string>();
  const frontier: FrontierItem[] = [
    { url: seed.toString(), key: dedupeKey(seed.toString()), priority: Infinity },
  ];
  const pages: CrawledPage[] = [];
  const skipped: SkippedSource[] = [];
  const failed: FailedSource[] = [];

  while (frontier.length > 0 && pages.length < crawlLimits.maxPages) {
    frontier.sort((a, b) => b.priority - a.priority);
    const next = frontier.shift()!;
    if (visited.has(next.key)) continue;
    visited.add(next.key);

    const allowed = await isAllowedByRobots(next.url).catch(() => true);
    if (!allowed) {
      skipped.push({ url: next.url, reason: "disallowed by robots.txt" });
      continue;
    }

    let fetched;
    try {
      fetched = await fetchPage(next.url);
    } catch (err) {
      if (err instanceof RetrievalError) {
        failed.push({ url: next.url, code: err.code, message: err.message });
        continue;
      }
      failed.push({ url: next.url, code: "UNKNOWN", message: String(err) });
      continue;
    }

    const cleaned = cleanPage(fetched.html, fetched.url);
    const { hiring, about } = scoreLink({ href: fetched.url, text: cleaned.title }, origin);
    pages.push({ ...cleaned, url: fetched.url, hiringScore: hiring, aboutScore: about });

    for (const link of cleaned.links) {
      const key = dedupeKey(link.href);
      if (visited.has(key) || frontier.some((f) => f.key === key)) continue;
      const score = scoreLink(link, origin);
      const priority = Math.max(score.hiring, score.about);
      if (priority > 0) {
        frontier.push({ url: link.href, key, priority });
      }
    }
  }

  for (const item of frontier) {
    skipped.push({ url: item.url, reason: "crawl budget exhausted before this page was reached" });
  }

  const hiringPage =
    pages
      .filter((p) => p.hiringScore > 0)
      .sort((a, b) => b.hiringScore - a.hiringScore)[0] ?? null;
  const aboutPage =
    pages.slice().sort((a, b) => b.aboutScore - a.aboutScore)[0] ?? pages[0] ?? null;

  return { pages, aboutPage, hiringPage, skipped, failed };
}
