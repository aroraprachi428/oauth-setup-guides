import { describe, expect, it } from "vitest";
import fixture from "./fixtures/sample-guide.json";
import dropbox from "../content/guides/dropbox.json";
import { call, fakeModel } from "./fakes/fake-model";
import { pageHtml, urlsToRead, withQuotes } from "./fakes/evidence";
import { newRunState, pickDocsPages, runChunk, type RunLimits } from "../lib/agent/runner";
import { exampleGuide } from "../lib/agent/prompt";
import { GuideSchema } from "../lib/schema";
import type { TransportResponse } from "../lib/agent/fetch";

// Changes that cut model requests per guide: batched fetches, auto-submit, docs prefetch,
// a smaller worked example, and stepId links for heads-ups.

const page = (body: string, type = "text/html"): TransportResponse => ({ status: 200, headers: { "content-type": type }, body, truncated: false });
const notFound: TransportResponse = { status: 404, headers: {}, body: "", truncated: false };
const transport = async (u: URL): Promise<TransportResponse> => (u.pathname === "/robots.txt" ? notFound : page(pageHtml()));
const limits: RunLimits = { maxMs: 15 * 60_000, chunkMs: 4 * 60_000, maxFetches: 80, maxTokens: 1_000_000, maxTurns: 40 };
const { slug: _slug, ...body } = withQuotes(fixture) as any;
const run = (model: ReturnType<typeof fakeModel>, mode: "add" | "recheck" = "add", l = limits, t = transport) =>
  runChunk(
    mode === "add" ? newRunState("add", "Sample Provider", "sample-guide") : newRunState("recheck", "Sample Provider", "sample-guide", { previousGuide: body, reports: [] }),
    { model, transport: t, search: null, onEvent: () => {}, now: () => 0 },
    l,
  );

describe("fetch with urls", () => {
  it("reads several pages in one model turn", async () => {
    const urls = ["https://example.com/a", "https://example.com/b", "https://example.com/c"];
    const model = fakeModel([{ toolCalls: [call("fetch", { urls })] }, { toolCalls: [call("submit_guide")] }]);
    const out = await run(model);
    expect(out.state.fetchLog.map((e) => e.url)).toEqual(urls);
    expect(out.state.turns).toBe(2);
    const reply = model.seen[1].messages.find((m) => m.role === "tool")!.content;
    expect(reply.match(/<untrusted_page /g)).toHaveLength(3);
  });

  it("refuses more than five urls at once", async () => {
    const urls = Array.from({ length: 6 }, (_, i) => `https://example.com/${i}`);
    const model = fakeModel([{ toolCalls: [call("fetch", { urls })] }, { toolCalls: [call("submit_guide")] }]);
    const out = await run(model);
    expect(out.state.fetchLog).toHaveLength(0);
    expect(model.seen[1].messages.find((m) => m.role === "tool")!.content).toMatch(/at most 5 urls/);
  });
});

describe("auto-submit", () => {
  const steps = () => [{ toolCalls: [call("fetch", { urls: urlsToRead().slice(0, 5) })] }, { toolCalls: [call("fetch", { urls: urlsToRead().slice(5) })] }, { toolCalls: [call("set_draft", { fields: body })] }];

  it("submits a new guide as soon as a set_draft passes every check", async () => {
    const model = fakeModel(steps()); // no submit_guide turn scripted
    const out = await run(model);
    expect(out.outcome).toBe("submitted");
    expect(model.seen).toHaveLength(3);
  });

  it("leaves re-checks to finish with submit_guide", async () => {
    const model = fakeModel([...steps(), { toolCalls: [call("submit_guide")] }]);
    const out = await run(model, "recheck");
    expect(out.outcome).toBe("submitted");
    expect(model.seen).toHaveLength(4);
  });
});

describe("docs prefetch", () => {
  const llms = "# Sample docs\n- [OAuth guide](https://developer.sample.com/docs/oauth): how to authorize\n- [Scopes](https://developer.sample.com/docs/scopes)\n- [App review](https://developer.sample.com/docs/app-review)\n- [Blog](https://developer.sample.com/blog/news)";
  const docsTransport = async (u: URL): Promise<TransportResponse> => {
    if (u.pathname === "/robots.txt") return notFound;
    if (u.host !== "developer.sample.com") return notFound;
    if (u.pathname === "/llms.txt") return page(llms, "text/plain");
    if (u.pathname.startsWith("/docs/")) return page(pageHtml());
    return notFound;
  };

  it("reads the likely OAuth pages before the first model call and hands them over", async () => {
    const model = fakeModel([{ toolCalls: [call("submit_guide")] }]);
    const out = await run(model, "add", { ...limits, prefetchPages: 4 }, docsTransport);
    const read = out.state.fetchLog.filter((e) => e.contentFound).map((e) => e.url);
    expect(read).toEqual(expect.arrayContaining(["https://developer.sample.com/docs/oauth", "https://developer.sample.com/docs/scopes", "https://developer.sample.com/docs/app-review"]));
    expect(read).not.toContain("https://developer.sample.com/blog/news");
    const task = model.seen[0].messages[0].content;
    expect(task).toMatch(/already looked up the docs host developer\.sample\.com/);
    expect(task.match(/<untrusted_page /g)).toHaveLength(3);
  });

  it("does nothing when no docs host answers, or when switched off", async () => {
    const quiet = fakeModel([{ toolCalls: [call("submit_guide")] }]);
    await run(quiet, "add", { ...limits, prefetchPages: 4 }, async () => notFound);
    expect(quiet.seen[0].messages[0].content).not.toMatch(/already looked up/);
    const off = fakeModel([{ toolCalls: [call("submit_guide")] }]);
    const out = await run(off, "add", limits, docsTransport);
    expect(out.state.fetchLog).toHaveLength(0);
  });

  it("picks OAuth pages first and keeps one review/production page", () => {
    const urls = ["https://d.com/blog", "https://d.com/scopes", "https://d.com/oauth/authorize", "https://d.com/app-review", "https://d.com/oauth/token", "https://d.com/.well-known/openid-configuration"];
    expect(pickDocsPages(urls, 3)).toEqual(["https://d.com/oauth/authorize", "https://d.com/oauth/token", "https://d.com/app-review"]);
  });
});

describe("worked example", () => {
  it("is a valid guide at under half the size of the full one", () => {
    const g = exampleGuide();
    expect(GuideSchema.safeParse(g).success).toBe(true);
    expect(JSON.stringify(g).length).toBeLessThan(JSON.stringify(dropbox).length / 2);
  });
});

describe("stepId on heads-ups", () => {
  it("must point at a real step", () => {
    const g = structuredClone(fixture) as any;
    g.nuances[0] = { ...g.nuances[0], stepId: g.steps[0].id };
    expect(GuideSchema.safeParse(g).success).toBe(true);
    g.nuances[0].stepId = "no-such-step";
    const r = GuideSchema.safeParse(g);
    expect(r.success).toBe(false);
    expect(JSON.stringify(r.error?.issues)).toMatch(/unknown step no-such-step/);
  });
});
