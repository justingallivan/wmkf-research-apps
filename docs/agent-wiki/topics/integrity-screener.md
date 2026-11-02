---
agent_wiki: topic
status: active
last_verified: 2026-11-02
stale_after_days: 90
owner: integrity-screener
source_files:
  - lib/services/integrity-service.js
  - lib/services/workbench/integrity-service.js
  - pages/integrity-screener.js
  - pages/workbench/[requestId].js
  - shared/components/workbench/IntegrityTab.js
  - pages/api/integrity-screener/screen.js
  - pages/api/integrity-screener/history.js
  - pages/api/integrity-screener/dismiss.js
  - pages/api/workbench/integrity/[requestId].js
  - pages/api/workbench/integrity/[requestId]/run.js
  - pages/api/workbench/integrity/[requestId]/review.js
canonical_docs:
  - docs/APPLICATION_STATE_ATLAS.md
  - docs/REVIEWER_FINDER_SERPAPI_MIGRATION_PLAN.md
watch_paths:
  - lib/services/integrity-service.js
  - lib/services/workbench/integrity-service.js
  - pages/api/integrity-screener/**
  - pages/api/workbench/integrity/**
  - lib/db/migrations/056_integrity_screenings_request_id.sql
  - lib/db/migrations/057_integrity_screening_reviews.sql
  - shared/components/workbench/IntegrityTab.js
update_triggers:
  - integrity screening source/provider changes
  - PubPeer API access status changes (the parked future item below)
  - SerpAPI residual / cost posture changes
---

# Integrity Screener

Use this page before work on applicant integrity screening, its data sources, or the
SerpAPI→free-stack residual (PubPeer).

## What it does

`IntegrityService.screenApplicants` (`lib/services/integrity-service.js`) checks each grant
applicant against several signals and surfaces a per-applicant `hasConcerns` flag + Haiku-written
`summary` for **human review** — it never makes an automated decision. Sources:

- **Source 1 — Retraction Watch** (local database; FREE, no SerpAPI).
- **Source 2 — PubPeer** — manual link only in policy version 3; not searched, summarized, cached or counted as evidence.
- **Source 3 — News** — `google_news` **via SerpAPI** (`searchNews`).

Only news uses `effectiveSerpKey` in policy version 3. `sources.pubpeer` carries mode=manual, searched=false, error=null, explanatory summary and a name-search link; it carries no concern count, raw results or completed-check assertion. Screens and exports retain this distinction. Source-built change is not yet deployed; [rollout receipt](../../audits/integrity-pubpeer-manual-2026-11-02.md).

## Checked-out source and production boundary

[VERIFIED via PR #604, Ready production deployment and authenticated dry-run, 2026-11-02] Accuracy fixes and the controlled refresh/retention implementation are deployed. Migration 092 is applied. Production worker is enabled with strict bearer auth. Monthly scheduling at 06:00 UTC on the 1st is owner-approved and deployed and verified in the Production cron registry. Production dry-run proposes 73,519 upstream + 2 retained records, 5,286 additions, 1,846 updates and 13 removals. The approved first publication is verified: 73,521 records and generation 1, with both retained records and a completed audit. Current evidence: `docs/audits/integrity-production-release-2026-11-02.md`.

## Current UI boundaries

- The standalone `/integrity-screener` remains the manual-name screening page. The Workbench request page has a separate Integrity tab gated by the `integrity-screener` app grant.
- In the Workbench flow, the server loads the request's Project Leader and PI/Co-PI junction contacts from Dataverse, deduplicates by contact, and supplies names and institutions to the existing screening engine. The route accepts the request GUID and does not use browser-supplied people or identities.
- The tab shows the server-resolved people before a confirmation that screening uses Claude and SerpAPI credits per person. The request-scoped service refuses an empty list, missing names, or more than 10 people; the cap is a defensive spend bound.
- New runs use source coverage version 3 and name-evidence version 2. Retraction Watch and news remain automated; PubPeer is manual-only. The engine has no automated PubPeer search method or analysis prompt. Earlier saved evidence is not rewritten.
- Completed Workbench runs are saved with a nullable `integrity_screenings.request_id`. GET returns the latest run plus newest-first history pages of 20. `beforeRunId` is a request-scoped cursor. Migration 056 supplies the linkage column and latest-by-request index; migration 057 adds append-only review decisions.
- The Workbench review endpoint allows the request's lead Program Director or a fresh-role superuser to record `approved` or `hold` on the latest run. New approval requires an unchanged current roster and complete version-3 automated coverage for Retraction Watch and News, verified dataset provenance and the explicit PubPeer manual marker. A manual PubPeer check is not an approval prerequisite. Previously recorded version-1/version-2 approvals remain historical approvals when roster and latest-decision precedence still allow it; unapproved older runs require a new screen; hold requires a note. The UI shows earlier decisions read-only. Approval means **Integrity review complete**; it records a human review after staff recommend funding and is not a funding decision or progression gate. Do not add automatic screening or an earlier gate.
- The Workbench history/review surfaces are **live since 2026-09-30** (PR #366 merged as `fdaec0b1f`, deployed to Production; S552). Migrations 056 and 057 were applied and verified by a schema probe the same day, and a read-only production smoke passed. The standalone dismiss route is owner-scoped since PR #367 (`4d482d958`).
- Standalone history and dismissal API primitives exist. The standalone page's Dismiss handler remains a placeholder: it logs and alerts but does not call the dismissal API. `screenApplicants` does not read prior dismissals, so future-screen suppression is not implemented.
- Since PR #151 (2026-09-05) the source descriptions on the page no longer say
  "(requires SERP API)" for PubPeer and News; that was a historical copy-only change. Policy version 3 subsequently removes automated PubPeer access entirely.
- The current Dismiss handler is explicitly a placeholder: it logs and alerts but
  does not call the dismissal API. `screenApplicants` also does not read prior
  dismissals, so future-screen suppression is not implemented.
- Strict (Workbench) SerpAPI empty-result rule (2026-10-01): a search counts as a complete empty result when `search_metadata.status` is `Success`, no results array is present, and **either** `search_information.{organic,news}_results_state === 'Fully empty'` **or** the known "hasn't returned any results" message is present. Anything else fails closed, including an error that arrives together with results. Live zero-result responses are recorded in `tests/fixtures/serpapi/zero-result-2026-10-01.json`. This closes PR #366 review finding 6.
- Owner decision (2026-10-01): any user holding both `integrity-screener` and `reviewers` may start a new screen on an already-approved request, which returns it to needs-review. This is intended, not a gap.
- UI, PDF and Markdown show name evidence and unverified identity, not heuristic percentages. JSON retains numeric similarity only with an explicit non-probability explanation. Older evidence is labeled as earlier rules; saved histories/counts/decisions are not rewritten. Exports expose incomplete sources and do not contain durable dismissals.

## Corpus provenance (deployed; first publication verified)

Screens fence all people’s corpus queries with a monotonic publication generation and save recorded metadata under each `sources.retraction_watch.dataset`. Changed/unverified metadata makes final corpus evidence incomplete; old runs remain version-not-recorded. The worker requires strict bearer auth, production environment and literal enablement; its owner-approved monthly schedule is deployed and verified in the Production cron registry. Migration 092 and the owner-approved first publication are verified; generation 1 has 73,521 records. The legacy importer refuses the managed schema, and cutover must also confirm no old/external writer is already running.

## Durable Memory

- SerpAPI cost/posture: `project-serpapi-budget-latency`, `project-serpapi-capability-erosion`.
- External platform verification posture: `feedback-verify-external-platform-claims`, `feedback-cite-ground-truth`.

## PubPeer access decision — owner instruction 2026-11-02

The owner supplied June 2026 correspondence: PubPeer offered paid DOI and author-name APIs, proposed real-time use without caching or AI training, and offered limited documentation/trial access. This supersedes the earlier claim that no sanctioned API exists. The logged-in account presently exposes no API menu; why is unverified. Saved screening history and LLM summarization permissions were not established by that correspondence.

The owner declines purchasing access and explicitly requested removal of automated PubPeer searches, a manual link, and a review-completion update. Do not call the undocumented extension endpoint or reuse its embedded devkey. Do not run Google site-search or AI analysis for PubPeer. Do not buy or reactivate access. Any future API integration requires a new owner decision and suitable provider terms. The previous assertion that Google-based access was unambiguously permitted is withdrawn; no legal conclusion is needed for this product decision.

Reviewer-finder contact search and integrity news remain on SerpAPI. OpenAlex migrations remain unchanged. Earlier S251 migration planning is historical. Current source/review/deployment status is tracked in the [manual-link receipt](../../audits/integrity-pubpeer-manual-2026-11-02.md).
