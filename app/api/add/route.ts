import { after, NextResponse, type NextRequest } from "next/server";
import { getAgent } from "@/lib/agent/providers";
import { getCuratedGuides } from "@/lib/guides";
import { requestAdd } from "@/lib/jobs/add";
import { poke } from "@/lib/jobs/kick";
import { getStore } from "@/lib/store";
import { identifyVisitor, setVisitorCookie } from "@/lib/visitor";

const STATUS: Record<string, number> = { invalid_name: 400, visitor_limit: 429, global_limit: 429, unavailable: 503 };

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const name = typeof body?.name === "string" ? body.name : "";
  const store = await getStore();
  const { visitor, newCookie } = identifyVisitor(req);

  const result = store
    ? await requestAdd({ name, store, curatedSlugs: getCuratedGuides().map((g) => g.slug), visitor, agentConfigured: getAgent() !== null })
    : ({ status: "refused", reason: "unavailable", message: "Adding new apps is temporarily unavailable." } as const);

  if (result.status === "queued" && !result.joined) {
    const origin = req.nextUrl.origin;
    after(() => poke(origin, result.jobId));
  }
  const res = NextResponse.json(result, { status: result.status === "refused" ? STATUS[result.reason] : 200 });
  setVisitorCookie(res, newCookie);
  return res;
}
