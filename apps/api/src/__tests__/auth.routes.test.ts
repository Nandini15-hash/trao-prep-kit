import { describe, expect, it, vi, beforeEach } from "vitest";
import request from "supertest";
import { createApp } from "../app";

/**
 * These exercise the auth routes' request/response contract (status codes,
 * cookie handling, no leaking which credential was wrong) against a mocked
 * User model, rather than a real MongoDB — this sandbox's network policy
 * blocks the mongodb-memory-server binary download, and a route-contract
 * test doesn't need a real database to be meaningful. A real MongoDB
 * (Atlas free tier, or mongodb-memory-server where outbound access to
 * fastdl.mongodb.org is allowed) exercises the same code path end to end;
 * see README for how to run that locally.
 */

// vi.mock factories are hoisted above the rest of the file, so any state
// they close over has to be created through vi.hoisted() rather than an
// ordinary top-level const — otherwise it's referenced before its own
// initializer has run.
const { users, resetUsers } = vi.hoisted(() => {
  const store = new Map<string, { _id: string; email: string; passwordHash: string }>();
  return { users: store, resetUsers: () => store.clear() };
});

// Real Mongoose supports `await User.findById(id).select(...)` — a query
// object that's itself awaitable/chainable. The mock mirrors just that
// shape rather than pulling in Mongoose's query machinery.
vi.mock("../models/User", () => {
  let nextId = 1;
  return {
    User: {
      findOne: vi.fn(async ({ email }: { email: string }) => {
        const found = [...users.values()].find((u) => u.email === email);
        return found ? { ...found, _id: { toString: () => found._id } } : null;
      }),
      create: vi.fn(async ({ email, passwordHash }: { email: string; passwordHash: string }) => {
        const id = String(nextId++);
        const doc = { _id: id, email, passwordHash };
        users.set(id, doc);
        return { ...doc, _id: { toString: () => id } };
      }),
      findById: vi.fn((id: string) => ({
        select: async () => {
          const found = users.get(String(id));
          return found ? { _id: found._id, email: found.email } : null;
        },
      })),
    },
  };
});

beforeEach(() => {
  resetUsers();
});

describe("auth routes", () => {
  const app = createApp();

  it("registers, sets a session cookie, and exposes the user via /auth/me", async () => {
    const agent = request.agent(app);

    const register = await agent
      .post("/auth/register")
      .send({ email: "nandini@example.com", password: "correct-horse" });
    expect(register.status).toBe(201);
    expect(register.headers["set-cookie"]).toBeDefined();

    const me = await agent.get("/auth/me");
    expect(me.status).toBe(200);
    expect(me.body.user.email).toBe("nandini@example.com");
  });

  it("rejects duplicate registration", async () => {
    const agent = request.agent(app);
    await agent.post("/auth/register").send({ email: "dup@example.com", password: "correct-horse" });
    const second = await agent
      .post("/auth/register")
      .send({ email: "dup@example.com", password: "another-pass" });
    expect(second.status).toBe(409);
  });

  it("rejects login with the wrong password, without revealing which field was wrong", async () => {
    const agent = request.agent(app);
    await agent.post("/auth/register").send({ email: "wrongpw@example.com", password: "correct-horse" });

    const badLogin = await request(app)
      .post("/auth/login")
      .send({ email: "wrongpw@example.com", password: "nope1234" });
    expect(badLogin.status).toBe(401);

    const unknownUser = await request(app)
      .post("/auth/login")
      .send({ email: "nobody@example.com", password: "whatever1" });
    expect(unknownUser.status).toBe(401);
    expect(unknownUser.body.error.code).toBe(badLogin.body.error.code);
  });

  it("blocks protected routes for a signed-out visitor", async () => {
    const res = await request(app).get("/auth/me");
    expect(res.status).toBe(401);
  });

  it("blocks protected routes after logout", async () => {
    const agent = request.agent(app);
    await agent.post("/auth/register").send({ email: "logout@example.com", password: "correct-horse" });
    await agent.post("/auth/logout");
    const me = await agent.get("/auth/me");
    expect(me.status).toBe(401);
  });
});
