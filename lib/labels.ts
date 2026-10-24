import type { BlockerTag } from "./schema";

// Display names for schema enums. Vocabulary only; no guide content lives here.

export const TAG_LABELS: Record<BlockerTag, string> = {
  user_cap: "User cap",
  review: "Review",
  security_assessment: "Security assessment",
  business_verification: "Business verification",
  admin_consent_or_per_tenant: "Admin consent / per-tenant install",
  cost: "Cost",
  partner_approval: "Partner approval",
  none: "None",
};

export const OWNER_LABELS = { agent: "Agent", developer: "You", provider: "Provider" } as const;

export const PARTY_LABELS = {
  provider: "The provider",
  tenant_admin: "Your users' organization admins",
  you: "You (missing paperwork or setup)",
} as const;

export const GATE_LABELS = {
  identity_check: "Identity check",
  payment: "Payment",
  legal_attestation: "Legal attestation",
  two_factor: "2FA",
  captcha: "CAPTCHA",
  review_submission: "Review submission",
} as const;
