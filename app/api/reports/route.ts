import { after, NextResponse, type NextRequest } from "next/server";
import { getCuratedGuides, getGuide } from "@/lib/guides";
import { poke } from "@/lib/jobs/kick";
import { submitReport } from "@/lib/reports";
import { getStore } from "@/lib/store";
import { identifyVisitor, setVisitorCookie } from "@/lib/visitor";

const STATUS = { recorded: 200, recheck_queued: 200, duplicate: 200, invalid: 400, rate_limited: 429 } as const;

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const slug = typeof body?.slug === "string" ? body.slug : "";
  const target = typeof body?.target === "string" ? body.target : "";
  const store = await getStore();
  const guide = slug ? await getGuide(slug) : undefined;
  if (!store) return NextResponse.json({ status: "unavailable" }, { status: 503 });
  if (!guide || (target !== "verdict" && !guide.steps.some((s) => s.id === target))) {
    return NextResponse.json({ status: "invalid", message: "Unknown guide or step." }, { status: 400 });
  }

  const { visitor, newCookie } = identifyVisitor(req);
  const result = await submitReport({
    store,
    slug,
    appName: guide.app.name,
    // Guides in content/guides (curated, or generated and promoted) are fixed files: reports are
    // recorded, but a re-check could never replace them.
    isCurated: getCuratedGuides().some((g) => g.slug === slug),
    target,
    type: typeof body.type === "string" ? body.type : "",
    detail: typeof body.detail === "string" ? body.detail : null,
    minutesTaken: typeof body.minutesTaken === "number" ? body.minutesTaken : null,
    visitor,
  });
  if (result.status === "recheck_queued") {
    const origin = req.nextUrl.origin;
    after(() => poke(origin, result.jobId));
  }
  const res = NextResponse.json(result, { status: STATUS[result.status] });
  setVisitorCookie(res, newCookie);
  return res;
}
