import { describe, expect, it } from "vitest";
import fixture from "./fixtures/sample-guide.json";
import { derivedTags, evidenceCounts, rubricIssues, stage2Floor } from "../lib/bands";
import { GuideSchema } from "../lib/schema";

const guide = () => GuideSchema.parse(structuredClone(fixture));

describe("rubric", () => {
  it("floors app review at Days", () => {
    expect(stage2Floor(guide().profiles[0].facts).band).toBe("Days");
  });

  it("floors a security assessment at Weeks or more", () => {
    const p = guide().profiles[0];
    p.facts.requiresSecurityAssessment.value = true;
    p.blockerTags.push("security_assessment");
    expect(rubricIssues(p).join()).toMatch(/milder than the rubric floor "Weeks or more"/);
    p.verdict.stage2.band = "Weeks or more";
    expect(rubricIssues(p)).toEqual([]);
  });

  it("treats partner, paid and legal-entity gates as Gated", () => {
    for (const k of ["partnerProgramGated", "paidAccessRequired", "legalEntityRequired"] as const) {
      const p = guide().profiles[0];
      p.facts[k].value = true;
      expect(stage2Floor(p.facts).band).toBe("Gated");
    }
  });

  it("does not raise the floor on unknown facts", () => {
    const p = guide().profiles[0];
    p.facts.requiresAppReview.value = "unknown";
    expect(stage2Floor(p.facts).band).toBe("None documented");
  });

  it("requires tags implied by facts", () => {
    const p = guide().profiles[0];
    p.blockerTags = ["user_cap"];
    expect(rubricIssues(p).join()).toMatch(/facts imply blocker tag "review"/);
    p.facts.paidAccessRequired.value = true;
    expect(derivedTags(p.facts)).toContain("cost");
  });

  it("rejects 'none' when facts imply blockers", () => {
    const p = guide().profiles[0];
    p.blockerTags = ["none"];
    expect(rubricIssues(p).join()).toMatch(/tagged "none"/);
  });

  it("counts claims by label", () => {
    expect(evidenceCounts(guide())).toEqual({ verified: 3, reported: 1, uncertain: 2, tested: 0 });
  });
});
