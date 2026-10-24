# Spot-check list

Three consequential claims per guide, with a mix of labels, for verifying by hand. Claim ids match the guide's `claims[]`.

## Dropbox (`content/guides/dropbox.json`)

| # | Claim id | Label | Claim | Where to check |
|---|---|---|---|---|
| 1 | `c-50-window` | verified | Once an app links 50 users, you have two weeks to apply for and receive production approval; after that, new links are frozen. | [Developer guide › Production approval](https://docs.dropboxapi.com/dropbox-api/docs/developer-resources/developer-guide) |
| 2 | `c-refresh-no-expiry` | verified | Refresh tokens don't expire automatically and don't rotate; a refresh returns no new refresh token. They expire only if you set `refresh_token_expiration_seconds`. | [Authorization reference › /oauth2/token](https://docs.dropboxapi.com/dropbox-api/docs/get-started/authorization) |
| 3 | `c-frozen-existing` | uncertain | A frozen app still works for accounts that were already connected. | [Community thread](https://community.dropbox.com/discussions/101000014/ability-to-link-new-users-frozen-at-0-linked-users/492523) (wasn't fetchable for me; please open it in a browser) |

## Linear (`content/guides/linear.json`)

| # | Claim id | Label | Claim | Where to check |
|---|---|---|---|---|
| 1 | `c-distribution-public` | verified | Apps are private by default (only the owning workspace can use them); `distribution: public` lets other workspaces install them. | [OAuth app manifests](https://linear.app/developers/oauth-app-manifests) (distribution field) |
| 2 | `c-third-party-approvals` | verified | On any paid plan, an admin (owner on Enterprise) can turn on Third-Party App Approvals; members then need approval to install an app. | [Third-party application approvals](https://linear.app/docs/third-party-application-approvals) |
| 3 | `c-invalid-grant-race` | reported | `invalid_grant` on refresh usually means a stale rotated refresh token, often caused by concurrent refreshes. | [Nango blog](https://nango.dev/blog/linear-oauth-refresh-token-invalid-grant) |

## QuickBooks (`content/guides/quickbooks.json`)

| # | Claim id | Label | Claim | Where to check |
|---|---|---|---|---|
| 1 | `c-refresh-rotate` | verified | Always use the newest refresh token; earlier ones expire 24 hours after a new one is issued. | [intuit/oauth-jsclient README](https://github.com/intuit/oauth-jsclient) (refresh section) |
| 2 | `c-questionnaire-apideck` | reported | Every app that connects to production QuickBooks companies, including unlisted ones, must submit the app assessment questionnaire. | [Apideck](https://developers.apideck.com/connectors/quickbooks/docs/application_owner+app_compliance) |
| 3 | `c-faq-builder-snippet` | uncertain | The free Builder tier has no platform fees and 500,000 CorePlus credits a month; calls beyond that are blocked. | [Intuit partner FAQ](https://developer.intuit.com/app/developer/qbo/docs/get-started/partner-faq) (JS-rendered, so please open it in a browser) |

## Shopify (`content/guides/shopify.json`)

| # | Claim id | Label | Claim | Where to check |
|---|---|---|---|---|
| 1 | `c-expiring-required` | verified | New public apps must use expiring offline tokens for GraphQL Admin API requests; existing public apps must switch by January 1, 2027; custom and merchant-created apps are exempt. | [Offline access tokens](https://shopify.dev/docs/apps/build/authentication-authorization/access-token-types/offline-access-tokens) (I re-read this page myself) |
| 2 | `c-unlisted-review` | reported | Shopify staff say an unlisted public app still needs Public distribution, the full review and the $19 registration, and that building a separate custom app per merchant breaks the Partner Program Agreement. | [Shopify dev community](https://community.shopify.dev/t/unlisted-shopify-app-review-required-before-installation/33101) |
| 3 | `c-redirect-https` | uncertain | HTTPS-only redirect URLs are stated only in the Shop platform's Dev Dashboard guide; whether this applies to Admin API OAuth is unconfirmed. | [Creating a client](https://shopify.dev/docs/api/shop/guides/creating-a-client) |

## Microsoft (`content/guides/microsoft.json`)

| # | Claim id | Label | Claim | Where to check |
|---|---|---|---|---|
| 1 | `c-managed-policy` | verified | The Microsoft-managed consent policy, the default for new tenants, excludes Mail.Read and Calendars.Read (among others) from user consent. | [Manage app consent policies](https://learn.microsoft.com/en-us/entra/identity/enterprise-apps/manage-app-consent-policies) ("Microsoft recommended user consent policy"; I re-read this page myself) |
| 2 | `c-community-admin-only` | reported | A Microsoft MVP said in June 2025 that for a multitenant mail app, an admin in the other organization can grant consent but its end users can't. | [Microsoft Tech Community](https://techcommunity.microsoft.com/discussions/officegraph/getting-403-unauthorized-on-graph-api-mail-access-school-project-with-consent-gi/4425817/replies/4426182) |
| 3 | `c-mc1097272` | uncertain | Message center notice MC1097272 (June 17, 2025) announced a new managed consent policy for files and sites. | [office365itpros](https://office365itpros.com/2025/06/19/app-consent-policy-user-app-consent/amp/) (seen as a snippet only; the message center needs a sign-in) |

## Gmail (`content/guides/gmail.json`)

| # | Claim id | Label | Claim | Where to check |
|---|---|---|---|---|
| 1 | `c-lifetime-cap` | verified | An unverified app requesting restricted scopes is capped at 100 new users over the project's lifetime, and the cap can't be reset. | [support.google.com/cloud/answer/15549945](https://support.google.com/cloud/answer/15549945) |
| 2 | `c-fee-official` | verified | Assessment fees of $500–$4,500 are paid to the third-party assessor. Google states this only on its Health API page. | [Google Health API verification](https://developers.google.com/health/app-verification) |
| 3 | `c-cost-quotes` | reported | Indie developers reported quotes of $15k–$40k from larger labs and about $8k from a smaller one, with 6–8 weeks once a lab is engaged (June 2025). | [Latenode community](https://community.latenode.com/t/is-casa-tier-2-assessment-necessary-for-all-gmail-api-apps-options-for-indie-developers/22861) |

## LinkedIn (`content/guides/linkedin.json`)

| # | Claim id | Label | Claim | Where to check |
|---|---|---|---|---|
| 1 | `c-open-permissions` | verified | `profile`, `email` and `w_member_social` are Open Permissions, available to all developers through the Products tab without special approval. | [Getting access](https://learn.microsoft.com/en-us/linkedin/shared/authentication/getting-access) ("Open Permissions (Consumer)" table) |
| 2 | `c-terms-automation` | verified | API Terms section 3.1(26) prohibits using the content or APIs to automate posting on LinkedIn. | [API Terms of Use](https://www.linkedin.com/legal/l/api-terms-of-use) (section 3.1, item 26) |
| 3 | `c-sub-person-urn` | reported | A post's author is built as `urn:li:person:{sub}` from `/v2/userinfo`. The official OIDC page doesn't say so, and its discovery document declares pairwise subjects. | [dev.to walkthrough](https://dev.to/broke2builtai/how-to-post-to-linkedin-from-a-script-the-15-minute-oauth-walkthrough-2026-58fp); compare [Sign In with LinkedIn](https://learn.microsoft.com/en-us/linkedin/consumer/integrations/self-serve/sign-in-with-linkedin-v2) |

## X (`content/guides/x.json`)

| # | Claim id | Label | Claim | Where to check |
|---|---|---|---|---|
| 1 | `c-enterprise-trigger` | verified | Self-serve access is for apps with "a limited number of end-users"; beyond that you must apply for Enterprise, and no number is given. | [Developer Agreement](https://docs.x.com/developer-terms/agreement.md) (sections III.L–M) |
| 2 | `c-read-cap-2m` | reported | A third party says the pay-per-use read cap is 2M a month, while X's docs say 3M. | [SocialCrawl](https://www.socialcrawl.dev/blog/x-twitter-api-2026) vs [X pricing](https://docs.x.com/x-api/getting-started/pricing.md) |
| 3 | `c-token-without-credits` | uncertain | No official page says whether the OAuth flow or `/2/users/me` works at a zero balance, or what `/users/me` costs. | [X pricing](https://docs.x.com/x-api/getting-started/pricing.md) and console.x.com billing (needs a sign-in) |
