import { createHmac } from "node:crypto";
import type { Store } from "./store/types";

// Public-tool limits. Counters are per UTC day; visitors are identified by a salted hash
// of IP + a random cookie, so raw IPs are never stored.

export type LimitKind = "add" | "report";
export type LimitConfig = { addPerVisitor: number; reportsPerVisitor: number; runsPerDay: number };
export type LimitResult = { ok: true } | { ok: false; reason: "visitor_limit" | "global_limit" };

const int = (v: string | undefined, fallback: number) => {
  const n = Number.parseInt(v ?? "", 10);
  return Number.isFinite(n) && n >= 0 ? n : fallback;
};

export const limitConfig = (): LimitConfig => ({
  addPerVisitor: int(process.env.LIMIT_ADDS_PER_VISITOR, 3),
  reportsPerVisitor: int(process.env.LIMIT_REPORTS_PER_VISITOR, 5),
  runsPerDay: int(process.env.LIMIT_RUNS_PER_DAY, 50),
});

export function visitorHash(ip: string, cookieId: string, secret: string): string {
  return createHmac("sha256", secret).update(`${ip}|${cookieId}`).digest("hex").slice(0, 32);
}

const utcDay = (d: Date) => d.toISOString().slice(0, 10);

/** Checks and, if allowed, counts one request. Refused requests don't consume the global cap. */
export async function checkLimit(
  store: Store,
  kind: LimitKind,
  visitor: string,
  config: LimitConfig = limitConfig(),
  now: Date = new Date(),
): Promise<LimitResult> {
  const day = utcDay(now);
  const perVisitor = kind === "add" ? config.addPerVisitor : config.reportsPerVisitor;
  const visitorKey = `${kind}:${visitor}`;

  if ((await store.getCounter(visitorKey, day)) >= perVisitor) return { ok: false, reason: "visitor_limit" };
  if (kind === "add" && (await store.getCounter("runs:global", day)) >= config.runsPerDay) {
    return { ok: false, reason: "global_limit" };
  }
  await store.incrementCounter(visitorKey, day);
  if (kind === "add") await store.incrementCounter("runs:global", day);
  return { ok: true };
}
