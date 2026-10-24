import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getAllGuides, getGuide } from "@/lib/guides";
import { defaultProfile } from "@/lib/bands";
import type { Guide, Profile, Step } from "@/lib/schema";
import { OWNER_LABELS, GATE_LABELS } from "@/lib/labels";
import { GuideFlow } from "@/components/GuideFlow";
import { CheckItem, StageChecklist, type StepView } from "@/components/StageChecklist";
import { GlanceTiles, LiveSummary } from "@/components/GlanceTiles";
import { ReportProblem } from "@/components/ReportProblem";
import { Icon } from "@/components/Icon";
import { Rich, splitHeadline } from "@/components/RichText";
import { STAGE_NAMES } from "@/components/stages";
import { EXPERIENCE_WINDOW_MS, experienceSummary, formatMinutes } from "@/lib/reports";
import { getStore } from "@/lib/store";

type Props = {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ profile?: string }>;
};

// Generated guides appear after deploy, so slugs not known at build time still render.
export async function generateStaticParams() {
  return (await getAllGuides()).map((g) => ({ slug: g.slug }));
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const guide = await getGuide((await params).slug);
  if (!guide) return {};
  const p = defaultProfile(guide);
  const title = `${guide.app.name} OAuth setup`;
  const description = `${p.intent}. ${STAGE_NAMES[1]}: ${p.verdict.stage1.band}. ${STAGE_NAMES[2]}: ${p.verdict.stage2.band}.`;
  return { title, description, openGraph: { title, description } };
}

function pickProfile(guide: Guide, requested?: string): Profile {
  return guide.profiles.find((p) => p.id === requested) ?? defaultProfile(guide);
}

const CHECKPOINT = "checkpoint";
// Short names for the summary line; the provider is shown by the app's own name.
const SHORT_PARTY = { tenant_admin: "Customer admins", you: "You" } as const;

type Linked<T> = T & { claimIds: string[]; stepId?: string };

// Files each item under its stepId, or else under the first step that shares a source with it;
// the rest stay unlinked.
function fileUnderSteps<T>(items: Linked<T>[], steps: Step[]) {
  const byStep = new Map<string, Linked<T>[]>();
  const unlinked: Linked<T>[] = [];
  for (const item of items) {
    const step = item.stepId
      ? steps.find((s) => s.id === item.stepId)
      : steps.find((s) => s.claimIds.some((c) => item.claimIds.includes(c)));
    if (step) byStep.set(step.id, [...(byStep.get(step.id) ?? []), item]);
    else unlinked.push(item);
  }
  return { byStep, unlinked };
}

