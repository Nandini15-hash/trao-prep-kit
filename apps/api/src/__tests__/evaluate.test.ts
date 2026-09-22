import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { promises as fs } from "fs";
import os from "os";
import path from "path";
import { BatchOutputSchema, Kit } from "@trao/shared";

/**
 * Section 9's mandatory batch entry point. generateKit() itself is
 * mocked here (its own behavior is covered by pipeline.test.ts and
 * pipeline-structure.test.ts) — these tests are about evaluate.ts's own
 * job: reading Appendix B input, running every case through the exact
 * same generateKit() the app uses, continuing after a per-case failure
 * instead of aborting the run, and writing Appendix-B-shaped output.
 */

const { generateKitMock } = vi.hoisted(() => ({ generateKitMock: vi.fn() }));
vi.mock("../services/generation/pipeline", () => ({ generateKit: generateKitMock }));

import { main, parseArgs, runCase } from "../scripts/evaluate";

function validKit(overrides: Partial<Kit> = {}): Kit {
  return {
    source: {
      company: "Acme",
      company_url: "https://acme.example/",
      role: "Backend Engineer",
      location: "Remote",
      jd_chars: 100,
      researched_at: new Date().toISOString(),
      pages_used: [],
    },
    company_brief: { summary: "Acme builds things.", what_they_do: "APIs.", sources: [] },
    role: {
      title: "Backend Engineer",
      seniority: "Mid-level",
      responsibilities: [],
      requirements: [{ id: "r1", text: "React experience", kind: "technical", priority: "must" }],
    },
    questions: [
      {
        id: "q1",
        requirement_ids: ["r1"],
        category: "technical",
        prompt: "Tell me about React",
        answer_outline: "outline",
        difficulty: 2,
      },
    ],
    flashcards: [{ id: "f1", front: "front", back: "back", requirement_ids: ["r1"] }],
    schedule: { days_available: 1, days: [{ day: 1, focus: "React", question_ids: ["q1"], minutes: 30 }] },
    coverage: { uncovered_requirement_ids: [], passes: 1 },
    ...overrides,
  };
}

let tmpDir: string;

beforeEach(async () => {
  vi.clearAllMocks();
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "evaluate-test-"));
});

afterEach(async () => {
  await fs.rm(tmpDir, { recursive: true, force: true });
});

describe("parseArgs", () => {
  it("accepts --flag value form", () => {
    expect(parseArgs(["--input", "a.json", "--output", "b.json"])).toEqual({ input: "a.json", output: "b.json" });
  });

  it("accepts --flag=value form", () => {
    expect(parseArgs(["--input=a.json", "--output=b.json"])).toEqual({ input: "a.json", output: "b.json" });
  });

  it("exits with a usage message when a required flag is missing", () => {
    const exitSpy = vi.spyOn(process, "exit").mockImplementation(() => {
      throw new Error("EXIT");
    });
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(() => parseArgs(["--input", "a.json"])).toThrow("EXIT");
    expect(exitSpy).toHaveBeenCalledWith(1);
    exitSpy.mockRestore();
    errSpy.mockRestore();
  });
});

