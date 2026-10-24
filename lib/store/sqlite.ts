import { randomUUID } from "node:crypto";
import { createClient, type Client, type Row } from "@libsql/client";
import type { Job, JobKind, NewReport, Report, Store, StoredGuide } from "./types";

// libSQL works with a local file (file:./data/guides.db), :memory: for tests, or a Turso URL.

const SCHEMA = [
  `CREATE TABLE IF NOT EXISTS generated_guides (
     slug TEXT PRIMARY KEY, guide_json TEXT NOT NULL, model TEXT NOT NULL,
     created_at TEXT NOT NULL, last_checked TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'published')`,
  `CREATE TABLE IF NOT EXISTS guide_history (
     slug TEXT NOT NULL, guide_json TEXT NOT NULL, replaced_at TEXT NOT NULL, reason TEXT NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS jobs (
     id TEXT PRIMARY KEY, slug TEXT NOT NULL, app_name TEXT NOT NULL DEFAULT '', kind TEXT NOT NULL,
     status TEXT NOT NULL, events TEXT NOT NULL DEFAULT '[]', state TEXT, result_json TEXT,
     lease_until TEXT, next_attempt_at TEXT, created_at TEXT NOT NULL)`,
  `CREATE INDEX IF NOT EXISTS jobs_status ON jobs (status, kind, created_at)`,
  `CREATE TABLE IF NOT EXISTS reports (
     id TEXT PRIMARY KEY, slug TEXT NOT NULL, target TEXT NOT NULL, type TEXT NOT NULL, detail TEXT,
     minutes_taken INTEGER, visitor_hash TEXT NOT NULL, created_at TEXT NOT NULL, status TEXT NOT NULL)`,
  `CREATE INDEX IF NOT EXISTS reports_slug ON reports (slug, status, created_at)`,
  `CREATE TABLE IF NOT EXISTS counters (key TEXT NOT NULL, day TEXT NOT NULL, n INTEGER NOT NULL, PRIMARY KEY (key, day))`,
];

// "add" sorts before "recheck", so new apps are served first.
const PRIORITY = `CASE kind WHEN 'add' THEN 0 ELSE 1 END`;
// A job is ready for a chunk when it's queued and past its retry time, or running with no live lease.
// Takes two "now" parameters.
const READY = `(status = 'queued' AND (next_attempt_at IS NULL OR next_attempt_at <= ?))
            OR (status = 'running' AND (lease_until IS NULL OR lease_until <= ?))`;

const str = (v: unknown) => String(v);
const json = (v: unknown) => (v == null ? null : JSON.parse(String(v)));

const toGuide = (r: Row): StoredGuide => ({
  slug: str(r.slug),
  guide: json(r.guide_json),
  model: str(r.model),
  createdAt: str(r.created_at),
  lastChecked: str(r.last_checked),
  status: "published",
});

const toJob = (r: Row): Job => ({
  id: str(r.id),
  slug: str(r.slug),
  appName: str(r.app_name),
  kind: str(r.kind) as Job["kind"],
  status: str(r.status) as Job["status"],
  events: json(r.events) ?? [],
  state: json(r.state),
  resultJson: json(r.result_json),
  leaseUntil: r.lease_until == null ? null : str(r.lease_until),
  nextAttemptAt: r.next_attempt_at == null ? null : str(r.next_attempt_at),
  createdAt: str(r.created_at),
});

const toReport = (r: Row): Report => ({
  id: str(r.id),
  slug: str(r.slug),
  target: str(r.target),
  type: str(r.type) as Report["type"],
  detail: r.detail == null ? null : str(r.detail),
  minutesTaken: r.minutes_taken == null ? null : Number(r.minutes_taken),
  visitorHash: str(r.visitor_hash),
  createdAt: str(r.created_at),
  status: str(r.status) as Report["status"],
});

