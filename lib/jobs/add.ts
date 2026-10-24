import { checkLimit, limitConfig, type LimitConfig } from "../limits";
import { normalizeAppName } from "../slug";
import type { Store } from "../store/types";

export type AddResult =
  | { status: "exists"; slug: string }
  | { status: "queued"; slug: string; jobId: string; joined: boolean }
  | { status: "refused"; reason: "invalid_name" | "visitor_limit" | "global_limit" | "unavailable"; message: string };

const MESSAGES = {
  visitor_limit: "You've added the maximum number of new apps for today. Try again tomorrow.",
  global_limit: "We've hit today's limit for new apps. Try again tomorrow.",
  unavailable: "Adding new apps is temporarily unavailable.",
};

export async function requestAdd(input: {
  name: string;
  store: Store;
  curatedSlugs: string[];
  visitor: string;
  agentConfigured: boolean;
  limits?: LimitConfig;
  now?: Date;
}): Promise<AddResult> {
  const n = normalizeAppName(input.name);
  if (!n.ok) return { status: "refused", reason: "invalid_name", message: n.reason };

  // Already in the gallery: no lookup needed, whoever asks.
  if (input.curatedSlugs.includes(n.slug) || (await input.store.getGuide(n.slug))) return { status: "exists", slug: n.slug };

  if (!input.agentConfigured) return { status: "refused", reason: "unavailable", message: MESSAGES.unavailable };

  // Someone is already researching it: join, and don't charge this visitor's quota.
  const active = await input.store.findActiveJob(n.slug, "add");
  if (active) return { status: "queued", slug: n.slug, jobId: active.id, joined: true };

  const limit = await checkLimit(input.store, "add", input.visitor, input.limits ?? limitConfig(), input.now);
  if (!limit.ok) return { status: "refused", reason: limit.reason, message: MESSAGES[limit.reason] };

  const { job, joined } = await input.store.createOrJoinJob(n.slug, "add", n.name);
  return { status: "queued", slug: n.slug, jobId: job.id, joined };
}
