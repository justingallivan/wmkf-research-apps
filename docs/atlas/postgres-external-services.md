# Postgres: external service register

[VERIFIED 2026-11-21 via PRs #668–669, Vercel inspection, and production Postgres readback] Admin → Operations → External services is deployed in production. Migrations 106–108 were applied through the canonical existing-database runner; readback confirmed 26 services, one AssemblyAI review, and no pending migrations. See [register release evidence](../audits/SERVICE_TRACKER_RELEASE_2026-11-21.md) and [manual-check release evidence](../audits/SERVICE_UPDATE_CHECKS_RELEASE_2026-11-21.md).

## Authority and schema

- `external_services`: text primary key, object-shaped JSONB `data`, positive integer `version` (initially 1), nullable `updated_by` profile foreign key, and update timestamp.
- `external_service_reviews`: UUID primary key, service foreign key, object-shaped JSONB `data`, nullable creator/updater profile foreign keys, and creation/update timestamps. Indexed by service and creation time. Reviews are editable records, not an append-only audit log.
- Migration `106_external_service_reviews.sql` owns the initial schema and seed. Migration `107_external_service_inventory_followups.sql` adds IRS Business Master File and Europe PMC without replacing existing records and appends the missing AssemblyAI benchmark reference without replacing review edits. Existing databases use `node scripts/apply-migrations.js`; fresh installation replays the manifest through the fresh-database bootstrap. Never run the fresh-install setup against an existing database.
- The checked-in seed contains public-source inventory for 26 services and one AssemblyAI review marked Implemented. These are initial reference records, not evidence of live account usage, private billing, or schema deployment. The mutable operational records live in Postgres after migration.

## Producer → persistence → consumer

| Hop | Contract |
|---|---|
| Entry | `pages/api/admin/external-services.js`: GET, PUT, and POST require `requireSuperuser`; actor attribution comes from the authenticated profile, not the request body. Responses are private/no-store; request body limit is 512 KB. |
| Validation | `lib/services/external-services/model.js`: bounded service/review fields, closed choices, Pacific-time calendar dates, at most 12 credential-free HTTPS reference links per record. Microsoft, GitHub, and Zoom retain corporate-managed excluded cost policy by seed ID and normalized provider name. |
| Writes | `lib/services/external-services/store.js`: create at expected version zero; existing saves update only the supplied current service version, incrementing it. A service and optional new/edited review commit in one transaction. Missing review or stale service version rolls back the entire save. Review updates are scoped by service ID. |
| Bounds | At most 500 services and 200 reviews per service through the store. Service creation takes a table lock before checking capacity; saves serialize on the service version. Service overflow fails explicitly; review history reads at most 200 rows. |
| Reads | Service list includes the maximum saved review date. Review history is ordered by review date, then creation time. The Admin Operations view consumes these DTOs and saves through the same guarded route. |
| Display | `serviceStatus` prioritizes Action needed; otherwise no review or a next-review date on/before today is Review due; remaining services are Current. Today is the Pacific calendar date on both server and client. A new review suggests its next date from the entered review date and cadence, preserving an explicit next-date edit. These labels describe the register schedule, not live provider health or approval authority. |

## Operational boundaries

Service and review notes must not contain secrets. This is an operator content rule, not a credential-redaction guarantee: bounded text validation cannot identify every secret. Initial committed seed content contains no private billing figures. Reference URLs are stored and displayed; the register does not fetch them.

The register records proposed, approved, or implemented decisions. Manual update checks described below make read-only provider metadata requests. Neither path makes purchases, model changes, automatic updates, or scheduled notifications. Retire is a recorded decision, not a delete operation. A failed/unavailable database returns a safe 503; the UI does not pretend an empty seed fallback is authoritative. Cancel after any failed save reloads the list and selected history, exposing committed-but-unacknowledged results and fresh versions before another edit.

## Verification limits

Verified locally: the canonical upgrade runner applied migration 107 to an isolated database already at 106; a separate fresh-database bootstrap also replayed both migrations. Both read back 26 services and one review. The 78 scoped tests cover seed parity, atomic saves, stale retries, rollback, cross-service ownership, both capacity limits, malformed requests, Pacific dates/DST, editable cadence defaults, ambiguous responses, and stable creation IDs. The production build and type check passed. Desktop and narrow-width captures used mocked API data; they are not hosted authorization or live-save proof. Operations now has eight navigation entries; the scoped UI review accepted the scrollable extension despite the design guide’s seven-tab preference.

Production deployment and schema/count readback are verified on 2026-11-21. An anonymous production API request redirects to sign-in with no-store headers. [VERIFIED via signed-in Chrome UI 2026-11-21 14:42 Pacific] Superuser inventory/history access, the AssemblyAI check, persisted result reload, and unsaved review-draft creation/cancellation passed. Saving a human review was not exercised. The AssemblyAI review preserves its source evidence and quality-observation limitations; no recordings were reprocessed for this release.

## Manual update checks — deployed

[VERIFIED via PR #669, Ready production deployment, and production schema readback 2026-11-21] The manual action adds `POST {action: "check", id}` to the same superuser route, originally restricted to `assemblyai`, `anthropic`, and `serpapi`. The OpenAI extension is included in the deployed runtime: migration `109_openai_service_checks.sql` expands the database and application allowlists to include `openai` (four latest rows). [VERIFIED via canonical runner and production readback 2026-11-21 16:14 Pacific] Migration 109 is applied; all three existing snapshots were preserved. OpenAI is included in the production runtime verified at PR #674; this receipt does not independently re-test its provider calls. Migration `108_external_service_checks.sql` adds one latest JSONB snapshot per supported service, initially restricted to three service IDs (later migrations expand that allowlist), with 256 KiB per snapshot (application write cap 200,000 bytes). Migration 108 was applied through the canonical runner at 22:25:28 UTC, before preview and production deployment. Readback confirmed the six-column checks table and unchanged 26-service/one-review inventory.

`check-store.js` claims an atomic 90-second lease; concurrent requests receive 409, checks completed within one minute reuse the stored result, and an expired writer cannot replace a newer result. Interrupted checks can be retried; known completion failures expire their token-fenced lease immediately when the database is reachable. `checks.js` collects independent sources and saves a fenced snapshot. Per-source success baselines survive source failures; unavailable is never interpreted as unchanged. Detected changes remain pending across repeat checks until a new or edited human review is saved after the check completed; the next check observes that review revision and clears the pending comparison. Editing service metadata alone or saving a review during a running check does not acknowledge that check’s findings. Failed sources with pending changes retain visibly dated evidence and can still seed a review draft. GET history returns the latest check, allowing recovery after a lost POST response. Missing check storage returns an explicit setup-needed state while preserving existing review history. These writes do not modify the service version, review dates, or human reviews.

`check-sources.js` reads fixed official AssemblyAI pricing/model Markdown, Anthropic model metadata plus local pricing coverage and the existing legacy Admin API billing comparison, and SerpAPI account plan/allowance. It reuses pure comparisons in `pricing-checks.js`; manual execution does not call cron handlers or send alerts. URLs supplied in register records are never fetched. HTTP reads reject redirects, cap each response at 1 MiB, and use 12-second request / 35-second collection deadlines. Pagination is bounded; failures remain visible. Local pricing SQL uses a 10-second server-side statement timeout; database connection acquisition and other persistence operations remain subject to the route/lease recovery limits. Billing fingerprints compare flagged model/token pairs and presence of local rates, excluding rolling dates, counts, and blended percentage movement; SerpAPI fingerprints compare plan name, price and limit, excluding renewal/usage movement, and known drift remains visible even when other rows cannot be compared. SerpAPI retains only explicit plan/allowance fields, excluding echoed credentials and account identity. The balance-breakdown follow-up (production-verified via PR #671 and signed-in check/reload 2026-11-21 15:34 Pacific) projects monthly searches remaining (`plan_searches_left`) and extra credits (`extra_credits`) separately alongside the provider-reported total. Missing or invalid balance fields fail the source check without replacing its prior successful baseline. The low-balance warning still uses total remaining searches; extra-credit changes do not alter the plan fingerprint. Existing saved snapshots acquire the breakdown on the next successful check; reloading alone does not refresh provider data. No model inference or recording reprocessing occurs.

The Admin panel renders plain-text evidence, timestamps, source links, changes, and unavailable sources. The first successful read establishes a baseline; source changes are evidence for a human decision, not a pricing recommendation or benchmark. Excerpts are bounded and may not show every changed passage. “Start review from findings” creates an unsaved Proposed/Investigate draft; rationale and an explicit save are still required. Changing selection invalidates late results. Corporate-managed services remain outside this initial check allowlist.

AssemblyAI public-reference checks and persisted result reload are verified through the signed-in production UI; both sources saved their first baseline at 2026-11-21T22:42:43.635Z. Anthropic and SerpAPI account checks and persisted reload passed in signed-in production on 2026-11-21 at 15:06 Pacific. Saving a human review remains unverified. OpenAI runtime is included in deployed PR #674; migration 109 is applied and verified. Its provider calls were not independently re-tested for the Neon extension. Migration 108 and the production runtime are deployed; see the release receipt above.

## OpenAI manual-check extension

The existing superuser POST, lease, independent-source failure handling, bounded snapshot and unsaved review-draft contracts apply. The model-list source uses the server-side `OPENAI_API_KEY` only for GET `/v1/models`, validates the list, and retains public-family IDs only (excluding private fine-tuned IDs and account metadata). It retains at most 500 filtered IDs of at most 100 characters per ID for comparison, including the original pending-change baseline, and displays bounded Added/Removed lists before the model preview. It fingerprints the complete filtered sorted list. Availability is not a recommendation or proof of configured use.

The local source reads seven days of `api_usage_log` with an explicit OpenAI-family model-prefix filter because the table has no provider field. Executor OpenAI runs appear only when their caller logs usage, so configured models can be missing. It shows logged request counts and missing local pricing (unpriced models first); the fingerprint excludes changing request counts. Zero rows does not establish no OpenAI use. Fine-tuned IDs and unrecognized future model families are excluded. The shared pricing table date is not an independent OpenAI-price verification. The public deprecations Markdown source fingerprints the whole normalized document and shows bounded excerpts; notices are provider-wide and not automatically matched to configured models. All provider text remains inert evidence.

Organization billing and prepaid-credit checks are deliberately excluded per owner direction (individual API-credit account). No new credential, model invocation, automatic schedule, provider settings change, or completed human review is introduced. Migration 109 changes only the service-ID constraint and preserves existing snapshots; fresh installs replay the manifest.

## Vercel hosting extension — deployed

The `vercel-hosting` inventory row gains the same manual check and unsaved review
flow. Migration `110_vercel_service_checks.sql` expands the constraint to five
service IDs, preserving the four existing providers and snapshots. It was applied
through the canonical runner before deployment of PR #673. The runtime/UI allowlists match. Other Vercel
inventory rows (Blob, Workflow, Sandbox) remain outside the check allowlist.

Three independent collectors read public Pro-plan pricing/allowances, Node.js
support/retirement guidance, and optional seven-day team usage. Public references
remove frontmatter, generated related-page navigation, and CLI boilerplate before
fingerprinting; runtime retirement links are retained separately. Runtime comparison
uses the current checker process major, not a claim about all deployments, project
settings, build overrides, or containers. Unsupported majors need attention.
Public Pro-plan terms do not establish the account's actual plan or remaining quota.

The fixed GET `/v1/billing/charges` uses dedicated server configuration documented
in `docs/CREDENTIALS_RUNBOOK.md`. It reads bounded JSONL (8 MiB for this endpoint
only; other HTTP sources retain 1 MiB), at most 12,000 rows and 200 aggregate groups,
within the existing deadlines. Invalid, empty, truncated, oversized, non-USD or
unsupported-category data fails the whole usage source and retains the prior
baseline. Only service/unit/category aggregate quantities, FOCUS effective costs,
and reported period bounds reach the snapshot; account/project names, IDs, tags,
and raw records are discarded. The configured team contributes only to the hash.
Routine quantities, spend and dates are excluded from change fingerprints; unchanged usage reads display “Usage refreshed — no spend comparison.” Signed corrections are retained, and null subscription quantities stay unknown. Reported rows may lag or be incomplete. These
are all-team/all-product figures, not app-only hosting charges, CLI gross costs,
invoices, quotas, or an automatic price comparison. No new cron, alert, provider
write, human-review save, or deployment is introduced.

[VERIFIED via local collector smoke and scoped tests, 2026-11-21] Both live public
Markdown sources parse successfully; local Node.js 26 is listed as supported.
The production project's Node.js setting was separately read as 22.x through the
Vercel CLI; this is not a hosted check of the new implementation. CLI-authorized
read-only billing discovery confirmed the public FOCUS response shape and the
need for the larger bounded body. Application credential access was subsequently verified in signed-in Admin on
2026-11-21 at 18:26 Pacific after replacing the project-scoped token with a
team-scoped token. All three sources succeeded and persisted across reload.
PR #674 added sanitized account-read failure diagnostics. The [Vercel implementation review receipt](../audits/VERCEL_SERVICE_CHECKS_REVIEW_2026-11-21.md) records the earlier build-time checks, not the current release state.


## Neon Marketplace extension — deployed

[VERIFIED via source, isolated PostgreSQL migration tests and live CLI response-shape probe, 2026-11-21] Migration `111_neon_service_checks.sql` adds `neon` to the service-ID constraint, matching the application and Admin UI allowlists (six possible latest snapshots). Existing snapshots and human reviews are preserved. Migration 111 is applied to production through the canonical runner (one applied, 107 skipped), with constraint readback confirming Neon. PR #676 is deployed in Ready production deployment `dpl_E6w9H2QbaNpn8CVWrPErWKarpatc`. Signed-in Admin verified both sources through the app token at 18:57 Pacific on 2026-11-21; result reload retained the same timestamp and evidence. No human review was saved.

`neon-sources.js` uses the existing server-side Vercel service-check token and team ID. It discovers exactly one owned Neon Marketplace installation through GET `/v1/integrations/configurations?view=account`, then reads GET `/v1/integrations/configuration/{id}` with the explicit team. Installation identifiers are validated before constructing the fixed-origin URL. No new credential, manually configured installation ID, Neon database access, or provider write is needed. The two HTTP reads share a promise only within one check; the existing response/deadline limits apply. Missing, ambiguous, inactive or mismatched installations fail visibly.

The two independent results are the quoted account plan and provider-reported interim spending for the reported billing period. Plan fingerprints include the installation scope and quoted details. Usage fingerprints include only the installation scope, so ordinary spend movement is not a pricing-change alert. Spending exposes line quantities, rates, amounts, discounts, period and provider timestamp; stale reports require attention. Totals must reconcile, malformed fields fail the source, and a failed source retains its successful baseline while the other source can succeed. Raw resource IDs, account identity, response metadata and credentials are not persisted. All database resources in the installation are included; these are not app-only costs.

The configuration endpoint is documented, but its billing fields are live-observed extensions, not a fully documented stable response contract. Dollar values follow Vercel billing; the response does not supply a currency code. This is not paid invoice history, a forecast, a quota balance, or a complete account bill. Observed Neon Marketplace spending is separate from the hosting check's FOCUS feed. No automatic schedule or human-review save is added. See the [Neon implementation receipt](../audits/NEON_MARKETPLACE_CHECKS_2026-11-21.md) for evidence and release limits.

## Cloudmersive public-reference extension — branch-built, not deployed

[VERIFIED via source and isolated PostgreSQL tests, 2026-11-21] Migration `112_cloudmersive_service_checks.sql` expands the existing constraint to seven supported service IDs by adding `cloudmersive`, matching both application and UI allowlists. Existing snapshots and human reviews are preserved. Production migration and deployment have not occurred.

`cloudmersive-sources.js` reads only the fixed public small-business pricing page, with no credential or scan request. One bounded HTML read is shared within one check. Two independently validated observations compare default monthly USD plan prices and published monthly call/rate/file-size limits, including compute-limited offerings and full qualifying footnotes. All extracted plans contribute to comparisons; navigation, scripts, form state and signup URLs do not. Missing, ambiguous or unsupported shapes fail visibly and retain prior successful baselines. The existing request, response, lease and snapshot limits apply.

Account usage and remaining quota stay explicitly marked for manual verification in the UI even before a check and when public sources fail. The notice links to the Cloudmersive portal. Successful public checks do not establish the account's subscription, balance, reset date, negotiated pricing or actual billed usage. These observations do not change application upload limits or scanner settings; one file is not assumed to equal one billable call. Existing review-draft, independent-source failure and stale-selection guards apply. See the [Cloudmersive implementation receipt](../audits/CLOUDMERSIVE_SERVICE_CHECKS_2026-11-21.md).
