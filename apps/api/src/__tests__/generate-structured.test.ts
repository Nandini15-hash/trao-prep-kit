import { describe, expect, it, vi, beforeEach } from "vitest";
import { z } from "zod";
import { generateStructured } from "../services/llm/generate-structured";
import { LlmError } from "../services/llm/errors";

const { callGeminiMock } = vi.hoisted(() => ({ callGeminiMock: vi.fn() }));
vi.mock("../services/llm/gemini-client", () => ({
  callGemini: (...args: unknown[]) => callGeminiMock(...args),
}));

const Schema = z.object({ name: z.string(), age: z.number().int() });

beforeEach(() => {
  callGeminiMock.mockReset();
});

describe("generateStructured", () => {
  it("returns parsed + validated data on the first valid response", async () => {
    callGeminiMock.mockResolvedValueOnce('{"name":"Ada","age":30}');
    const result = await generateStructured({
      schema: Schema,
      systemInstruction: "sys",
      prompt: "prompt",
    });
    expect(result).toEqual({ name: "Ada", age: 30 });
    expect(callGeminiMock).toHaveBeenCalledTimes(1);
  });

  it("strips a markdown code fence before parsing", async () => {
    callGeminiMock.mockResolvedValueOnce('```json\n{"name":"Ada","age":30}\n```');
    const result = await generateStructured({ schema: Schema, systemInstruction: "sys", prompt: "p" });
    expect(result).toEqual({ name: "Ada", age: 30 });
  });

  it("retries once on invalid JSON, then succeeds", async () => {
    callGeminiMock
      .mockResolvedValueOnce("not json at all")
      .mockResolvedValueOnce('{"name":"Ada","age":30}');
    const result = await generateStructured({ schema: Schema, systemInstruction: "sys", prompt: "p" });
    expect(result).toEqual({ name: "Ada", age: 30 });
    expect(callGeminiMock).toHaveBeenCalledTimes(2);
    // The repair prompt should reference why the previous attempt failed.
    expect(callGeminiMock.mock.calls[1][0]).toMatch(/not valid JSON/);
  });

  it("retries on schema-valid-but-wrong-shape JSON, then succeeds", async () => {
    callGeminiMock
      .mockResolvedValueOnce('{"name":"Ada","age":"thirty"}') // age is a string, invalid
      .mockResolvedValueOnce('{"name":"Ada","age":30}');
    const result = await generateStructured({ schema: Schema, systemInstruction: "sys", prompt: "p" });
    expect(result).toEqual({ name: "Ada", age: 30 });
    expect(callGeminiMock.mock.calls[1][0]).toMatch(/age/);
  });

  it("gives up with a clear LlmError after exhausting repair attempts", async () => {
    callGeminiMock.mockResolvedValue("still not json");
    await expect(
      generateStructured({ schema: Schema, systemInstruction: "sys", prompt: "p" })
    ).rejects.toThrow(LlmError);
    // 1 initial + MAX_REPAIR_ATTEMPTS(2) = 3 total calls
    expect(callGeminiMock).toHaveBeenCalledTimes(3);
  });
});
