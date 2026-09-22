import { afterAll, beforeAll, describe, expect, it } from "vitest";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { crawlCompanySite } from "../services/retrieval/crawler";

/**
 * Serves a tiny fixture "company site" over a real local HTTP server —
 * this mirrors exactly how the brief's own batch harness works (Appendix
 * B: "company_url": "http://localhost:8099/acme/"), so it's also a live
 * check that the retrieval code makes no host assumptions and follows
 * relative links, per Section 9's "must not assume a particular host".
 *
 * The hiring page sits at a deliberately unpredictable path
 * (/acme/handbook/careers) rather than the obvious /careers — the point
 * is to prove the crawler finds it by ranking links, not by guessing a
 * fixed path list (Section 2).
 */
const PAGES: Record<string, string> = {
  "/robots.txt": "User-agent: *\nDisallow: /acme/internal\n",
  "/acme/": `<html><head><title>Acme Corp</title></head><body>
    <nav>
      <a href="/acme/about">About</a>
      <a href="/acme/handbook/careers">Careers</a>
      <a href="/acme/internal/careers-portal">Internal Careers Portal (disallowed)</a>
      <a href="/acme/careers/broken-link">Careers (broken link)</a>
      <a href="/acme/blog">Blog</a>
    </nav>
    <p>Acme Corp builds developer tools for distributed teams.</p>
  </body></html>`,
  "/acme/about": `<html><head><title>About Acme</title></head><body>
    <p>Acme was founded in 2019. We build developer tools for distributed teams.</p>
  </body></html>`,
  "/acme/handbook/careers": `<html><head><title>Careers at Acme</title></head><body>
    <p>We hire in three stages: a take-home, a system design call, and a values chat.</p>
  </body></html>`,
  "/acme/blog": `<html><head><title>Acme Blog</title></head><body>
    <p>Engineering notes and release updates.</p>
  </body></html>`,
  "/acme/internal/careers-portal": `<html><head><title>Internal only</title></head><body>
    <p>This should never be fetched — robots.txt disallows it.</p>
  </body></html>`,
};

let server: http.Server;
let baseUrl: string;

beforeAll(async () => {
  server = http.createServer((req, res) => {
    const path = (req.url ?? "/").split("?")[0];
    const body = PAGES[path];
    if (!body) {
      res.writeHead(404, { "Content-Type": "text/plain" });
      res.end("not found");
      return;
    }
    res.writeHead(200, { "Content-Type": path.endsWith(".txt") ? "text/plain" : "text/html" });
    res.end(body);
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;
  baseUrl = `http://127.0.0.1:${port}`;
});

afterAll(() => {
  server.close();
});

describe("crawlCompanySite", () => {
  it("finds the hiring page and about page without a hard-coded path, and skips what robots.txt disallows", async () => {
    const result = await crawlCompanySite(`${baseUrl}/acme/`);

    const fetchedUrls = result.pages.map((p) => p.url);
    expect(fetchedUrls).toContain(`${baseUrl}/acme/`);
    expect(fetchedUrls).toContain(`${baseUrl}/acme/handbook/careers`);
    expect(fetchedUrls).not.toContain(`${baseUrl}/acme/internal/careers-portal`);

    expect(result.hiringPage?.url).toBe(`${baseUrl}/acme/handbook/careers`);
    expect(result.hiringPage?.text).toMatch(/take-home/);

    expect(result.aboutPage).not.toBeNull();

    expect(result.skipped.some((s) => s.url.includes("/acme/internal") && /robots/.test(s.reason))).toBe(
      true
    );
    expect(result.failed.some((f) => f.url.includes("/acme/careers/broken-link"))).toBe(true);
  });

  it("reports honestly when a site has no discoverable hiring page", async () => {
    const result = await crawlCompanySite(`${baseUrl}/acme/blog`);
    // The blog page alone has no links worth following, so nothing scores
    // as a hiring page — the crawler must not invent one.
    expect(result.hiringPage).toBeNull();
  });
});
