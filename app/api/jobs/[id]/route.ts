import { NextResponse, type NextRequest } from "next/server";
import { getStore } from "@/lib/store";

// Progress for the add page. Job ids are random UUIDs, so this only reveals a job to whoever has its id.
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const store = await getStore();
  const job = store ? await store.getJob(id) : null;
  if (!store || !job) return NextResponse.json({ error: "not_found" }, { status: 404 });
  return NextResponse.json(
    {
      id: job.id,
      slug: job.slug,
      appName: job.appName,
      kind: job.kind,
      status: job.status,
      position: await store.queuePosition(job.id),
      events: job.events.slice(-40),
      leased: job.leaseUntil !== null && job.leaseUntil > new Date().toISOString(),
      nextAttemptAt: job.nextAttemptAt,
      result: job.status === "done" || job.status === "failed" ? job.resultJson : null,
    },
    { headers: { "cache-control": "no-store" } },
  );
}
