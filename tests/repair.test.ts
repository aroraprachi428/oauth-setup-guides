import { describe, expect, it } from "vitest";
import fixture from "./fixtures/sample-guide.json";
import { repairDraft } from "../lib/agent/repair";
import { validateGuideJson } from "../lib/guides";

const clone = () => structuredClone(fixture) as any;

describe("repairDraft", () => {
  it("leaves a valid guide unchanged", () => {
    const { draft, fixes } = repairDraft(clone());
    expect(fixes).toEqual([]);
    expect(draft).toEqual(clone());
  });

  it("fills missing lists and defaults that carry no facts", () => {
    const g = clone();
    delete g.version;
    delete g.nuances;
    delete g.steps[0].links;
    delete g.steps[0].agentMarkBasis;
    g.steps[1].instructions = "Click Apply for production.";
    delete g.profiles[0].blockedBy;
    g.profiles[0].topRisks = ["a", "b", "c", "d"];
    const { draft, fixes } = repairDraft(g);
    expect(draft.version).toBe(1);
    expect(draft.nuances).toEqual([]);
    expect(draft.steps[0].links).toEqual([]);
    expect(draft.steps[0].agentMarkBasis).toBe("expected_from_docs");
    expect(draft.steps[1].instructions).toEqual(["Click Apply for production."]);
    expect(draft.profiles[0].blockedBy).toEqual([]);
    expect(draft.profiles[0].topRisks).toHaveLength(3);
    expect(fixes.length).toBeGreaterThan(0);
    expect(validateGuideJson("tests/fixtures/sample-guide.json", { ...draft, slug: "sample-guide" }).errors).toEqual([]);
  });

  it("normalises ids and every reference to them together", () => {
    const g = clone();
    g.claims[0].id = "C_Create";
    g.steps[0].claimIds = ["C_Create"];
    g.profiles[0].facts.selfServeCreation.claimIds = ["C_Create"];
    g.profiles[0].verdict.stage1.claimIds = ["C_Create"];
    g.steps[0].id = "Create App";
    g.profiles[0].stepIds = ["Create App", "submit-review"];
    const { draft } = repairDraft(g);
    expect(draft.claims[0].id).toBe("c-create");
    expect(draft.steps[0].claimIds).toEqual(["c-create"]);
    expect(draft.profiles[0].facts.selfServeCreation.claimIds).toEqual(["c-create"]);
    expect(draft.steps[0].id).toBe("create-app");
    expect(draft.profiles[0].stepIds).toEqual(["create-app", "submit-review"]);
  });

  it("drops over-long quotes and sets the default profile when there's only one", () => {
    const g = clone();
    g.claims[1].sources[0].quote = Array(20).fill("word").join(" ");
    delete g.defaultProfileId;
    const { draft } = repairDraft(g);
    expect(draft.claims[1].sources[0].quote).toBeUndefined();
    expect(draft.defaultProfileId).toBe("files-rw");
  });

  it("never touches facts: labels, statements, bands and fact values stay as written", () => {
    const g = clone();
    g.claims[0].label = "probably"; // invalid, but a judgement call: left for the model
    g.profiles[0].verdict.stage2.band = "Quick"; // invalid band: left for the model
    g.profiles[0].facts.requiresAppReview.value = "maybe";
    g.steps[0].claimIds = ["c-does-not-exist"];
    const { draft } = repairDraft(g);
    expect(draft.claims[0].label).toBe("probably");
    expect(draft.profiles[0].verdict.stage2.band).toBe("Quick");
    expect(draft.profiles[0].facts.requiresAppReview.value).toBe("maybe");
    expect(draft.steps[0].claimIds).toEqual(["c-does-not-exist"]);
  });

  it("copes with junk without throwing", () => {
    expect(repairDraft(null as any).draft).toBeNull();
    expect(repairDraft({ steps: "x", claims: [null, 3] } as any).draft).toMatchObject({ steps: "x" });
  });
});
