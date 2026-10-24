import { demoModel, demoTransport } from "./demo";
import type { Transport } from "./fetch";
import { createGeminiModel } from "./gemini";
import { createTavilySearch } from "./tavily";
import type { ModelAdapter } from "./model";
import type { SearchAdapter } from "./search";

// `models` is tried in order: when one's daily free allowance runs out, the next takes over.
export type Agent = { model: ModelAdapter; models: ModelAdapter[]; search: SearchAdapter | null; transport?: Transport };

// Free-tier models confirmed working with function calling on 2026-10-24.
const DEFAULT_FALLBACKS = "gemini-3.5-flash-lite,gemini-3.1-flash-lite";

// AGENT_MODEL selects the backend:
//   "gemini" — Gemini API free tier (GEMINI_API_KEY; GEMINI_MODEL, default gemini-3.5-flash).
//              Free-tier Search grounding returned 429 on every model in the 2026-10-24 probe, so
//              pages are found via provider endpoints, links and known docs URLs (option A).
//              If TAVILY_API_KEY is set, Tavily web search is offered as a capped fallback.
//              GEMINI_FALLBACK_MODELS (comma-separated) take over when a model's daily quota runs out.
//   "demo"   — local scripted demo, no network, no research (development only)
//   unset    — no agent: "Add" reports that it's unavailable
export function getAgent(): Agent | null {
  switch (process.env.AGENT_MODEL) {
    case "gemini": {
      const apiKey = process.env.GEMINI_API_KEY;
      if (!apiKey) return null;
      const tavilyKey = process.env.TAVILY_API_KEY;
      const names = [
        process.env.GEMINI_MODEL || "gemini-3.5-flash",
        ...(process.env.GEMINI_FALLBACK_MODELS || DEFAULT_FALLBACKS).split(","),
      ].map((n) => n.trim()).filter((n, i, all) => n && all.indexOf(n) === i);
      const models = names.map((model) => createGeminiModel({ apiKey, model }));
      return { model: models[0], models, search: tavilyKey ? createTavilySearch({ apiKey: tavilyKey }) : null };
    }
    case "demo":
      if (process.env.NODE_ENV === "production") return null; // never publish demo guides from a real deploy
      return { model: demoModel(), models: [demoModel()], search: null, transport: demoTransport };
    default:
      return null;
  }
}