export default async function GuidePage({ params, searchParams }: Props) {
  const guide = await getGuide((await params).slug);
  if (!guide) notFound();
  const profile = pickProfile(guide, (await searchParams).profile);

  const pick = <T extends { id: string }>(pool: T[], ids: string[]) =>
    ids.map((id) => pool.find((x) => x.id === id)).filter((x): x is T => Boolean(x));
  const steps = pick(guide.steps, profile.stepIds);
  const requirements = pick(guide.requirements, profile.requirementIds);
  const limits = pick(guide.limits, profile.limitIds);
  const headsUp = fileUnderSteps([...guide.nuances, ...profile.facts.configGotchas], steps);
  const troubles = fileUnderSteps(pick(guide.blockers, profile.blockerIds), steps);
  const t = guide.technical;
  const { stage1: v1, stage2: v2 } = profile.verdict;
  const storageKey = `guide-checks:${guide.slug}:${profile.id}`;
  const store = await getStore();
  const reported = store
    ? experienceSummary(await store.reportsSince(guide.slug, new Date(Date.now() - EXPERIENCE_WINDOW_MS).toISOString()).catch(() => []))
    : null;

  const view = (s: Step): StepView => ({
    id: s.id,
    title: s.title,
    who: OWNER_LABELS[s.owner],
    owner: s.owner,
    humanGate: s.humanGate && GATE_LABELS[s.humanGate],
    agentCanDo: s.owner === "agent",
    estimateMinutes: s.estimateMinutes,
    instructions: s.instructions,
    links: s.links,
    uiLabelsMayBeStale: s.uiLabelsMayBeStale,
    headsUp: (headsUp.byStep.get(s.id) ?? []).map((g) => g.text),
    troubleshooting: (troubles.byStep.get(s.id) ?? []).map(({ symptom, cause, fix }) => ({ symptom, cause, fix })),
  });
  const stage1 = steps.filter((s) => s.stage === 1);
  const stage2 = steps.filter((s) => s.stage === 2);
  const paid = profile.facts.paidAccessRequired.value;

  const stage1Ids = stage1.map((s) => s.id);
  const stage2Ids = stage2.map((s) => s.id);
  const blockers = profile.blockedBy.map((b) => (b.party === "provider" ? guide.app.name : SHORT_PARTY[b.party]));

  return (
    <article className="guide">
      <header className="guide__header">
        <p className="guide__back">
          <Link href="/">← All guides</Link>
        </p>
        <div className="guide__title-row">
          <h1>{guide.app.name}</h1>
          <p className="guide__actions">
            <a className="btn btn--primary" href={guide.app.developerPortalUrl} rel="noreferrer" target="_blank">
              Open console <Icon name="external" />
            </a>
            <a className="btn" href={guide.app.primaryDocsUrl} rel="noreferrer" target="_blank">
              Docs <Icon name="external" />
            </a>
          </p>
        </div>
        <p className="guide__intent">{profile.intent}</p>
        {guide.profiles.length > 1 && (
          <nav aria-label="Profiles" className="profiles">
            {guide.profiles.map((p) => (
              <Link key={p.id} href={`?profile=${p.id}`} aria-current={p.id === profile.id ? "page" : undefined}>
                {p.intent}
              </Link>
            ))}
          </nav>
        )}
        <p className="bottom-line">{profile.bottomLine}</p>
        <GlanceTiles
          glance={{
            cost: paid === true || profile.blockerTags.includes("cost") ? "paid" : paid === false ? "free" : "unknown",
            blockers: [...new Set(blockers)],
            reported: reported ? `${formatMinutes(reported.minMinutes)}–${formatMinutes(reported.maxMinutes)} (${reported.count} reports)` : undefined,
          }}
        />
        {guide.generator && (
          <p className="notice">
            AI-generated by {guide.generator.model} on <time dateTime={guide.generator.generatedAt}>{guide.generator.generatedAt}</time>.
            It passed automated checks but hasn&apos;t been reviewed by a person.
          </p>
        )}
        <ReportProblem slug={guide.slug} target="verdict" />
      </header>

      <GuideFlow
        storageKey={storageKey}
        stations={[
          {
            id: "stage1",
            title: STAGE_NAMES[1],
            meta: v1.band,
            doneWhen: stage1Ids,
            progressIds: stage1Ids,
            content: (
              <>
                <p className="station__summary">
                  <Rich text={splitHeadline(v1.summary)[0]} brief />
                </p>
                <p className="scopes">
                  <span className="muted">Scopes</span>
                  {profile.scopes.map((s) => (
                    <code key={s.name} title={s.purpose}>
                      {s.name}
                    </code>
                  ))}
                </p>
                <StageChecklist steps={stage1.map(view)} slug={guide.slug} storageKey={storageKey} />
              </>
            ),
          },
          {
            id: "checkpoint",
            title: "Checkpoint",
            doneWhen: [CHECKPOINT],
            content: (
              <CheckItem id={CHECKPOINT} storageKey={storageKey}>
                <Rich text={profile.stage1DoneWhen.text} />
              </CheckItem>
            ),
          },
          {
            id: "stage2",
            title: STAGE_NAMES[2],
            meta: v2.band,
            doneWhen: stage2Ids.length > 0 ? stage2Ids : [CHECKPOINT],
            progressIds: stage2Ids,
            content: (
              <>
                <p className="station__summary">
                  <Rich text={splitHeadline(v2.summary)[0]} brief />
                  {v2.time.range && <span className="muted"> Time: {v2.time.range}.</span>}
                </p>
                {requirements.length > 0 && (
                  <details className="ready">
                    <summary>Have these ready ({requirements.length})</summary>
                    <ul className="plain">
                      {requirements.map((r) => (
                        <li key={r.id}>
                          <strong>{r.label}</strong>
                          {r.agentCanDraft && (
                            <span className="row__hint" title="An agent can draft this">
                              {" "}
                              <Icon name="agent" label="An agent can draft this" />
                            </span>
                          )}
                          <span className="muted"> {r.howToPrepare}</span>
                        </li>
                      ))}
                    </ul>
                  </details>
                )}
                <StageChecklist steps={stage2.map(view)} slug={guide.slug} storageKey={storageKey} />
              </>
            ),
          },
          {
            id: "live",
            title: "Live",
            doneWhen: [...stage1Ids, CHECKPOINT, ...stage2Ids],
            content: <LiveSummary limits={limits.map(({ what, value }) => ({ what, value }))} risks={profile.topRisks} />,
          },
        ]}
      />

      <details className="more">
        <summary>
          <h2>More details</h2>
          <span className="muted">Technical facts, other heads-ups, and what isn&apos;t confirmed yet</span>
        </summary>

        <section aria-labelledby="technical">
          <h3 id="technical">Technical facts</h3>
          <dl className="facts-list">
            <dt>OAuth</dt>
            <dd>{t.oauthVersion}</dd>
            <dt>PKCE</dt>
            <dd>{t.pkce}</dd>
            <dt>Client secret</dt>
            <dd>{t.clientSecretHandling}</dd>
            <dt>Access token lifetime</dt>
            <dd>{t.accessTokenLifetime ?? "unknown"}</dd>
            <dt>Refresh tokens</dt>
            <dd>
              {String(t.refreshTokens.supported)}
              {t.refreshTokens.expiry && <> · {t.refreshTokens.expiry}</>}
              {t.refreshTokens.notes && <> · {t.refreshTokens.notes}</>}
            </dd>
            <dt>Redirect URI rules</dt>
            <dd>{t.redirectUriRules.join("; ") || "none documented"}</dd>
            {t.authorizationUrl && (
              <>
                <dt>Authorization URL</dt>
                <dd>
                  <code>{t.authorizationUrl}</code>
                </dd>
              </>
            )}
            {t.tokenUrl && (
              <>
                <dt>Token URL</dt>
                <dd>
                  <code>{t.tokenUrl}</code>
                </dd>
              </>
            )}
            {profile.facts.testModeLimits && (
              <>
                <dt>Test mode</dt>
                <dd>{profile.facts.testModeLimits.text}</dd>
              </>
            )}
          </dl>
        </section>

        {(headsUp.unlinked.length > 0 || troubles.unlinked.length > 0) && (
          <section aria-labelledby="other-heads-up">
            <h3 id="other-heads-up">Other heads-ups</h3>
            <ul>
              {headsUp.unlinked.map((g) => (
                <li key={g.text}>{g.text}</li>
              ))}
            </ul>
            {troubles.unlinked.map((b) => (
              <div key={b.id} className="trouble">
                <p className="trouble__symptom">If you see: {b.symptom}</p>
                <p className="muted">Likely cause: {b.cause}</p>
                <p>Fix: {b.fix}</p>
              </div>
            ))}
          </section>
        )}

        <section aria-labelledby="not-found">
          <h3 id="not-found">Not confirmed yet</h3>
          {guide.notFound.length === 0 ? (
            <p className="muted">Nothing listed.</p>
          ) : (
            <ul>
              {guide.notFound.map((n) => (
                <li key={n.item}>
                  <strong>{n.item}:</strong> {n.why}
                </li>
              ))}
            </ul>
          )}
        </section>
      </details>
    </article>
  );
}
