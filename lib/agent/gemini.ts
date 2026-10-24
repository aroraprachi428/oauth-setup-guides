import { randomUUID } from "node:crypto";
import { RateLimitError, type Message, type ModelAdapter, type ModelTurn, type ToolDef } from "./model";

// Gemini API (generateContent, REST). Shapes confirmed with a live probe on 2026-10-24:
// - function calls come back as parts { functionCall: { id, name, args }, thoughtSignature }
// - model parts must be replayed unchanged (thought signatures), so we keep them as `raw`
// - tool results go back as role "user" parts { functionResponse: { id, name, response } }
// - 429 = quota, 503 = "high demand"; both are treated as "slow down"
// - timeouts, network errors and other 5xx are transient too: retried with backoff, not fatal

const BASE = "https://generativelanguage.googleapis.com/v1beta";
const REQUEST_TIMEOUT_MS = 120_000;

type Part = Record<string, any>;
type Content = { role: "user" | "model"; parts: Part[] };

function toContents(messages: Message[]): Content[] {
  const out: Content[] = [];
  for (const m of messages) {
    if (m.role === "user") {
      out.push({ role: "user", parts: [{ text: m.content }] });
    } else if (m.role === "assistant") {
      const parts = Array.isArray(m.raw)
        ? (m.raw as Part[])
        : [
            ...(m.content ? [{ text: m.content }] : []),
            ...m.toolCalls.map((tc) => ({ functionCall: { id: tc.id, name: tc.name, args: tc.args } })),
          ];
      out.push({ role: "model", parts: parts.length ? parts : [{ text: "" }] });
    } else {
      const part = { functionResponse: { id: m.toolCallId, name: m.name, response: { result: m.content } } };
      const last = out[out.length - 1];
      // Results for one model turn go back together in a single user turn.
      if (last?.role === "user" && last.parts.every((p) => p.functionResponse)) last.parts.push(part);
      else out.push({ role: "user", parts: [part] });
    }
  }
  return out;
}

const retryDelayMs = (details: any[] | undefined): number | null => {
  const info = details?.find((d) => String(d?.["@type"]).endsWith("RetryInfo"));
  const m = typeof info?.retryDelay === "string" ? info.retryDelay.match(/^(\d+(?:\.\d+)?)s$/) : null;
  return m ? Math.round(Number(m[1]) * 1000) : null;
};

// A per-day quota (e.g. "GenerateRequestsPerDayPerProjectPerModel-FreeTier"), or any wait over
// 15 minutes, means this model is done for today; the caller should move to a fallback model.
const DAILY_WAIT_MS = 15 * 60_000;
function isDailyQuota(details: any[] | undefined, delay: number | null): boolean {
  const failure = details?.find((d) => String(d?.["@type"]).endsWith("QuotaFailure"));
  const perDay = (failure?.violations ?? []).some((v: any) => /PerDay/i.test(String(v?.quotaId ?? v?.quotaMetric ?? "")));
  return perDay || (delay !== null && delay > DAILY_WAIT_MS);
}

export function createGeminiModel(opts: { apiKey: string; model: string; fetch?: typeof fetch }): ModelAdapter {
  const doFetch = opts.fetch ?? fetch;
  const scrub = (s: string) => (opts.apiKey ? s.split(opts.apiKey).join("[redacted]") : s);

  return {
    name: opts.model,
    async complete(system: string, messages: Message[], tools: ToolDef[]): Promise<ModelTurn> {
      const body = {
        systemInstruction: { parts: [{ text: system }] },
        contents: toContents(messages),
        // parametersJsonSchema takes standard JSON Schema (the older `parameters` field rejects
        // keywords like const and exclusiveMinimum that the guide schema uses).
        tools: [{ functionDeclarations: tools.map((t) => ({ name: t.name, description: t.description, parametersJsonSchema: t.parameters })) }],
        toolConfig: { functionCallingConfig: { mode: "AUTO" } },
      };
      let res: Response;
      try {
        res = await doFetch(`${BASE}/models/${encodeURIComponent(opts.model)}:generateContent`, {
          method: "POST",
          headers: { "content-type": "application/json", "x-goog-api-key": opts.apiKey },
          body: JSON.stringify(body),
          signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
        });
      } catch (e) {
        throw new RateLimitError(scrub(`Gemini request failed: ${(e as Error).message}`), null, false);
      }

      const json: any = await res.json().catch(() => ({}));
      if (res.status === 429 || res.status === 503) {
        const details = json?.error?.details;
        const delay = retryDelayMs(details);
        throw new RateLimitError(scrub(`Gemini ${res.status}: ${json?.error?.message ?? res.statusText}`), delay, isDailyQuota(details, delay));
      }
      if (res.status >= 500) throw new RateLimitError(scrub(`Gemini ${res.status}: ${json?.error?.message ?? res.statusText}`), null, false);
      if (!res.ok) throw new Error(scrub(`Gemini ${res.status}: ${json?.error?.message ?? res.statusText}`));

      const parts: Part[] = json?.candidates?.[0]?.content?.parts ?? [];
      const usage = json?.usageMetadata ?? {};
      return {
        text: parts.filter((p) => typeof p.text === "string" && !p.thought).map((p) => p.text).join(""),
        toolCalls: parts
          .filter((p) => p.functionCall)
          .map((p) => ({ id: p.functionCall.id ?? `call-${randomUUID()}`, name: String(p.functionCall.name), args: p.functionCall.args ?? {} })),
        usage: {
          inputTokens: Number(usage.promptTokenCount ?? 0),
          outputTokens: Number(usage.candidatesTokenCount ?? 0) + Number(usage.thoughtsTokenCount ?? 0),
        },
        raw: parts.length ? parts : undefined,
      };
    },
  };
}
