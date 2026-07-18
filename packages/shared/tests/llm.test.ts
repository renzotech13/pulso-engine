import { beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";

const mockCreate = vi.fn();

vi.mock("openai", () => ({
  default: vi.fn().mockImplementation(() => ({
    chat: { completions: { create: mockCreate } },
  })),
}));

import { callLlmStructured, LlmOutputError } from "../src/llm.js";
import { resetConfigCacheForTests } from "../src/config.js";

function chatResponse(content: string) {
  return { choices: [{ message: { content } }] };
}

beforeEach(() => {
  mockCreate.mockReset();
  resetConfigCacheForTests();
  process.env.SUPABASE_URL = "http://localhost:54321";
  process.env.SUPABASE_ANON_KEY = "test-anon-key";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "test-service-role-key";
  process.env.REDIS_URL = "redis://localhost:6379";
  process.env.LMSTUDIO_MODEL = "test-model";
});

const schema = z.object({ ok: z.boolean() });

describe("callLlmStructured", () => {
  it("returns validated data when the model replies with clean JSON", async () => {
    mockCreate.mockResolvedValueOnce(chatResponse('{"ok": true}'));

    const result = await callLlmStructured("test prompt", schema);

    expect(result).toEqual({ ok: true });
    expect(mockCreate).toHaveBeenCalledTimes(1);
  });

  it("strips markdown fences and surrounding prose before parsing", async () => {
    mockCreate.mockResolvedValueOnce(
      chatResponse('Claro, aquí tienes:\n```json\n{"ok": true}\n```'),
    );

    const result = await callLlmStructured("test prompt", schema);

    expect(result).toEqual({ ok: true });
  });

  it("retries once with the validation error fed back, then succeeds", async () => {
    mockCreate.mockResolvedValueOnce(chatResponse('{"ok": "not-a-boolean"}'));
    mockCreate.mockResolvedValueOnce(chatResponse('{"ok": true}'));

    const result = await callLlmStructured("test prompt", schema);

    expect(result).toEqual({ ok: true });
    expect(mockCreate).toHaveBeenCalledTimes(2);

    const secondCallArgs = mockCreate.mock.calls[1]?.[0] as { messages: { content: string }[] };
    expect(secondCallArgs.messages[0]?.content).toContain("no calzó con el formato esperado");
  });

  it("throws LlmOutputError after exhausting retries on persistently invalid output", async () => {
    mockCreate.mockResolvedValue(chatResponse("not json at all"));

    await expect(callLlmStructured("test prompt", schema, { maxRetries: 1 })).rejects.toThrow(
      LlmOutputError,
    );
    expect(mockCreate).toHaveBeenCalledTimes(2);
  });
});
