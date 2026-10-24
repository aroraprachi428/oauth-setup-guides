"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

// Apps this browser asked for, so the gallery can lead back to them. Kept in localStorage only:
// a job's page is reachable by anyone with its id, so the list itself is the only private part.

type Request = { jobId: string; slug: string; appName: string; at: string };
type Status = "working" | "added" | "not_added";

const KEY = "my-requests";
const MAX = 10;

function readRequests(): Request[] {
  try {
    const parsed = JSON.parse(window.localStorage.getItem(KEY) ?? "[]");
    return Array.isArray(parsed) ? parsed.filter((r) => r && typeof r.jobId === "string") : [];
  } catch {
    return [];
  }
}

function writeRequests(list: Request[]) {
  try {
    window.localStorage.setItem(KEY, JSON.stringify(list.slice(0, MAX)));
  } catch {
    // Storage blocked or full: the gallery just won't list this request.
  }
}

/** Called from the progress page, so a request is remembered however the visitor got there. */
export function rememberRequest(r: Omit<Request, "at">) {
  const list = readRequests();
  if (list.some((x) => x.jobId === r.jobId)) return;
  writeRequests([{ ...r, at: new Date().toISOString() }, ...list]);
}

type JobView = { status: string; leased: boolean; nextAttemptAt: string | null; result?: { outcome?: string } | null };

const statusOf = (job: JobView): Status =>
  job.status === "done" && job.result?.outcome === "published" ? "added" : job.status === "done" || job.status === "failed" ? "not_added" : "working";

const LABELS: Record<Status, string> = { working: "Researching…", added: "Added", not_added: "Not added" };

// Same pacing as the progress page: poll while something is running, and nudge a job nobody is
// working on, so leaving the progress page for the gallery doesn't stall a run.
const POLL_MS = 5000;
const NUDGE_EVERY_MS = 15_000;

export function MyRequests() {
  const [items, setItems] = useState<(Request & { status?: Status })[]>([]);

  useEffect(() => {
    let stop = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const lastNudge = new Map<string, number>();

    async function check(r: Request & { status?: Status }) {
      if (r.status && r.status !== "working") return r;
      try {
        const res = await fetch(`/api/jobs/${encodeURIComponent(r.jobId)}`, { cache: "no-store" });
        if (res.status === 404) return null; // job gone (e.g. a different database): forget it
        if (!res.ok) return r;
        const job: JobView = await res.json();
        const status = statusOf(job);
        const ready = job.status === "running" ? !job.leased : !job.nextAttemptAt || new Date(job.nextAttemptAt) <= new Date();
        if (status === "working" && ready && Date.now() - (lastNudge.get(r.jobId) ?? 0) > NUDGE_EVERY_MS) {
          lastNudge.set(r.jobId, Date.now());
          fetch(`/api/jobs/${encodeURIComponent(r.jobId)}/tick`, { method: "POST" }).catch(() => {});
        }
        return { ...r, status };
      } catch {
        return r;
      }
    }

    async function poll(list: (Request & { status?: Status })[]) {
      const checked = await Promise.all(list.map(check));
      if (stop) return;
      const kept = checked.filter((r): r is Request & { status?: Status } => r !== null);
      if (kept.length !== list.length) writeRequests(kept);
      setItems(kept);
      if (kept.some((r) => r.status === "working")) timer = setTimeout(() => poll(kept), POLL_MS);
    }

    const list = readRequests();
    setItems(list);
    poll(list);
    return () => {
      stop = true;
      clearTimeout(timer);
    };
  }, []);

  if (items.length === 0) return null;

  const forget = (jobId: string) => {
    const kept = items.filter((r) => r.jobId !== jobId);
    writeRequests(kept);
    setItems(kept);
  };

  return (
    <section className="my-requests" aria-labelledby="my-requests">
      <h2 id="my-requests">Your requests</h2>
      <ul className="plain">
        {items.map((r) => (
          <li key={r.jobId}>
            <Link href={r.status === "added" ? `/guides/${r.slug}` : `/add/${r.jobId}`}>{r.appName}</Link>
            {r.status && <span className={`ai-label my-requests__status--${r.status}`}>{LABELS[r.status]}</span>}
            {r.status && r.status !== "working" && (
              <button type="button" className="my-requests__forget" onClick={() => forget(r.jobId)} aria-label={`Remove ${r.appName} from your requests`}>
                ×
              </button>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}
