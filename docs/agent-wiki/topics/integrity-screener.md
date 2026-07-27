---
agent_wiki: topic
status: active
last_verified: 2026-07-26
stale_after_days: 90
owner: integrity-screener
source_files:
  - lib/services/integrity-service.js
  - pages/integrity-screener.js
  - pages/api/integrity-screener/screen.js
  - pages/api/integrity-screener/history.js
  - pages/api/integrity-screener/dismiss.js
canonical_docs:
  - docs/APPLICATION_STATE_ATLAS.md
  - docs/REVIEWER_FINDER_SERPAPI_MIGRATION_PLAN.md
watch_paths:
  - lib/services/integrity-service.js
  - pages/api/integrity-screener/**
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
- **Source 2 — PubPeer** — name-based `site:pubpeer.com` Google search **via SerpAPI** (`searchPubPeer`).
- **Source 3 — News** — `google_news` **via SerpAPI** (`searchNews`).

Sources 2 + 3 are both gated behind one `effectiveSerpKey` today (`integrity-service.js`); the UI/export
consume a `sources.pubpeer` shape (`hasConcerns`, `summary`, `resultCount`, `searchUrl`, …) rendered in
`pages/integrity-screener.js`.

## Current UI boundaries

- The screen service saves completed runs when it receives a user profile ID, and
  authenticated history and dismissal API primitives exist.
- The current page has no History tab and does not call the history API.
- The current Dismiss handler is explicitly a placeholder: it logs and alerts but
  does not call the dismissal API. `screenApplicants` also does not read prior
  dismissals, so future-screen suppression is not implemented.
- PDF, JSON, and Markdown exports cover the current run and its source-specific
  summaries; they do not contain durable dismissal records.

## Durable Memory

- SerpAPI cost/posture: `project-serpapi-budget-latency`, `project-serpapi-capability-erosion`.
- External platform verification posture: `feedback-verify-external-platform-claims`, `feedback-cite-ground-truth`.

## SerpAPI migration status (S251)

The reviewer-finder SerpAPI→free-stack migration (`docs/REVIEWER_FINDER_SERPAPI_MIGRATION_PLAN.md`)
moved the reviewer-finder metrics/literature paths to OpenAlex. For the integrity screener, **PubPeer
(#6) and News (#7) remain on SerpAPI** — News is an irreducible keeper (no free equivalent), and
PubPeer is the parked future item below. Retraction Watch was already free.

## Parked Future Item — Migrate PubPeer Off SerpAPI (Contingent; Recall Only on Request)

> This is a low-priority, externally gated maybe, not active work. Recall it only if Justin asks
> or PubPeer responds about API access. The old "Slice 3" label for this is retired.

**The problem:** we'd like PubPeer integrity to use precise DOI/PMID lookups instead of a fuzzy,
name-based Google search via the (being-retired) SerpAPI. **But there is no usable sanctioned API.**
Verified S251 from primary sources:
- PubPeer's FAQ (`pubpeer.com/static/faq`) says an API is **"coming soon — contact us for a key"**:
  not generally available, no published endpoint/terms.
- The ONLY working programmatic surface is the **official browser extension's undocumented endpoint**
  (`PubPeerFoundation/PubPeerBrowserExtensions`, `js/contentScript/pubpeer.js`):
  `POST https://pubpeer.com/v3/publications?devkey=PubMed<BrowserName>`, `Content-Type: application/json`,
  body = DOIs/PMIDs, response `{ feedbacks: [...] }`. The `devkey` (`PubMed<Browser>`) is **hardcoded
  into the public extension** — NOT a per-developer key issued to us.

**Decision (S251):** PubPeer stays on SerpAPI. A sanctioned-access request **email was sent to PubPeer**
(volume pitched: ≈1 batched request per person vetted, ~hundreds per review cycle, cacheable). Do **NOT**
call `/v3/publications` server-side without explicit sanction.

**Load vs authorization (why the direct endpoint is not the current route — two axes, opposite ways):**
- *Load:* the SerpAPI `site:pubpeer.com` route hits **Google's index, not PubPeer** → zero real-time load
  on PubPeer. The `/v3/publications` endpoint is the ONLY route that touches PubPeer's DB. So the Google
  route is *lighter* on PubPeer — "gentler on their infrastructure" is the WRONG argument.
- *Authorization:* querying Google's public index is unambiguously fine; calling PubPeer's undocumented
  endpoint with **their extension's** devkey, for a use it wasn't offered for (batch server screening, not
  interactive per-pageview), with no permitting terms, is the grey part.
- The real reasons to want sanctioned access are **accuracy** (DOI-based vs fuzzy name search) and
  **consent/durability** (our own key, won't break on an extension build) — not load.

**If/when sanctioned access is granted, the build (per the migration plan's Slice-3 scope) is:** add
`PUBPEER_API_KEY` to `lib/utils/tracked-secrets.js` + `docs/CREDENTIALS_RUNBOOK.md`; add the API host to
the `safeFetch` allowlist; reshape `searchPubPeer` to DOI/PMID lookups feeding the existing Haiku
summarizer; **split the PubPeer + News availability gating** (currently one `effectiveSerpKey`) so News can
run while PubPeer is unconfigured and vice-versa; and **preserve the `sources.pubpeer` shape** the
integrity UI/export consume. Applicant DOIs/PMIDs already come from the PubMed/OpenAlex enrichment data
(no extra PubPeer calls to obtain them).

**Verification posture:** the S250 plan scoped a "PubPeer Developer API" migration around an API that
doesn't exist. Confirm external capabilities from primary sources before scoping work around them.