export function createSqliteStore(
  url: string,
  opts: { authToken?: string; now?: () => Date } = {},
): Store & { historyFor(slug: string): Promise<{ guide: unknown; reason: string; replacedAt: string }[]> } {
  const db: Client = createClient({ url, authToken: opts.authToken });
  const now = () => (opts.now ?? (() => new Date()))().toISOString();
  const one = async (sql: string, args: any[] = []) => (await db.execute({ sql, args })).rows[0];
  const all = async (sql: string, args: any[] = []) => (await db.execute({ sql, args })).rows;

  return {
    async migrate() {
      await db.batch(SCHEMA, "write");
    },

    async getGuide(slug) {
      const r = await one(`SELECT * FROM generated_guides WHERE slug = ?`, [slug]);
      return r ? toGuide(r) : null;
    },

    async listPublished() {
      return (await all(`SELECT * FROM generated_guides WHERE status = 'published' ORDER BY slug`)).map(toGuide);
    },

    async saveGuide(slug, guide, model, reason = "replaced") {
      const at = now();
      await db.batch(
        [
          {
            sql: `INSERT INTO guide_history (slug, guide_json, replaced_at, reason)
                  SELECT slug, guide_json, ?, ? FROM generated_guides WHERE slug = ?`,
            args: [at, reason, slug],
          },
          {
            sql: `INSERT INTO generated_guides (slug, guide_json, model, created_at, last_checked, status)
                  VALUES (?, ?, ?, ?, ?, 'published')
                  ON CONFLICT (slug) DO UPDATE SET guide_json = excluded.guide_json, model = excluded.model,
                    last_checked = excluded.last_checked, status = 'published'`,
            args: [slug, JSON.stringify(guide), model, at, at],
          },
        ],
        "write",
      );
    },

    async touchChecked(slug) {
      await db.execute({ sql: `UPDATE generated_guides SET last_checked = ? WHERE slug = ?`, args: [now(), slug] });
    },

    async historyFor(slug) {
      return (await all(`SELECT * FROM guide_history WHERE slug = ? ORDER BY replaced_at`, [slug])).map((r) => ({
        guide: json(r.guide_json),
        reason: str(r.reason),
        replacedAt: str(r.replaced_at),
      }));
    },

    async findActiveJob(slug, kind) {
      const r = await one(
        `SELECT * FROM jobs WHERE slug = ? AND kind = ? AND status IN ('queued', 'running') ORDER BY created_at LIMIT 1`,
        [slug, kind],
      );
      return r ? toJob(r) : null;
    },

    async createOrJoinJob(slug, kind: JobKind, appName = slug) {
      const existing = await this.findActiveJob(slug, kind);
      if (existing) return { job: existing, joined: true };
      const id = randomUUID();
      await db.execute({
        sql: `INSERT INTO jobs (id, slug, app_name, kind, status, created_at) VALUES (?, ?, ?, ?, 'queued', ?)`,
        args: [id, slug, appName, kind, now()],
      });
      return { job: toJob((await one(`SELECT * FROM jobs WHERE id = ?`, [id]))!), joined: false };
    },

    async getJob(id) {
      const r = await one(`SELECT * FROM jobs WHERE id = ?`, [id]);
      return r ? toJob(r) : null;
    },

    async appendEvent(id, message) {
      await db.execute({
        sql: `UPDATE jobs SET events = json_insert(events, '$[#]', json_object('at', ?, 'message', ?)) WHERE id = ?`,
        args: [now(), message, id],
      });
    },

    // Leasing is a single UPDATE ... RETURNING, so two invocations can't take the same job.
    async leaseJob(id, leaseUntil) {
      const t = now();
      const r = await one(
        `UPDATE jobs SET status = 'running', lease_until = ?
         WHERE id = ? AND (${READY})
         RETURNING *`,
        [leaseUntil, id, t, t],
      );
      return r ? toJob(r) : null;
    },

    async leaseNextJob(leaseUntil, maxActive) {
      const t = now();
      const r = await one(
        `UPDATE jobs SET status = 'running', lease_until = ?
         WHERE (SELECT COUNT(*) FROM jobs WHERE status = 'running' AND lease_until > ?) < ?
           AND id = (SELECT id FROM jobs WHERE ${READY} ORDER BY ${PRIORITY}, created_at LIMIT 1)
         RETURNING *`,
        [leaseUntil, t, maxActive, t, t],
      );
      return r ? toJob(r) : null;
    },

    async saveJobState(id, state) {
      await db.execute({
        sql: `UPDATE jobs SET state = ?, lease_until = NULL WHERE id = ?`,
        args: [JSON.stringify(state), id],
      });
    },

    async finishJob(id, status, resultJson) {
      await db.execute({
        sql: `UPDATE jobs SET status = ?, result_json = ?, lease_until = NULL WHERE id = ?`,
        args: [status, resultJson === undefined ? null : JSON.stringify(resultJson), id],
      });
    },

    async requeueJob(id, notBefore) {
      await db.execute({
        sql: `UPDATE jobs SET status = 'queued', lease_until = NULL, next_attempt_at = ? WHERE id = ?`,
        args: [notBefore ?? null, id],
      });
    },

    async queuePosition(id) {
      const job = await one(`SELECT * FROM jobs WHERE id = ?`, [id]);
      if (!job || job.status !== "queued") return 0;
      const ahead = await one(
        `SELECT COUNT(*) AS n FROM jobs WHERE status = 'queued' AND id != ?
           AND (${PRIORITY} < ? OR (${PRIORITY} = ? AND created_at < ?))`,
        [id, job.kind === "add" ? 0 : 1, job.kind === "add" ? 0 : 1, job.created_at],
      );
      return Number(ahead?.n ?? 0) + 1;
    },

    async addReport(report: NewReport) {
      const row: Report = { ...report, id: randomUUID(), createdAt: now(), status: "open" };
      await db.execute({
        sql: `INSERT INTO reports (id, slug, target, type, detail, minutes_taken, visitor_hash, created_at, status)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'open')`,
        args: [row.id, row.slug, row.target, row.type, row.detail, row.minutesTaken, row.visitorHash, row.createdAt],
      });
      return row;
    },

    async openReports(slug, since) {
      return (
        await all(`SELECT * FROM reports WHERE slug = ? AND status = 'open' AND created_at >= ? ORDER BY created_at`, [
          slug,
          since,
        ])
      ).map(toReport);
    },

    async reportsSince(slug, since) {
      return (await all(`SELECT * FROM reports WHERE slug = ? AND created_at >= ? ORDER BY created_at`, [slug, since])).map(toReport);
    },

    async resolveReports(ids) {
      if (ids.length === 0) return;
      await db.execute({
        sql: `UPDATE reports SET status = 'resolved' WHERE id IN (${ids.map(() => "?").join(",")})`,
        args: ids,
      });
    },

    async incrementCounter(key, day) {
      const r = await one(
        `INSERT INTO counters (key, day, n) VALUES (?, ?, 1)
         ON CONFLICT (key, day) DO UPDATE SET n = n + 1 RETURNING n`,
        [key, day],
      );
      return Number(r!.n);
    },

    async getCounter(key, day) {
      const r = await one(`SELECT n FROM counters WHERE key = ? AND day = ?`, [key, day]);
      return r ? Number(r.n) : 0;
    },
  };
}
