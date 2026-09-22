import { describe, expect, it, vi, beforeEach } from "vitest";
import request from "supertest";
import jwt from "jsonwebtoken";
import { createApp } from "../app";
import { env } from "../lib/env";
import { SESSION_COOKIE } from "../services/auth.service";

/**
 * Exercises kit.routes.ts's request/response contract — status codes,
 * body validation, and that every route requires auth and hands off to
 * the right kit.service.ts function with the right arguments — against a
 * mocked kit.service.ts. The service's own logic (ownership, status
 * gating, persistence) is covered by kit.service.test.ts; this file is
 * about the HTTP boundary on top of it.
 */

const serviceMocks = vi.hoisted(() => ({
  createKit: vi.fn(),
  listKits: vi.fn(),
  getKit: vi.fn(),
  deleteKit: vi.fn(),
  updateCompanyBrief: vi.fn(),
  regenerateCompanyBrief: vi.fn(),
  updateQuestion: vi.fn(),
  addQuestion: vi.fn(),
  deleteQuestion: vi.fn(),
  moveQuestion: vi.fn(),
  reorderQuestions: vi.fn(),
  regenerateQuestions: vi.fn(),
  updateFlashcard: vi.fn(),
  addFlashcard: vi.fn(),
  deleteFlashcard: vi.fn(),
  regenerateSchedule: vi.fn(),
  getPracticeSession: vi.fn(),
  recordFlashcardReview: vi.fn(),
}));
vi.mock("../services/kit.service", () => serviceMocks);

