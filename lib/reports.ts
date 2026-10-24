import { checkLimit, limitConfig, type LimitConfig } from "./limits";
import type { Report, ReportType, Store } from "./store/types";

// "Report a problem". Reports never edit a guide. Two reports on a generated guide within
// 30 days queue one focused re-check; the agent can then change a verified claim only with a
// fresh official source (the gates enforce that). Curated guides are never re-checked by the agent.

export const REPORT_TYPES: ReportType[] = ["label_different", "got_error", "took_longer", "missing_requirement", "other"];
export const RECHECK_THRESHOLD = 2;
export const RECHECK_WINDOW_MS = 30 * 24 * 3600_000;
export const EXPERIENCE_MIN_REPORTS = 3;
export const EXPERIENCE_WINDOW_MS = 183 * 24 * 3600_000; // about 6 months
const MAX_DETAIL = 1000;
const MAX_MINUTES = 365 * 24 * 60;
const TARGET = /^(verdict|[a-z0-9][a-z0-9-]{0,63})$/;

export type ReportResult =
  | { status: "recorded" }
  | { status: "recheck_queued"; jobId: string }
  | { status: "duplicate" }
  | { status: "invalid"; message: string }
  | { status: "rate_limited" };

export async function submitReport(input: {
  store: Store;
  slug: string;
  appName: string;
  isCurated: boolean;
  target: string;
  type: string;
  detail: string | null;
  minutesTaken: number | null;
  visitor: string;
  limits?: LimitConfig;
  now?: Date;
}): Promise<ReportResult> {
  const now = input.now ?? new Date();
  const type = input.type as ReportType;
  if (!REPORT_TYPES.includes(type)) return { status: "invalid", message: "Pick what went wrong." };
  if (!TARGET.test(input.target)) return { status: "invalid", message: "Unknown part of the guide." };
  const detail = input.detail?.trim() || null;
  if (detail && detail.length > MAX_DETAIL) return { status: "invalid", message: `Keep details under ${MAX_DETAIL} characters.` };
  let minutes: number | null = null;
  if (type === "took_longer" && input.minutesTaken != null) {
    if (!Number.isInteger(input.minutesTaken) || input.minutesTaken < 1 || input.minutesTaken > MAX_MINUTES) {
      return { status: "invalid", message: "Enter how long it took, in minutes." };
    }
    minutes = input.minutesTaken;
  }

  const { store, slug } = input;
  const windowStart = new Date(now.getTime() - RECHECK_WINDOW_MS).toISOString();
  const open = await store.openReports(slug, windowStart);
  if (open.some((r) => r.visitorHash === input.visitor && r.target === input.target)) return { status: "duplicate" };

  const limit = await checkLimit(store, "report", input.visitor, input.limits ?? limitConfig(), now);
  if (!limit.ok) return { status: "rate_limited" };

  await store.addReport({ slug, target: input.target, type, detail, minutesTaken: minutes, visitorHash: input.visitor });

  if (input.isCurated) return { status: "recorded" };
  if (open.length + 1 < RECHECK_THRESHOLD) return { status: "recorded" };
  if (await store.findActiveJob(slug, "recheck")) return { status: "recorded" };
  const { job } = await store.createOrJoinJob(slug, "recheck", input.appName);
  return { status: "recheck_queued", jobId: job.id };
}

/** "N people reported X–Y" for how long things took; null until enough reports agree. */
export function experienceSummary(reports: Report[], now: Date = new Date()) {
  const since = now.getTime() - EXPERIENCE_WINDOW_MS;
  const times = reports
    .filter((r) => r.type === "took_longer" && r.minutesTaken != null && new Date(r.createdAt).getTime() >= since)
    .map((r) => r.minutesTaken!);
  if (times.length < EXPERIENCE_MIN_REPORTS) return null;
  return { count: times.length, minMinutes: Math.min(...times), maxMinutes: Math.max(...times) };
}

export function formatMinutes(m: number): string {
  if (m < 60) return `${m} min`;
  if (m < 48 * 60) return `${Math.round(m / 60)} h`;
  return `${Math.round(m / (24 * 60))} days`;
}
