import * as cheerio from "cheerio";

export interface CleanedPage {
  title: string;
  text: string;
  links: { href: string; text: string }[];
}

// Never contain a link worth following or text worth reading — safe to
// strip before we even look at the page.
const DEAD_WEIGHT_SELECTORS = ["script", "style", "noscript", "svg", "iframe"];

// Chrome that's noise for *body text* (repeated on every page, dilutes
// what the LLM sees) but is exactly where a real site's careers/about
// links live — nav bars and footers are the first place a company links
// to "Careers" or "About". These must stay in the DOM through link
// extraction and only get removed afterwards, for the text pass.
const TEXT_ONLY_NOISE_SELECTORS = ["nav", "footer", "header", "[aria-hidden='true']"];

/**
 * Strips an HTML page down to the parts worth feeding an LLM: a title,
 * normalised visible text, and the outgoing links (with their anchor
 * text, since the crawler ranks links by what they say as well as where
 * they point). Retrieval and cleaning are one function each, kept
 * separate from crawling itself (which decides *which* links to follow)
 * and from generation (which decides what to do with the text) — Section
 * 13's "keep retrieval, extraction, generation ... as clearly separated
 * concerns".
 */
export function cleanPage(html: string, baseUrl: string): CleanedPage {
  const $ = cheerio.load(html);
  $(DEAD_WEIGHT_SELECTORS.join(",")).remove();

  const title = $("title").first().text().trim() || $("h1").first().text().trim();

  const links: { href: string; text: string }[] = [];
  const seen = new Set<string>();
  $("a[href]").each((_, el) => {
    const href = $(el).attr("href");
    if (!href) return;
    let absolute: string;
    try {
      absolute = new URL(href, baseUrl).toString();
    } catch {
      return;
    }
    // Drop fragments-only links and non-http(s) schemes (mailto:, tel:, javascript:)
    if (!absolute.startsWith("http://") && !absolute.startsWith("https://")) return;
    const withoutHash = absolute.split("#")[0];
    if (seen.has(withoutHash)) return;
    seen.add(withoutHash);
    links.push({ href: withoutHash, text: $(el).text().replace(/\s+/g, " ").trim() });
  });

  // Links are captured; now strip nav/footer/header chrome so the text
  // extraction reflects actual page content, not repeated site furniture.
  $(TEXT_ONLY_NOISE_SELECTORS.join(",")).remove();
  const text = $("body").text().replace(/\s+/g, " ").trim();

  return { title, text, links };
}
