import { CrawledPage } from "../retrieval/crawler";

const TITLE_NOISE = /\s*[|\-–—]\s*(careers?|jobs?|home|about( us)?|official site).*$/i;

/**
 * The application only ever collects a job description and a company
 * URL (Application Overview) — there's no separate "company name" field
 * — so the name has to be derived from what was actually crawled. Prefer
 * the homepage's <title>, cleaned of common suffixes ("Acme | Careers" →
 * "Acme"); fall back to the hostname when nothing was crawled at all
 * (Section 10: a site with no discoverable pages still needs an honest,
 * usable company name in the kit, not a blank).
 */
export function deriveCompanyName(companyUrl: string, pages: CrawledPage[]): string {
  const homepage = pages.find((p) => p.title.trim().length > 0);
  if (homepage) {
    const cleaned = homepage.title.replace(TITLE_NOISE, "").trim();
    if (cleaned) return cleaned;
  }

  try {
    const host = new URL(companyUrl).hostname.replace(/^www\./, "");
    const label = host.split(".")[0];
    return label.charAt(0).toUpperCase() + label.slice(1);
  } catch {
    return companyUrl;
  }
}
