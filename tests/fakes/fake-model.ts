import type { Message, ModelAdapter, ModelTurn, ToolCall, ToolDef } from "../../lib/agent/model";

// Replays scripted turns. A step can be a fixed turn, a function of the conversation so far
// (to react to tool results), or an Error to throw (e.g. RateLimitError).
export type FakeStep = Partial<ModelTurn> | ((messages: Message[]) => Partial<ModelTurn>) | Error;

export function call(name: string, args: Record<string, unknown> = {}): ToolCall {
  return { id: `${name}-${Math.random().toString(36).slice(2, 8)}`, name, args };
}

export function fakeModel(steps: FakeStep[], name = "fake-model") {
  const seen: { system: string; messages: Message[]; tools: ToolDef[] }[] = [];
  let i = 0;
  const model: ModelAdapter & { seen: typeof seen; get remaining(): number } = {
    name,
    seen,
    get remaining() {
      return steps.length - i;
    },
    async complete(system, messages, tools) {
      seen.push({ system, messages: structuredClone(messages), tools });
      if (i >= steps.length) throw new Error("fake model ran out of scripted steps");
      const step = steps[i++];
      if (step instanceof Error) throw step;
      const turn = typeof step === "function" ? step(messages) : step;
      return { text: turn.text ?? "", toolCalls: turn.toolCalls ?? [], usage: turn.usage ?? { inputTokens: 100, outputTokens: 50 } };
    },
  };
  return model;
}
