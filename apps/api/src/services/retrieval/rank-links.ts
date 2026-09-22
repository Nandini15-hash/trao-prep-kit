export interface RankableLink {
  href: string;
  text: string;
}

const HIRING_KEYWORDS = [
  "career",
  "careers",
  "job",
  "jobs",
  "join-us",
  "join-our-team",
  "hiring",
  "position",
  "opportunit",
  "opening",
  "work-with-us",
  "life-at",
  "employment",
  "apply",
  "recruit",
];

const ABOUT_KEYWORDS = [
  "about",
  "company",
  "who-we-are",
  "our-story",
  "mission",
  "culture",
  "team",
  "values",
];

// Links that are almost never worth a crawl budget slot, whatever their
// anchor text says.
const SKIP_EXTENSIONS = /\.(pdf|zip|png|jpe?g|gif|svg|css|js|mp4|mov|ico|woff2?)(\?|$)/i;
const SKIP_PATH_HINTS = ["/login", "/signin", "/cart", "/privacy", "/terms", "/cookie"];

function keywordScore(haystack: string, keywords: string[]): number {
  let score = 0;
  for (const kw of keywords) {
    if (haystack.includes(kw)) score += 1;
  }
  return score;
}

/**
 * Section 2: "Finding the hiring page is the interesting half of this ...
 * the path cannot be hard-coded ... Crawl the site, rank the links, fetch
 * what looks right." This is the ranking function: it scores a link on
 * how likely it is to be a hiring page or an about/company page, from its
 * URL path and anchor text alone (before it's ever fetched).
 */
export function scoreLink(link: RankableLink, origin: string): { hiring: number; about: number } {
  let href: URL;
  try {
    href = new URL(link.href);
  } catch {
    return { hiring: 0, about: 0 };
  }

  if (href.origin !== origin) return { hiring: 0, about: 0 };
  if (SKIP_EXTENSIONS.test(href.pathname)) return { hiring: 0, about: 0 };
  if (SKIP_PATH_HINTS.some((h) => href.pathname.toLowerCase().includes(h))) {
    return { hiring: 0, about: 0 };
  }

  const haystack = `${href.pathname} ${link.text}`.toLowerCase();
  const segments = href.pathname.split("/").filter(Boolean);
  // Shallow paths are more likely to be primary nav items than deep,
  // paginated, or article-style URLs.
  const depthBonus = Math.max(0, 2 - segments.length) * 0.25;

  return {
    hiring: keywordScore(haystack, HIRING_KEYWORDS) + depthBonus,
    about: keywordScore(haystack, ABOUT_KEYWORDS) + depthBonus,
  };
}
