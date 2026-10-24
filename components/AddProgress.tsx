"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { rememberRequest } from "./MyRequests";

type JobView = {
  slug: string;
  appName: string;
  status: "queued" | "running" | "done" | "failed";
  position: number;
  events: { at: string; message: string }[];
  leased: boolean;
  nextAttemptAt: string | null;
  result: { outcome: string; reasons: string[]; guide?: any } | null;
};

const POLL_MS = 2000;
const NUDGE_EVERY_MS = 15_000;

// A queued job with a future retry time is waiting on the model's quota, not on other jobs.
function statusLine(job: JobView): string {
  if (job.status !== "queued") return "Working. This usually takes a few minutes. You can leave this page: it stays under “Your requests” in the gallery.";
  const retry = job.nextAttemptAt ? new Date(job.nextAttemptAt) : null;
  if (retry && retry.getTime() > Date.now()) {
    const at = retry.toLocaleString(undefined, { weekday: "short", hour: "numeric", minute: "2-digit" });
    return `Waiting for the AI model's free daily or per-minute limit to reset; continuing around ${at}.`;
  }
  return job.position > 1 ? `Waiting in line (${job.position - 1} ahead of you).` : "Starting…";
}

function saveLocally(slug: string, guide: unknown) {
  try {
    window.localStorage.setItem(`incomplete-guide:${slug}`, JSON.stringify(guide));
  } catch {
    // Storage blocked or full: the result is still shown on this page.
  }
}

export function AddProgress({ jobId }: { jobId: string }) {
  const router = useRouter();
  const [job, setJob] = useState<JobView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const lastNudge = useRef(0);

  useEffect(() => {
    let stop = false;
    async function poll() {
      try {
        const r = await fetch(`/api/jobs/${jobId}`, { cache: "no-store" });
        if (!r.ok) throw new Error(r.status === 404 ? "This job doesn't exist." : "Couldn't load progress.");
        const j: JobView = await r.json();
        if (stop) return;
        rememberRequest({ jobId, slug: j.slug, appName: j.appName });
        setJob(j);
        setError(null);
        if (j.status === "done" && j.result?.outcome === "published") {
          router.replace(`/guides/${j.slug}`);
          return;
        }
        if (j.status === "done" || j.status === "failed") {
          if (j.result?.guide) saveLocally(j.slug, j.result.guide);
          return;
        }
        // Nudge a job that nobody is working on (e.g. a dropped chain or a finished wait).
        const ready = j.status === "running" ? !j.leased : !j.nextAttemptAt || new Date(j.nextAttemptAt) <= new Date();
        if (ready && Date.now() - lastNudge.current > NUDGE_EVERY_MS) {
          lastNudge.current = Date.now();
          fetch(`/api/jobs/${jobId}/tick`, { method: "POST" }).catch(() => {});
        }
      } catch (e) {
        if (!stop) setError((e as Error).message);
      }
      if (!stop) setTimeout(poll, POLL_MS);
    }
    poll();
    return () => {
      stop = true;
    };
  }, [jobId, router]);

  if (error && !job) return <p role="alert">{error}</p>;
  if (!job) return <p>Loading…</p>;

  const finished = job.status === "done" || job.status === "failed";
  const recent = job.events.slice(-8);

  return (
    <article className="progress">
      <h1>{finished ? `${job.appName}: not added` : `Researching ${job.appName}`}</h1>

      {!finished && (
        <p className="muted" aria-live="polite">
          {statusLine(job)}
        </p>
      )}

      {finished && job.result && (
        <section className="notice" aria-labelledby="why">
          <h2 id="why">
            {job.result.outcome === "requester_only"
              ? "The guide wasn't good enough to add to the gallery"
              : job.result.outcome === "incomplete"
                ? "The research stopped before it finished"
                : "Something went wrong"}
          </h2>
          <ul>
            {job.result.reasons.slice(0, 8).map((r) => (
              <li key={r}>{r}</li>
            ))}
          </ul>
          {job.result.guide && <PartialGuide guide={job.result.guide} />}
          <p className="muted">Only you can see this. It's saved in this browser, not in the gallery.</p>
        </section>
      )}

      <section aria-labelledby="steps-log">
        <h2 id="steps-log">What the agent did</h2>
        <ol className="events">
          {recent.map((e, i) => (
            <li key={`${e.at}-${i}`}>{e.message}</li>
          ))}
        </ol>
      </section>

      <p>
        <Link href="/">Back to the gallery</Link>
      </p>
    </article>
  );
}

function PartialGuide({ guide }: { guide: any }) {
  const profile = guide?.profiles?.[0];
  const steps: any[] = Array.isArray(guide?.steps) ? guide.steps : [];
  return (
    <div className="partial">
      <h3>What it found (incomplete, unchecked)</h3>
      {profile?.intent && <p><strong>Intent:</strong> {String(profile.intent)}</p>}
      {profile?.bottomLine && <p>{String(profile.bottomLine)}</p>}
      {steps.length > 0 && (
        <ol>
          {steps.slice(0, 15).map((s, i) => (
            <li key={s?.id ?? i}>{String(s?.title ?? "Untitled step")}</li>
          ))}
        </ol>
      )}
    </div>
  );
}