function fakeDoc(overrides: Record<string, any> = {}) {
  return {
    _id: "5f0000000000000000000099",
    status: "ready",
    input: { jd: "jd", companyUrl: "https://acme.example/", days: 5 },
    data: { source: { company: "Acme" } },
    error: null,
    progress: [],
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

/** A valid session cookie without going through /auth/register — these
 *  tests are about kit.routes.ts, not auth, so the session is minted
 *  directly with the same secret auth.service.ts signs with. */
function sessionCookie(userId = "5f0000000000000000000001") {
  const token = jwt.sign({ sub: userId }, env.JWT_SECRET, { expiresIn: env.SESSION_TTL_SECONDS });
  return `${SESSION_COOKIE}=${token}`;
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("auth is required", () => {
  const app = createApp();

  it("blocks every kit route for a signed-out visitor", async () => {
    const get = await request(app).get("/kits");
    expect(get.status).toBe(401);
    const post = await request(app).post("/kits").send({ jd: "x", companyUrl: "https://a.example", days: 3 });
    expect(post.status).toBe(401);
    expect(serviceMocks.createKit).not.toHaveBeenCalled();
  });
});

describe("POST /kits", () => {
  const app = createApp();

  it("validates the body and 202s with the created (pending) doc", async () => {
    serviceMocks.createKit.mockResolvedValue(fakeDoc({ status: "pending", data: null }));
    const res = await request(app)
      .post("/kits")
      .set("Cookie", sessionCookie())
      .send({ jd: "Some JD text", companyUrl: "https://acme.example/", days: 5 });

    expect(res.status).toBe(202);
    expect(res.body.status).toBe("pending");
    expect(serviceMocks.createKit).toHaveBeenCalledWith(
      "5f0000000000000000000001",
      expect.objectContaining({ jd: "Some JD text", companyUrl: "https://acme.example/", days: 5 })
    );
  });

  it("rejects an empty job description with 400, without calling the service", async () => {
    const res = await request(app)
      .post("/kits")
      .set("Cookie", sessionCookie())
      .send({ jd: "", companyUrl: "https://acme.example/", days: 5 });
    expect(res.status).toBe(400);
    expect(serviceMocks.createKit).not.toHaveBeenCalled();
  });

  it("rejects a non-integer days value with 400", async () => {
    const res = await request(app)
      .post("/kits")
      .set("Cookie", sessionCookie())
      .send({ jd: "JD", companyUrl: "https://acme.example/", days: 2.5 });
    expect(res.status).toBe(400);
  });
});

describe("GET /kits and /kits/:id", () => {
  const app = createApp();

  it("lists the caller's kits", async () => {
    serviceMocks.listKits.mockResolvedValue([fakeDoc(), fakeDoc({ _id: "b" })]);
    const res = await request(app).get("/kits").set("Cookie", sessionCookie());
    expect(res.status).toBe(200);
    expect(res.body.kits).toHaveLength(2);
  });

  it("returns a single kit by id", async () => {
    serviceMocks.getKit.mockResolvedValue(fakeDoc());
    const res = await request(app).get("/kits/5f0000000000000000000099").set("Cookie", sessionCookie());
    expect(res.status).toBe(200);
    expect(res.body.data.source.company).toBe("Acme");
  });

  it("propagates a 404 from the service as a 404 response", async () => {
    const { HttpError } = await import("../lib/http-error");
    serviceMocks.getKit.mockRejectedValue(HttpError.notFound("No such kit", "KIT_NOT_FOUND"));
    const res = await request(app).get("/kits/doesnotexist").set("Cookie", sessionCookie());
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe("KIT_NOT_FOUND");
  });
});

describe("DELETE /kits/:id", () => {
  const app = createApp();

  it("204s on successful delete", async () => {
    serviceMocks.deleteKit.mockResolvedValue(undefined);
    const res = await request(app).delete("/kits/5f0000000000000000000099").set("Cookie", sessionCookie());
    expect(res.status).toBe(204);
  });
});

describe("company brief routes", () => {
  const app = createApp();

  it("PATCH requires at least one field", async () => {
    const res = await request(app)
      .patch("/kits/5f0000000000000000000099/company-brief")
      .set("Cookie", sessionCookie())
      .send({});
    expect(res.status).toBe(400);
    expect(serviceMocks.updateCompanyBrief).not.toHaveBeenCalled();
  });

  it("PATCH forwards a valid patch", async () => {
    serviceMocks.updateCompanyBrief.mockResolvedValue(fakeDoc());
    const res = await request(app)
      .patch("/kits/5f0000000000000000000099/company-brief")
      .set("Cookie", sessionCookie())
      .send({ summary: "New summary" });
    expect(res.status).toBe(200);
    expect(serviceMocks.updateCompanyBrief).toHaveBeenCalledWith(
      "5f0000000000000000000001",
      "5f0000000000000000000099",
      { summary: "New summary" }
    );
  });

  it("POST /regenerate calls the service with no body", async () => {
    serviceMocks.regenerateCompanyBrief.mockResolvedValue(fakeDoc());
    const res = await request(app)
      .post("/kits/5f0000000000000000000099/company-brief/regenerate")
      .set("Cookie", sessionCookie());
    expect(res.status).toBe(200);
    expect(serviceMocks.regenerateCompanyBrief).toHaveBeenCalledWith(
      "5f0000000000000000000001",
      "5f0000000000000000000099"
    );
  });
});

describe("question routes", () => {
  const app = createApp();
  const id = "5f0000000000000000000099";

  it("rejects an out-of-range difficulty", async () => {
    const res = await request(app)
      .post(`/kits/${id}/questions`)
      .set("Cookie", sessionCookie())
      .send({ category: "technical", prompt: "p", answer_outline: "o", difficulty: 9 });
    expect(res.status).toBe(400);
  });

  it("rejects an unknown category", async () => {
    const res = await request(app)
      .post(`/kits/${id}/questions`)
      .set("Cookie", sessionCookie())
      .send({ category: "not-a-real-category", prompt: "p", answer_outline: "o", difficulty: 1 });
    expect(res.status).toBe(400);
  });

  it("adds a question and 201s", async () => {
    serviceMocks.addQuestion.mockResolvedValue(fakeDoc());
    const res = await request(app)
      .post(`/kits/${id}/questions`)
      .set("Cookie", sessionCookie())
      .send({ category: "technical", prompt: "p", answer_outline: "o", difficulty: 2 });
    expect(res.status).toBe(201);
  });

  it("regenerate forwards the category to the service", async () => {
    serviceMocks.regenerateQuestions.mockResolvedValue(fakeDoc());
    const res = await request(app)
      .post(`/kits/${id}/questions/regenerate`)
      .set("Cookie", sessionCookie())
      .send({ category: "company-fit" });
    expect(res.status).toBe(200);
    expect(serviceMocks.regenerateQuestions).toHaveBeenCalledWith("5f0000000000000000000001", id, "company-fit");
  });

  it("move validates the target category", async () => {
    const res = await request(app)
      .post(`/kits/${id}/questions/q1/move`)
      .set("Cookie", sessionCookie())
      .send({ category: "nonsense" });
    expect(res.status).toBe(400);
  });

  it("reorder forwards category + orderedIds", async () => {
    serviceMocks.reorderQuestions.mockResolvedValue(fakeDoc());
    const res = await request(app)
      .post(`/kits/${id}/questions/reorder`)
      .set("Cookie", sessionCookie())
      .send({ category: "technical", orderedIds: ["q2", "q1"] });
    expect(res.status).toBe(200);
    expect(serviceMocks.reorderQuestions).toHaveBeenCalledWith("5f0000000000000000000001", id, "technical", [
      "q2",
      "q1",
    ]);
  });
});

describe("flashcard routes", () => {
  const app = createApp();
  const id = "5f0000000000000000000099";

  it("adds a flashcard and 201s", async () => {
    serviceMocks.addFlashcard.mockResolvedValue(fakeDoc());
    const res = await request(app)
      .post(`/kits/${id}/flashcards`)
      .set("Cookie", sessionCookie())
      .send({ front: "Q", back: "A" });
    expect(res.status).toBe(201);
  });

  it("rejects an empty flashcard patch", async () => {
    const res = await request(app)
      .patch(`/kits/${id}/flashcards/f1`)
      .set("Cookie", sessionCookie())
      .send({});
    expect(res.status).toBe(400);
  });

  it("deletes a flashcard", async () => {
    serviceMocks.deleteFlashcard.mockResolvedValue(fakeDoc());
    const res = await request(app).delete(`/kits/${id}/flashcards/f1`).set("Cookie", sessionCookie());
    expect(res.status).toBe(200);
    expect(serviceMocks.deleteFlashcard).toHaveBeenCalledWith("5f0000000000000000000001", id, "f1");
  });
});

describe("schedule regenerate", () => {
  const app = createApp();
  const id = "5f0000000000000000000099";

  it("works with no body at all (days_available unchanged)", async () => {
    serviceMocks.regenerateSchedule.mockResolvedValue(fakeDoc());
    const res = await request(app).post(`/kits/${id}/schedule/regenerate`).set("Cookie", sessionCookie());
    expect(res.status).toBe(200);
    expect(serviceMocks.regenerateSchedule).toHaveBeenCalledWith("5f0000000000000000000001", id, undefined);
  });

  it("forwards an explicit daysAvailable", async () => {
    serviceMocks.regenerateSchedule.mockResolvedValue(fakeDoc());
    const res = await request(app)
      .post(`/kits/${id}/schedule/regenerate`)
      .set("Cookie", sessionCookie())
      .send({ daysAvailable: 10 });
    expect(res.status).toBe(200);
    expect(serviceMocks.regenerateSchedule).toHaveBeenCalledWith("5f0000000000000000000001", id, 10);
  });
});

describe("practice routes", () => {
  const app = createApp();
  const id = "5f0000000000000000000099";

  it("GET returns the ordered session", async () => {
    serviceMocks.getPracticeSession.mockResolvedValue({ flashcards: [], coverage: { total: 0, reviewed: 0 } });
    const res = await request(app).get(`/kits/${id}/practice`).set("Cookie", sessionCookie());
    expect(res.status).toBe(200);
    expect(res.body.coverage).toEqual({ total: 0, reviewed: 0 });
  });

  it("POST review validates confidence is 1-5", async () => {
    const res = await request(app)
      .post(`/kits/${id}/practice/review`)
      .set("Cookie", sessionCookie())
      .send({ flashcardId: "f1", confidence: 7 });
    expect(res.status).toBe(400);
  });

  it("POST review forwards a valid review", async () => {
    serviceMocks.recordFlashcardReview.mockResolvedValue(fakeDoc());
    const res = await request(app)
      .post(`/kits/${id}/practice/review`)
      .set("Cookie", sessionCookie())
      .send({ flashcardId: "f1", confidence: 4 });
    expect(res.status).toBe(200);
    expect(serviceMocks.recordFlashcardReview).toHaveBeenCalledWith("5f0000000000000000000001", id, "f1", 4);
  });
});
