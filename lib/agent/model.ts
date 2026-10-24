// Provider-neutral interface for the research model. The Gemini adapter (task 13) and the
// scripted fake used in tests both implement it, so the runner never sees a provider API.

export type JsonSchema = { type: string; properties?: Record<string, unknown>; required?: string[]; [k: string]: unknown };

export type ToolDef = { name: string; description: string; parameters: JsonSchema };

export type ToolCall = { id: string; name: string; args: Record<string, unknown> };

export type Message =
  | { role: "user"; content: string }
  // `raw` keeps the provider's own reply (e.g. Gemini parts with thought signatures),
  // which some providers require to be sent back unchanged in later turns.
  | { role: "assistant"; content: string; toolCalls: ToolCall[]; raw?: unknown }
  | { role: "tool"; toolCallId: string; name: string; content: string };

export type ModelTurn = {
  text: string;
  toolCalls: ToolCall[];
  usage: { inputTokens: number; outputTokens: number };
  raw?: unknown;
};

export interface ModelAdapter {
  /** Shown on generated guides, e.g. "gemini-3.5-flash". */
  readonly name: string;
  complete(system: string, messages: Message[], tools: ToolDef[]): Promise<ModelTurn>;
}

/** Thrown by adapters when the provider says "slow down", a quota is exhausted, or a request fails transiently (timeout, 5xx). */
export class RateLimitError extends Error {
  constructor(
    message: string,
    readonly retryAfterMs: number | null = null,
    /** True when the model's allowance for the day is used up (waiting won't help today). */
    readonly daily: boolean = false,
  ) {
    super(message);
    this.name = "RateLimitError";
  }
}
