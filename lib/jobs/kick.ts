import { getAgent } from "../agent/providers";
import { getStore } from "../store";
import { advanceJob, type AdvanceStatus } from "./advance";
import { getArchive } from "./archive";

// Chunks chain themselves: a tick runs one chunk, and if there's more to do it pokes the tick
// route again (which answers immediately and works in `after`). The progress page also nudges
// stalled jobs, so a dropped poke only delays a run.

export async function runTick(jobId: string | null): Promise<AdvanceStatus> {
  const store = await getStore();
  const agent = getAgent();
  if (!store || !agent) return "idle";
  const r = await advanceJob(jobId, { store, ...agent, archive: getArchive() });
  return r.status;
}

export async function poke(origin: string, jobId: string) {
  try {
    await fetch(`${origin}/api/jobs/${encodeURIComponent(jobId)}/tick`, { method: "POST", signal: AbortSignal.timeout(10_000) });
  } catch (e) {
    console.warn(`Couldn't poke job ${jobId}: ${(e as Error).message}`);
  }
}
