// Storage for agent-generated guides, jobs, reports and rate-limit counters.
// Curated guides live in content/guides and never go through the store.

export type JobKind = "add" | "recheck";
export type JobStatus = "queued" | "running" | "done" | "failed";

export type JobEvent = { at: string; message: string };

export type Job = {
  id: string;
  slug: string;
  appName: string;
  kind: JobKind;
  status: JobStatus;
  events: JobEvent[];
  // Agent run state between chunks (see lib/agent/runner.ts).
  state: unknown | null;
  // Kept for failed or requester-only runs so the requester can see what was found.
  resultJson: unknown | null;
  leaseUntil: string | null;
  nextAttemptAt: string | null;
  createdAt: string;
};

export type StoredGuide = {
  slug: string;
  guide: unknown; // validated by lib/guides.ts on read
  model: string;
  createdAt: string;
  lastChecked: string;
  status: "published";
};

export type ReportType = "label_different" | "got_error" | "took_longer" | "missing_requirement" | "other";

export type NewReport = {
  slug: string;
  target: string; // step id or "verdict"
  type: ReportType;
  detail: string | null;
  minutesTaken: number | null;
  visitorHash: string;
};

export type Report = NewReport & { id: string; createdAt: string; status: "open" | "resolved" };

export interface Store {
  migrate(): Promise<void>;

  getGuide(slug: string): Promise<StoredGuide | null>;
  listPublished(): Promise<StoredGuide[]>;
  /** Publishes a guide; any previous version moves to guide_history. */
  saveGuide(slug: string, guide: unknown, model: string, reason?: string): Promise<void>;
  touchChecked(slug: string): Promise<void>;

  /** Returns the queued or running job for this slug and kind if there is one, else creates it. */
  createOrJoinJob(slug: string, kind: JobKind, appName?: string): Promise<{ job: Job; joined: boolean }>;
  getJob(id: string): Promise<Job | null>;
  /** The queued or running job for this slug and kind, if any. */
  findActiveJob(slug: string, kind: JobKind): Promise<Job | null>;
  appendEvent(id: string, message: string): Promise<void>;
  /**
   * Leases one job for a chunk of work: a queued job whose retry time has passed, or a running
   * job whose previous lease expired. Returns null if it's leased by someone else or not ready.
   */
  leaseJob(id: string, leaseUntil: string): Promise<Job | null>;
  /** Leases the next ready job, "add" before "recheck", if fewer than maxActive are leased. */
  leaseNextJob(leaseUntil: string, maxActive: number): Promise<Job | null>;
  /** Saves run state and releases the lease; the job stays running for the next chunk. */
  saveJobState(id: string, state: unknown): Promise<void>;
  finishJob(id: string, status: "done" | "failed", resultJson?: unknown): Promise<void>;
  /** Puts a job back in the queue, optionally not before `notBefore` (ISO timestamp). */
  requeueJob(id: string, notBefore?: string): Promise<void>;
  /** 0 when running or finished; otherwise the number of jobs ahead plus one. */
  queuePosition(id: string): Promise<number>;

  addReport(report: NewReport): Promise<Report>;
  /** Open reports for a slug created at or after `since` (ISO timestamp). */
  openReports(slug: string, since: string): Promise<Report[]>;
  /** All reports, open or resolved, for a slug created at or after `since`. */
  reportsSince(slug: string, since: string): Promise<Report[]>;
  resolveReports(ids: string[]): Promise<void>;

  /** Increments and returns the counter for `key` on `day` (YYYY-MM-DD). */
  incrementCounter(key: string, day: string): Promise<number>;
  getCounter(key: string, day: string): Promise<number>;
}
