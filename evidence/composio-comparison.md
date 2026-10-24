# Composio comparison (step E)

This compares each guide with Composio's public auth guide for the same app, at `composio.dev/auth/<app>`. All pages were retrieved on 2026-10-23. None of Composio's pages show a date.

Composio's guides are a reference here, not a source of provider facts. They're written for a different job: registering an app that points at Composio's callback URL and pasting the credentials into a Composio auth config. So "missing" below means missing for a developer who brings their own app to real users. It isn't a criticism of what those pages set out to do.

**Coverage:** 7 of the 8 apps have a Composio guide. QuickBooks has none on the [auth index](https://composio.dev/auth), which lists 46 guides.

## Patterns across all seven

1. **Stage 1 only.** No Composio guide covers what happens after the first connection: user caps, review, verification, security assessments, costs or what happens when a limit is hit. The one exception is Google's "you may need to submit the app for Google verification."
2. **Scopes are mostly unnamed.** Four guides (Gmail, LinkedIn, X, and Microsoft beyond its list) say the "default scopes" are pre-filled. Where scopes are named, they're broader than the default intent needs (Linear `admin`, Shopify `write_*`, Microsoft `Mail.Send`).
3. **Token behavior is missing:** no lifetimes, refresh behavior, rotation or PKCE. Our guides found recent changes for four providers: Linear (refresh tokens for every app since 2026-04-01), Shopify (expiring offline tokens required), X (2-hour tokens, `offline.access`) and LinkedIn (no refresh token, 60 days).
4. **Callback URLs differ between guides.** Some use `backend.composio.dev/api/v1/auth-apps/add` (Gmail, Linear, X) and others `/api/v3/toolkits/auth/callback` (Dropbox, Shopify, Outlook, LinkedIn). This may be deliberate, but a reader copying across guides could register the wrong one.

## Dropbox ([composio.dev/auth/dropbox](https://composio.dev/auth/dropbox) vs `content/guides/dropbox.json`)

| Area | Composio | Our guide |
|---|---|---|
| App creation | Scoped access → App folder or Full Dropbox → name | Same, plus the branding name rules and the name lock after production approval |
| Scopes | Examples, plus a long list Composio supports (includes `sharing.*`, `contacts.*`, `file_requests.*`) | The four scopes the intent needs; `account_info.read` is mandatory |
| Refresh tokens | Not mentioned | `token_access_type=offline` is needed or there's no refresh token. Refresh tokens don't rotate and don't expire by default. |
| Dev vs production | Not mentioned | Only your own account can link at first; up to 500 in development; production approval is needed within two weeks of the 50th user, or new links freeze |
| Stale or wrong | Nothing found | Dropbox's own old `dropbox.com/developers/reference` links now redirect, so older third-party links are stale |

## Gmail ([composio.dev/auth/googleapps](https://composio.dev/auth/googleapps) vs `content/guides/gmail.json`)

| Area | Composio | Our guide |
|---|---|---|
| Console path | "APIs & Services → OAuth consent screen", which opens the "Auth Platform dashboard". Onboarding wizard: App Information, Audience (Internal/External), Contact Information. | Google Auth Platform sections: Branding, Audience, Data Access, Clients. Composio's path still leads there, but the label is older. |
| Scopes | None named ("default scopes are usually sufficient") | `gmail.readonly`, declared under Data Access. It's Restricted, as is every mail-reading scope. |
| Testing mode | Add test users | Up to 100 test users, and their refresh tokens expire after 7 days in Testing |
| Verification | "may need to submit the app for Google verification" | Brand verification (domain verified in Search Console, homepage, privacy policy), restricted-scope review (demo video, justification), annual CASA assessment by an authorized lab, and the 100-user lifetime cap for unverified apps |
| Cost and time | Not mentioned | Google: "several weeks", and lab fees of $500–$4,500 (Health API page only). Reports range from $540/yr to $40k. |
| Tenant admins | Not mentioned | Workspace admins can block or limit the app through API controls (`admin_policy_enforced`) |
| Extra in Composio | Authorized JavaScript origins (`platform.composio.dev`) | Not needed for a server-side code flow |

**Biggest gap:** someone following Composio's Gmail guide to a production launch would hit the 100-user lifetime cap without having been warned about restricted-scope verification or CASA.

## Linear ([composio.dev/auth/linear](https://composio.dev/auth/linear) vs `content/guides/linear.json`)

| Area | Composio | Our guide |
|---|---|---|
| Where | Settings > API > new OAuth application | Same, but Linear's own admin docs label it Settings > Administration > API (`uiLabelsMayBeStale`) |
| Distribution | Not mentioned | Apps are private to the owning workspace by default. You must turn on Public or other workspaces can't install. |
| Scopes | Default set includes `admin`, `read`, `write`, `issues:create`, `comments:create` | `read`, `write`, `issues:create`. `admin` isn't needed and can't be combined with `actor=app`. |
| Tokens | Not mentioned | 24-hour access tokens; rotating refresh tokens for every app since 2026-04-01; a 30-minute replay grace period |
| Tenant gate | Not mentioned | Workspaces on paid plans can require admin approval for third-party apps |
| Extra in Composio | A "GitHub username" field and a token-generation toggle | Not found in Linear's docs; may be from older UI |

## Shopify ([composio.dev/auth/shopify](https://composio.dev/auth/shopify) vs `content/guides/shopify.json`)

| Area | Composio | Our guide |
|---|---|---|
| Where | Shopify Admin → "App Development" → "Build apps in Dev Dashboard" → Create App → set App URL, scopes, Redirect URL → Release | Same Dev Dashboard flow. Both are current, since the Dev Dashboard became generally available in August 2025. |
| Scopes | `read_orders`, `write_orders`, `read_products`, `write_products` (+ customers, inventory) | `read_orders` (last 60 days only), `read_all_orders` (separate approval), plus protected customer data access |
| Distribution | Not mentioned | You must pick Public or Custom before requesting protected data, and you can't change it later. Custom covers one store or one Plus org only. |
| Protected customer data | Not mentioned | Orders count as protected customer data. Public apps need review at both Level 1 and Level 2; unapproved fields come back null. |
| Tokens | Not mentioned | New public apps must use expiring offline tokens (1-hour access, 90-day rotating refresh); existing apps must switch by 2027-01-01 |
| Review | Not mentioned | Public distribution needs Shopify's review, even for unlisted apps (Shopify staff on the forum). 2026 developer reports put it at 18 days to 1.5 months. |
| Connecting | Asks for the store subdomain | Same per-shop authorize URL, plus HMAC and `state` validation of the callback |

## Microsoft ([composio.dev/auth/outlook](https://composio.dev/auth/outlook) vs `content/guides/microsoft.json`)

| Area | Composio | Our guide |
|---|---|---|
| Console | Azure portal → App registrations | Microsoft Entra admin center → App registrations. Both still work; Microsoft's docs now lead with Entra. |
| Account types | "Any organizational directory and personal Microsoft accounts" | Multitenant (work/school). Add personal accounts only if you need Outlook.com users, which lowers redirect URI limits. |
| Permissions | `Mail.Read`, `Mail.Send`, `offline_access`, `openid`, `profile`, `email` | `Mail.Read`, `Calendars.Read`, `offline_access`, `User.Read`, `openid` (the intent covers calendar; no send) |
| Public client flows | Turns on "Allow public client flows" | Not needed for a confidential web app using a client secret. Composio's step widens the app's surface. |
| Client secret | Recommends 6–12 month expiry | Maximum 24 months; Microsoft recommends under 12 |
| Admin consent | Not mentioned | In new tenants the Microsoft-managed default policy stops users from consenting to `Mail.Read` and `Calendars.Read`, so a tenant admin must grant consent. Unverified multitenant apps also trigger risk-based step-up to admin approval. |
| Publisher verification | Not mentioned | Optional and free, but needs a verified Microsoft AI Cloud Partner Program account (3–5 business days) |
| Extra in Composio | Optional "Allow only certain tenants (Preview)" | Not covered in our guide, which is a gap on our side worth adding |

## LinkedIn ([composio.dev/auth/linkedin](https://composio.dev/auth/linkedin) vs `content/guides/linkedin.json`)

| Area | Composio | Our guide |
|---|---|---|
| App creation | Name, Company page URL, logo, accept terms | Same fields, plus: a Page super admin must approve the link within 30 days, and an app can never move to another Page |
| Products | Not mentioned | You must add Share on LinkedIn and Sign In with LinkedIn using OpenID Connect on the Products tab. Without them the scopes aren't available. |
| Scopes | None named | `openid`, `profile`, `email`, `w_member_social` (all Open Permissions, no review) |
| Tokens | Not mentioned | 60-day access token; no refresh token outside approved partners, so members must re-authorize every 60 days |
| Limits and terms | Not mentioned | 150 requests per member per day and 100k per app per day. API Terms 3.1(26) prohibits automating posting. |
| API version | Not mentioned | Posts API needs a `LinkedIn-Version` header, and versions are retired about a year after release |

## X ([composio.dev/auth/twitter](https://composio.dev/auth/twitter) vs `content/guides/x.json`)

| Area | Composio | Our guide |
|---|---|---|
| Console | console.x.com → Apps → Create App → User authentication settings | Same console. Our step labels are from a third-party guide (`uiLabelsMayBeStale`). |
| Scopes | Pre-filled, not named | `tweet.read`, `users.read`, `tweet.write`, `offline.access`, `media.write` |
| PKCE and tokens | Not mentioned | PKCE is required even for confidential clients. The code must be exchanged within 30 seconds; tokens last 2 hours; refresh tokens need `offline.access`. |
| Callback rules | One callback URL | Exact match, at most 10 URLs, and `127.0.0.1` rather than `localhost` for local development |
| Pricing | Not mentioned | Pay-per-use with prepaid credits and no free tier. Requests are blocked at zero balance. 3M post reads per billing cycle. Enterprise is required beyond "a limited number of end-users". |
| Possible errors in Composio | Its auth-config step asks for a bearer token that step 1 never produces, and it mentions "Facebook authentication settings" | n/a |

**Biggest gap:** Composio's guide never mentions that X API calls need prepaid credits.

## Where Composio's guides are ahead of ours

- **Microsoft:** the optional "Allow only certain tenants (Preview)" restriction. Our guide doesn't cover it.
- **Shopify:** Composio's Dev Dashboard flow matches ours step for step, and the "Release" step is clearly explained.
- **All seven:** each finishes with a concrete "connect and see Active / Connection Successful" check. Our `stage1DoneWhen` plays the same role with a raw API call.
