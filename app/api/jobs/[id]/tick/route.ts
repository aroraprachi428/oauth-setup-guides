import { after, NextResponse, type NextRequest } from "next/server";
import { poke, runTick } from "@/lib/jobs/kick";

// Runs one chunk of a job in the background and answers at once. Safe to call repeatedly:
// a job is leased per chunk, so concurrent ticks for the same job do nothing.
export const maxDuration = 300;

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const origin = req.nextUrl.origin;
  after(async () => {
    const status = await runTick(id);
    if (status === "continue") await poke(origin, id);
  });
  return NextResponse.json({ accepted: true }, { status: 202 });
}
