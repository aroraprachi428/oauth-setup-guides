# Corrections log

For each lead from the earlier research, this log records whether it was confirmed, corrected or discarded, with the primary source. All retrievals were on 2026-10-23.

## Dropbox

**Lead:** "Development status allows ~500 users; at 50 linked users a ~2-week window starts to get production approval or new links are blocked."

**Outcome: confirmed, with three corrections and additions.**

| Part of the lead | Result | Source |
|---|---|---|
| ~500 users in development | Confirmed: up to 500 linked users. | [Developer guide](https://docs.dropboxapi.com/dropbox-api/docs/developer-resources/developer-guide), verified |
| 50 users starts a ~2-week window | Confirmed: exactly two weeks to apply for *and receive* approval. | Developer guide, verified; [Developer support](https://www.dropbox.com/developers/support), verified |
| New links blocked after the window | Confirmed, and only production approval unfreezes the app. Unlinking users doesn't help. | Developer guide, verified |
| *Missing from lead:* starting state | Added: a new app can link only the developer's own account until you click **Enable additional users**. "500" isn't available by default. | Developer guide, verified |
| *Missing from lead:* review timing | Added: requests aren't reviewed until 50 users have linked, unless you use **Request early review**. Dropbox says it answers nearly all requests "within a few business days". | Developer guide and Developer support, verified |
| *Not confirmed:* existing users keep working when frozen | Seen only in a community-moderator snippet. The forum page couldn't be fetched (JS-rendered), so it's kept as `uncertain`. | [Community thread](https://community.dropbox.com/discussions/101000014/ability-to-link-new-users-frozen-at-0-linked-users/492523), unfetchable |
| *Not confirmed:* team apps capped at 5 teams in development | Forum user report only. The page couldn't be fetched, so it's kept as `uncertain`. | [Community thread](https://community.dropbox.com/en/discussion/846671/does-a-dropbox-app-have-a-limit-on-development-users), unfetchable |

**What was wrong or stale in earlier sources:**
- The search results cited `www.dropbox.com/developers/reference/developer-guide`. That URL now 301-redirects to `docs.dropboxapi.com`, and the old domain's HTTP docs page returned only navigation chrome.
- Nothing in the lead was factually wrong, but it implied the 500-user ceiling is available from the start. It isn't.

## Linear

**Lead:** "Linear refresh tokens became mandatory around April 2026, with ~24h access tokens."

**Outcome: confirmed, with more precision.**

| Part of the lead | Result | Source |
|---|---|---|
| Refresh tokens mandatory around April 2026 | Confirmed: all OAuth2 apps were migrated to the new refresh-token system on April 1, 2026. | [OAuth 2.0 authentication](https://linear.app/developers/oauth-2-0-authentication.md), verified |
| ~24h access tokens | Confirmed: 24 hours (example `expires_in` 86399). | Same page, verified |
| *Added:* rotation | Each refresh returns a new refresh token, and a lost response can be replayed within a 30-minute grace period. | Same page, verified |

**What was wrong or stale:**
- "Around April 2026" is exactly April 1, 2026, and Linear calls it a migration, not a new requirement.
- Vendor guides (Nango) still describe an opt-in "Refresh Tokens" toggle, an Oct 1, 2025 date and 10-year legacy tokens. All of that predates the migration.
- Linear documents no refresh-token lifetime. Expiry after inactivity is vendor-reported only.

## QuickBooks

**Lead:** "Production keys need a compliance questionnaire; sandbox and production keys are separate."

**Outcome: confirmed, with corrections to the wording and to how strong the evidence is.**

| Part of the lead | Result | Source |
|---|---|---|
| Sandbox and production keys are separate | Confirmed: Development keys work only with sandbox companies, Production keys only with production companies. | [IntuitDeveloper/OAuth2.0-demo-php](https://github.com/IntuitDeveloper/OAuth2.0-demo-php) (Intuit-owned GitHub), verified |
| Production keys need a compliance questionnaire | Confirmed but `reported`: the "app assessment questionnaire" must be accepted before production keys unblock, including for unlisted apps. Intuit's own statement was only seen in a search snippet. | [Apideck](https://developers.apideck.com/connectors/quickbooks/docs/application_owner+app_compliance), [Railz](https://help.railz.ai/en/articles/6289296-how-to-request-quickbooks-online-production-access), Intuit blog (snippet) |
| *Implied:* the questionnaire is the only gate | Corrected: app details are also prerequisites (EULA, privacy policy, host, launch and disconnect URLs, verified developer profile). | [Codat](https://docs.codat.io/integrations/accounting/quickbooksonline/qbo-app-assessment-questionnaire), reported |

**What was wrong or stale:**
- Intuit calls it the "app assessment questionnaire". It has a Compliance section, but it isn't named a compliance questionnaire.
- The lead left out the yearly re-review for listed apps and for apps with more than 500 connections.
- The lead left out that read calls are metered CorePlus calls, capped on the free Builder tier.
- Sources disagree on where the questionnaire lives in the portal, so the UI has likely changed.
- **Evidence caveat:** Intuit's developer.intuit.com doc pages are JS-rendered and couldn't be read. The verified claims rely on Intuit-owned GitHub repos, SDK docs and the OIDC discovery document.

## Shopify

**Lead:** "Installs are per shop; protected customer data has access tiers; a distribution method must be chosen before requesting access."

**Outcome: all three parts confirmed, with additions.**

| Part of the lead | Result | Source |
|---|---|---|
| Installs are per shop | Confirmed: both the authorize and token calls run against `{shop}/admin/oauth/...`, and tokens are stored per shop. | [Authorization code grant](https://shopify.dev/docs/apps/build/authentication-authorization/access-tokens/authorization-code-grant), verified |
| Protected customer data has access tiers | Confirmed: Levels 0, 1 and 2, with each Level 2 field (name, email, phone, address) requested separately. Public apps need review at both levels; custom apps get them without review. | [Protected customer data](https://shopify.dev/docs/apps/launch/protected-customer-data), verified |
| Distribution must be chosen before requesting access | Confirmed, including for dev stores. The choice can't be changed later. | Protected customer data page and [Distribution](https://shopify.dev/docs/apps/launch/distribution), verified |

**What was wrong or stale:**
- The lead didn't say the distribution choice is permanent.
- App creation moved to the Dev Dashboard (generally available August 2025), but protected-customer-data and `read_all_orders` requests are still documented in the Partner Dashboard.
- New public apps must use expiring offline tokens: 1-hour access token, 90-day rotating refresh token. Existing public apps must switch by 2027-01-01. Older guides describe non-expiring offline tokens.

## Microsoft

**Lead:** "Multi-tenant apps show 'Unverified' without publisher verification; tenant admin consent can block users."

**Outcome: confirmed, with a correction to how admin consent blocks users.**

| Part of the lead | Result | Source |
|---|---|---|
| Multi-tenant apps show "Unverified" without publisher verification | Confirmed: the consent prompt shows "Unverified" in place of a publisher name. | [Application consent experience](https://learn.microsoft.com/en-us/entra/identity-platform/application-consent-experience), verified |
| Tenant admin consent can block users | Confirmed, and broader than the lead said. Tenant consent settings, the Microsoft-managed default policy, user-assignment requirements and risk-based step-up can each force admin consent. | [Manage app consent policies](https://learn.microsoft.com/en-us/entra/identity/enterprise-apps/manage-app-consent-policies), [Risk-based step-up](https://learn.microsoft.com/en-us/entra/identity/enterprise-apps/configure-risk-based-step-up-consent), [Configure user consent](https://learn.microsoft.com/en-us/entra/identity/enterprise-apps/configure-user-consent), verified |
| *Brief:* a 2025 change restricted user consent to low-risk permissions or verified publishers | Corrected: the Microsoft-managed policy is an exclusion list, and it excludes Mail.\*, Calendars.\*, Files, Sites, Contacts and Tasks permissions from user consent. The low-risk / verified-publisher rule is a separate built-in policy (`microsoft-user-default-low`). Notice MC1097272 was seen only in a third-party snippet. | Manage app consent policies, verified (I re-read this page myself on 2026-10-23) |

**What was wrong or stale:**
- The lead implied publisher verification fixes user consent. It doesn't. In new tenants on the Microsoft-managed default, users can't consent to Mail.Read or Calendars.Read whether or not the publisher is verified, so admin consent is the main path.
- "Admin consent required: No" in the Graph permissions reference doesn't mean users can consent, because tenant policy overrides it.
- Two official pages conflict. Configure user consent implies users can consent to mailbox access by default; the consent policies page says the new-tenant default excludes Mail.Read.
- Labels have drifted: "Multiple Entra ID tenants" in the current quickstart versus "Accounts in any organizational directory" on older pages.

## Gmail

**Lead:** "Restricted scopes require an annual third-party security assessment; cost figures conflict sharply between vendor pages and first-hand accounts."

**Outcome: confirmed, with corrections.** The assessment is tied to storing or sending restricted data through servers, and Google's only official cost figure sits on its Health API page.

| Part of the lead | Result | Source |
|---|---|---|
| gmail.readonly is restricted | Confirmed | [Gmail API scopes](https://developers.google.com/workspace/gmail/api/auth/scopes), verified |
| Annual security assessment | Confirmed: every 12 months from the Letter of Validation's effective date, as a full test each time. | [support.google.com/cloud/answer/13465431](https://support.google.com/cloud/answer/13465431), [13463816](https://support.google.com/cloud/answer/13463816), verified |
| Third-party assessor | Confirmed: App Defense Alliance CASA, carried out by authorized labs. | [CASA tiering](https://appdefensealliance.dev/casa/casa-tiering), [Authorized labs](https://www.appdefensealliance.org/certification/authorized-labs), verified |
| Required for every restricted-scope app | Corrected: tied to storing or transmitting restricted data on servers. Testing, personal-use and internal apps are exempt. | [Restricted scope verification](https://developers.google.com/identity/protocols/oauth2/production-readiness/restricted-scope-verification), verified |
| Cost figures conflict | Confirmed. Google says $500–$4,500, payable to the lab, but only on its Health API page. Reports range from $540/yr to $40k. The $15k–$75k figure traces back to 2019–2020. | [Google Health API verification](https://developers.google.com/health/app-verification), verified; [Google Groups thread](https://groups.google.com/g/google-apps-script-community/c/XgsHT2Fr7u8) and [Latenode](https://community.latenode.com/t/is-casa-tier-2-assessment-necessary-for-all-gmail-api-apps-options-for-indie-developers/22861), reported |

**What was wrong or stale:**
- "Tier 2/Tier 3" naming is partly stale. CASA and the Google help pages now use AL1/AL2, while the Health API page still says tier-2/tier-3.
- The Tier 2 self-scan was reportedly ended in May 2024, so older "free self-scan" advice is out of date.
- The $15k–$75k figure comes from Google's 2019 announcement as cited by vendors, not from any current Google page.
- Google uses two names for the result: "Letter of Validation" in the help center and "Letter of Assessment" in the User Data Policy.

## LinkedIn

**Lead:** "LinkedIn needs a legal entity, a verified LinkedIn Page, and a screencast for some tiers; a rejected app may not be able to reapply; information is scattered."

**Outcome: corrected.** Most of the lead applies only to the Community Management API (posting as an organization), not to member posting through Share on LinkedIn.

| Part of the lead | Result | Source |
|---|---|---|
| Legal entity required | Corrected: only Community Management needs one. The API Terms let individual members build apps, and `w_member_social` is an Open Permission available to all developers. | [Community Management app review](https://learn.microsoft.com/en-us/linkedin/marketing/community-management-app-review), [API Terms](https://www.linkedin.com/legal/l/api-terms-of-use), [Getting access](https://learn.microsoft.com/en-us/linkedin/shared/authentication/getting-access), verified |
| Verified LinkedIn Page | Partly confirmed: every app is tied to a Page, and a Page super admin approves that link within 30 days. The separate Verify step is required for Community Management; official help doesn't say Share on LinkedIn needs it. | [Associate an app with a Page](https://www.linkedin.com/help/linkedin/answer/a548360/associate-an-app-with-a-linkedin-page?lang=en), verified |
| Screencast for some tiers | Confirmed, but only for Community Management Standard tier. Share on LinkedIn has no tiers. | Community Management app review, verified |
| A rejected app may not be able to reapply | Corrected: for Community Management you can't reapply with the same app, but you can create a new app and request access again. Share on LinkedIn has no review to be rejected from. | Community Management app review, verified |
| Information is scattered | Confirmed: split across learn.microsoft.com, linkedin.com/help and linkedin.com/legal. Guidance on `ugcPosts` vs the Posts API conflicts. | [Share on LinkedIn](https://learn.microsoft.com/en-us/linkedin/consumer/integrations/self-serve/share-on-linkedin), [Posts API](https://learn.microsoft.com/en-us/linkedin/marketing/community-management/shares/posts-api), verified |

**What was wrong or stale:**
- Community Management requirements (legal entity, business email, screencast, vetting) were applied to member posting.
- "Can't reapply" left out LinkedIn's documented route: create a new app and request access again.
- "Verified Page" mixed up two steps: linking the app to a Page (every app) and Page verification (some products only).
- The lead missed the constraints that actually apply to member posting: no refresh token, re-auth every 60 days, per-member daily rate limits, and an API Terms clause against automated posting.

## X

**Lead:** "X has had pay-per-use pricing since early 2026, and the free tier is effectively gone; read-cap figures conflict."

**Outcome: confirmed, with corrections to detail.**

| Part of the lead | Result | Source |
|---|---|---|
| Pay-per-use since early 2026 | Confirmed: launched Feb 6, 2026 with the new console.x.com, after a closed pilot from Oct 20, 2025. | [X changelog](https://docs.x.com/changelog.md), verified |
| Free tier effectively gone | Confirmed: the official pricing and free-credits pages describe no free tier. Promotional credits require a purchase first (since Oct 13, 2026). Free access for public-utility apps appears only in news coverage. | [Pricing](https://docs.x.com/x-api/getting-started/pricing.md), [Free credits](https://docs.x.com/x-api/getting-started/free-credits.md), verified; [roboin.io](https://roboin.io/article/en/2026/02/08/x-transitions-api-to-pay-per-use-model-ending-free-plan/), reported |
| Read-cap figures conflict | Confirmed. Official docs say 3M post reads per billing cycle; a third-party page (updated Sep 2, 2026) says 2M. | [Post cap](https://docs.x.com/x-api/fundamentals/post-cap.md), verified; [SocialCrawl](https://www.socialcrawl.dev/blog/x-twitter-api-2026), reported |

**What was wrong or stale:**
- The official cap is 3M; the 2M figure is third-party only.
- "Free tier gone" needs a nuance: legacy Free users got a one-time $10 voucher, and promo credits require spending money first.
- Post-write prices changed on Apr 16, 2026, so older figures such as $0.01 per post are stale.
- A third party says legacy Basic and Pro were deprecated (Jun 1 and Sep 1, 2026). X's forum posts returned 403, so this is unconfirmed.
