import { describe, expect, it } from "vitest";
import { closestSentence } from "../lib/agent/evidence";

const page = [
  "# Authentication",
  "",
  "Access Tokens expire after 2 hours. Use the refresh token to get a new one.",
  "- PKCE is recommended for web apps but **not enforced**.",
  "Rate limits: 500 requests per user per minute on paid plans.",
].join("\n");

describe("closestSentence", () => {
  it("finds the page sentence sharing the most words with the quote", () => {
    expect(closestSentence("access tokens are valid for 2 hours", page)).toBe("Access Tokens expire after 2 hours.");
    expect(closestSentence("PKCE is required for all apps", page)).toBe("PKCE is recommended for web apps but not enforced.");
  });

  it("uses the claim statement too when the quote alone is too short", () => {
    expect(closestSentence("rate limit", page, "Paid plans allow 500 requests per user per minute")).toBe(
      "Rate limits: 500 requests per user per minute on paid plans.",
    );
  });

  it("returns null when nothing on the page is close", () => {
    expect(closestSentence("webhooks retry five times", page)).toBeNull();
    expect(closestSentence("anything", "")).toBeNull();
  });

  it("trims very long sentences around the matching words", () => {
    const long = `${"Filler words that do not matter here. ".repeat(3)}${"word ".repeat(60)}The token lifetime is two hours for every client ${"word ".repeat(60)}.`;
    const hit = closestSentence("token lifetime is two hours", long)!;
    expect(hit).toContain("token lifetime is two hours");
    expect(hit.split(/\s+/).length).toBeLessThanOrEqual(32);
  });
});
