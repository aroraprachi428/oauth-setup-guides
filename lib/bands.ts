import { STAGE2_BANDS, type BlockerTag, type ClaimLabel, type Guide, type Profile, type ReviewFacts, type Stage2Band } from "./schema";

// The rubric: code, not authors, decides the floor for Stage 2 and which
// blocker tags must be present. Authors may be stricter, never milder.

const rank = (b: Stage2Band) => STAGE2_BANDS.indexOf(b);
const yes = (f: { value: boolean | string }) => f.value === true;

export function stage2Floor(facts: ReviewFacts): { band: Stage2Band; reason: string } {
  if (yes(facts.partnerProgramGated)) return { band: "Gated", reason: "partner program gated" };
  if (yes(facts.paidAccessRequired)) return { band: "Gated", reason: "paid access required" };
  if (yes(facts.legalEntityRequired)) return { band: "Gated", reason: "legal entity required" };
  if (yes(facts.requiresSecurityAssessment)) return { band: "Weeks or more", reason: "security assessment required" };
  if (yes(facts.requiresAppReview)) return { band: "Days", reason: "app review required" };
  if (yes(facts.requiresBusinessVerification)) return { band: "Days", reason: "business verification required" };
  return { band: "None documented", reason: "no gating facts" };
}

export function derivedTags(facts: ReviewFacts): BlockerTag[] {
  const tags: BlockerTag[] = [];
  if (yes(facts.requiresAppReview)) tags.push("review");
  if (yes(facts.requiresSecurityAssessment)) tags.push("security_assessment");
  if (yes(facts.requiresBusinessVerification)) tags.push("business_verification");
  if (yes(facts.paidAccessRequired)) tags.push("cost");
  if (yes(facts.partnerProgramGated)) tags.push("partner_approval");
  return tags;
}

export function rubricIssues(profile: Profile): string[] {
  const issues: string[] = [];
  const floor = stage2Floor(profile.facts);
  if (rank(profile.verdict.stage2.band) < rank(floor.band)) {
    issues.push(
      `profile ${profile.id}: Stage 2 band "${profile.verdict.stage2.band}" is milder than the rubric floor "${floor.band}" (${floor.reason})`,
    );
  }
  for (const tag of derivedTags(profile.facts)) {
    if (!profile.blockerTags.includes(tag)) issues.push(`profile ${profile.id}: facts imply blocker tag "${tag}"`);
  }
  if (profile.blockerTags.includes("none") && derivedTags(profile.facts).length > 0) {
    issues.push(`profile ${profile.id}: tagged "none" but facts imply blockers`);
  }
  return issues;
}

export function guideRubricIssues(guide: Guide): string[] {
  return guide.profiles.flatMap(rubricIssues);
}

export type EvidenceCounts = Record<ClaimLabel, number>;

export function evidenceCounts(guide: Guide): EvidenceCounts {
  const counts: EvidenceCounts = { verified: 0, reported: 0, uncertain: 0, tested: 0 };
  for (const c of guide.claims) counts[c.label]++;
  return counts;
}

export function defaultProfile(guide: Guide): Profile {
  return guide.profiles.find((p) => p.id === guide.defaultProfileId) ?? guide.profiles[0];
}
