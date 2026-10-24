import { describe, expect, it } from "vitest";
import { createGeminiModel } from "../lib/agent/gemini";
import { RateLimitError, type Message, type ToolDef } from "../lib/agent/model";

type Req = { url: string; headers: Record<string, string>; body: any };

function fakeFetch(responses: { status: number; body: unknown }[]) {
  const requests: Req[] = [];
  const fn = async (url: string, init: any) => {
    requests.push({ url, headers: init.headers, body: JSON.parse(init.body) });
    const r = responses.shift()!;
    return new Response(JSON.stringify(r.body), { status: r.status, headers: { "content-type": "application/json" } });
  };
  return { fn: fn as unknown as typeof fetch, requests };
}

const tools: ToolDef[] = [{ name: "fetch", description: "Read a page", parameters: { type: "object", properties: { url: { type: "string" } }, required: ["url"] } }];
const ok = (parts: unknown[], usage = { promptTokenCount: 10, candidatesTokenCount: 5, thoughtsTokenCount: 3 }) => ({
  status: 200,
  body: { candidates: [{ content: { role: "model", parts }, finishReason: "STOP" }], usageMetadata: usage },
});

describe("createGeminiModel", () => {
  it("sends system prompt, tools and the key header, and parses function calls", async () => {
    const f = fakeFetch([ok([{ functionCall: { id: "c1", name: "fetch", args: { url: "https://x.dev" } }, thoughtSignature: "sig" }])]);
    const model = createGeminiModel({ apiKey: "k", model: "gemini-test", fetch: f.fn });
    const turn = await model.complete("SYSTEM", [{ role: "user", content: "go" }], tools);

    expect(f.requests[0].url).toBe("https://generativelanguage.googleapis.com/v1beta/models/gemini-test:generateContent");
    expect(f.requests[0].headers["x-goog-api-key"]).toBe("k");
    expect(f.requests[0].body.systemInstruction).toEqual({ parts: [{ text: "SYSTEM" }] });
    expect(f.requests[0].body.tools[0].functionDeclarations[0]).toMatchObject({ name: "fetch", parametersJsonSchema: { required: ["url"] } });
    expect(turn.toolCalls).toEqual([{ id: "c1", name: "fetch", args: { url: "https://x.dev" } }]);
    expect(turn.usage).toEqual({ inputTokens: 10, outputTokens: 8 });
    expect(turn.raw).toEqual([{ functionCall: { id: "c1", name: "fetch", args: { url: "https://x.dev" } }, thoughtSignature: "sig" }]);
  });

  it("replays model parts unchanged and groups tool results into one user turn", async () => {
    const f = fakeFetch([ok([{ text: "done" }])]);
    const model = createGeminiModel({ apiKey: "k", model: "m", fetch: f.fn });
    const raw = [{ functionCall: { id: "a", name: "fetch", args: {} }, thoughtSignature: "s1" }, { functionCall: { id: "b", name: "fetch", args: {} } }];
    const history: Message[] = [
      { role: "user", content: "go" },
      { role: "assistant", content: "", toolCalls: [{ id: "a", name: "fetch", args: {} }, { id: "b", name: "fetch", args: {} }], raw },
      { role: "tool", toolCallId: "a", name: "fetch", content: "page A" },
      { role: "tool", toolCallId: "b", name: "fetch", content: "page B" },
    ];
    const turn = await model.complete("S", history, tools);
    const contents = f.requests[0].body.contents;
    expect(contents[1]).toEqual({ role: "model", parts: raw });
    expect(contents[2]).toEqual({
      role: "user",
      parts: [
        { functionResponse: { id: "a", name: "fetch", response: { result: "page A" } } },
        { functionResponse: { id: "b", name: "fetch", response: { result: "page B" } } },
      ],
    });
    expect(turn.text).toBe("done");
    expect(turn.toolCalls).toEqual([]);
  });

  it("rebuilds parts when there's no raw reply, and skips thought text", async () => {
    const f = fakeFetch([ok([{ text: "thinking…", thought: true }, { text: "answer" }])]);
    const model = createGeminiModel({ apiKey: "k", model: "m", fetch: f.fn });
    const turn = await model.complete("S", [{ role: "user", content: "go" }, { role: "assistant", content: "hi", toolCalls: [] }, { role: "user", content: "more" }], tools);
    expect(f.requests[0].body.contents[1]).toEqual({ role: "model", parts: [{ text: "hi" }] });
    expect(turn.text).toBe("answer");
  });

  it("gives calls without an id a stable generated one", async () => {
    const f = fakeFetch([ok([{ functionCall: { name: "fetch", args: {} } }])]);
    const turn = await createGeminiModel({ apiKey: "k", model: "m", fetch: f.fn }).complete("S", [{ role: "user", content: "go" }], tools);
    expect(turn.toolCalls[0].id).toMatch(/^call-/);
  });

  it("turns 429 and 503 into RateLimitError with the suggested delay", async () => {
    const f = fakeFetch([
      { status: 429, body: { error: { code: 429, status: "RESOURCE_EXHAUSTED", message: "quota", details: [{ "@type": "type.googleapis.com/google.rpc.RetryInfo", retryDelay: "37s" }] } } },
      { status: 503, body: { error: { code: 503, status: "UNAVAILABLE", message: "high demand" } } },
    ]);
    const model = createGeminiModel({ apiKey: "k", model: "m", fetch: f.fn });
    const e1 = await model.complete("S", [{ role: "user", content: "go" }], tools).catch((e) => e);
    expect(e1).toBeInstanceOf(RateLimitError);
    expect(e1.retryAfterMs).toBe(37_000);
    const e2 = await model.complete("S", [{ role: "user", content: "go" }], tools).catch((e) => e);
    expect(e2).toBeInstanceOf(RateLimitError);
  });

  it("marks per-day quota errors as daily, and short waits as not daily", async () => {
    const quota = (quotaId: string, delay: string) => ({
      status: 429,
      body: {
        error: {
          code: 429,
          status: "RESOURCE_EXHAUSTED",
          message: "quota",
          details: [
            { "@type": "type.googleapis.com/google.rpc.QuotaFailure", violations: [{ quotaId }] },
            { "@type": "type.googleapis.com/google.rpc.RetryInfo", retryDelay: delay },
          ],
        },
      },
    });
    const f = fakeFetch([
      quota("GenerateRequestsPerDayPerProjectPerModel-FreeTier", "33296s"),
      quota("GenerateRequestsPerMinutePerProjectPerModel-FreeTier", "20s"),
      quota("SomethingElse", "3600s"), // very long wait: treat as daily too
    ]);
    const model = createGeminiModel({ apiKey: "k", model: "m", fetch: f.fn });
    const go = () => model.complete("S", [{ role: "user", content: "go" }], tools).catch((e) => e);
    expect((await go()).daily).toBe(true);
    expect((await go()).daily).toBe(false);
    expect((await go()).daily).toBe(true);
  });

  it("treats timeouts, network errors and 5xx as transient, not fatal", async () => {
    const timeout = (async () => { throw new DOMException("The operation was aborted due to timeout", "TimeoutError"); }) as unknown as typeof fetch;
    const e1 = await createGeminiModel({ apiKey: "secret-key", model: "m", fetch: timeout }).complete("S", [{ role: "user", content: "go" }], tools).catch((e) => e);
    expect(e1).toBeInstanceOf(RateLimitError);
    expect(e1.daily).toBe(false);
    const f = fakeFetch([{ status: 500, body: { error: { code: 500, message: "internal" } } }]);
    const e2 = await createGeminiModel({ apiKey: "k", model: "m", fetch: f.fn }).complete("S", [{ role: "user", content: "go" }], tools).catch((e) => e);
    expect(e2).toBeInstanceOf(RateLimitError);
  });

  it("throws a plain error for other failures, without leaking the key", async () => {
    const f = fakeFetch([{ status: 400, body: { error: { code: 400, message: "bad request for key secret-key" } } }]);
    const err = await createGeminiModel({ apiKey: "secret-key", model: "m", fetch: f.fn }).complete("S", [{ role: "user", content: "go" }], tools).catch((e) => e);
    expect(err).not.toBeInstanceOf(RateLimitError);
    expect(String(err.message)).toMatch(/400/);
    expect(String(err.message)).not.toContain("secret-key");
  });

  it("returns an empty turn when the reply is blocked or malformed", async () => {
    const f = fakeFetch([{ status: 200, body: { candidates: [{ finishReason: "MALFORMED_FUNCTION_CALL" }] } }]);
    const turn = await createGeminiModel({ apiKey: "k", model: "m", fetch: f.fn }).complete("S", [{ role: "user", content: "go" }], tools);
    expect(turn).toMatchObject({ text: "", toolCalls: [] });
  });
});
