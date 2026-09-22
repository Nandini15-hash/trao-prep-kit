import { describe, expect, it } from "vitest";
import request from "supertest";
import { createApp } from "../app";

describe("GET /health", () => {
  it("returns ok without needing a database connection", async () => {
    const app = createApp();
    const res = await request(app).get("/health");
    expect(res.status).toBe(200);
    expect(res.body.status).toBe("ok");
  });
});