describe("runCase", () => {
  it("returns an 'ok' result with the generated kit on success", async () => {
    const kit = validKit();
    generateKitMock.mockResolvedValue(kit);
    const result = await runCase({ id: "case-01", jd: "jd", company_url: "https://acme.example/", days: 5 });
    expect(result).toEqual({ id: "case-01", status: "ok", kit, error: null });
  });

  it("returns a 'failed' result — never throws — when generateKit rejects", async () => {
    generateKitMock.mockRejectedValue(Object.assign(new Error("extraction blew up"), { code: "LLM_ERROR" }));
    const result = await runCase({ id: "case-02", jd: "jd", company_url: "https://acme.example/", days: 5 });
    expect(result.status).toBe("failed");
    expect(result.kit).toBeNull();
    expect(result.error).toEqual({ code: "LLM_ERROR", message: "extraction blew up" });
  });

  it("fails the case rather than hanging when generateKit never resolves, respecting the per-case timeout", async () => {
    vi.useFakeTimers();
    generateKitMock.mockReturnValue(new Promise(() => {})); // never resolves
    const pending = runCase({ id: "case-03", jd: "jd", company_url: "https://acme.example/", days: 5 });
    await vi.advanceTimersByTimeAsync(5 * 60_000); // past the 4-minute per-case timeout
    const result = await pending;
    expect(result.status).toBe("failed");
    expect(result.error?.code).toBe("TIMEOUT");
    vi.useRealTimers();
  }, 15_000);

  it("fails the case if generateKit somehow produces a structurally invalid kit", async () => {
    const broken = validKit();
    // Deliberately invalid: references a requirement that doesn't exist.
    broken.questions[0].requirement_ids = ["no-such-requirement"];
    generateKitMock.mockResolvedValue(broken);
    const result = await runCase({ id: "case-04", jd: "jd", company_url: "https://acme.example/", days: 5 });
    expect(result.status).toBe("failed");
    expect(result.error?.message).toMatch(/structural/i);
  });
});

describe("main — end to end against real files", () => {
  it("reads cases.json, runs every case, continues after a failure, and writes Appendix-B-shaped output", async () => {
    const casesPath = path.join(tmpDir, "cases.json");
    const outputPath = path.join(tmpDir, "kits.json");
    await fs.writeFile(
      casesPath,
      JSON.stringify([
        { id: "case-01", jd: "Senior Backend Engineer JD", company_url: "http://localhost:8099/acme/", days: 5 },
        { id: "case-02", jd: "Broken one", company_url: "http://localhost:8099/broken/", days: 3 },
      ])
    );

    generateKitMock.mockImplementation(async ({ jd }: { jd: string }) => {
      if (jd === "Broken one") throw new Error("could not extract requirements");
      return validKit();
    });

    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    await main(["--input", casesPath, "--output", outputPath]);
    errSpy.mockRestore();

    const written = JSON.parse(await fs.readFile(outputPath, "utf-8"));
    const parsed = BatchOutputSchema.safeParse(written);
    expect(parsed.success).toBe(true);

    expect(written.kits).toHaveLength(2);
    const ok = written.kits.find((k: any) => k.id === "case-01");
    const failed = written.kits.find((k: any) => k.id === "case-02");
    expect(ok.status).toBe("ok");
    expect(ok.kit).not.toBeNull();
    expect(failed.status).toBe("failed");
    expect(failed.kit).toBeNull();
    expect(failed.error.message).toMatch(/could not extract requirements/);
  });

  it("exits 1 with a clear message when the input file doesn't exist", async () => {
    const exitSpy = vi.spyOn(process, "exit").mockImplementation(() => {
      throw new Error("EXIT");
    });
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    await expect(main(["--input", path.join(tmpDir, "nope.json"), "--output", path.join(tmpDir, "out.json")])).rejects.toThrow(
      "EXIT"
    );
    expect(exitSpy).toHaveBeenCalledWith(1);
    exitSpy.mockRestore();
    errSpy.mockRestore();
  });

  it("exits 1 with a clear message when the input file doesn't match Appendix B's case shape", async () => {
    const casesPath = path.join(tmpDir, "bad-cases.json");
    await fs.writeFile(casesPath, JSON.stringify([{ id: "case-01", jd: "x" /* missing company_url, days */ }]));
    const exitSpy = vi.spyOn(process, "exit").mockImplementation(() => {
      throw new Error("EXIT");
    });
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    await expect(main(["--input", casesPath, "--output", path.join(tmpDir, "out.json")])).rejects.toThrow("EXIT");
    expect(exitSpy).toHaveBeenCalledWith(1);
    exitSpy.mockRestore();
    errSpy.mockRestore();
  });
});
