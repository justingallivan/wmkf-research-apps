---
name: project-pubpeer-no-public-api
description: "VERIFIED S251 (primary sources): PubPeer has NO public/self-serve Developer API. Their FAQ says an API is 'coming soon / contact us for a key'. The ONLY programmatic surface is the browser extension's UNDOCUMENTED endpoint POST https://pubpeer.com/v3/publications?devkey=PubMed<Browser> (JSON DOIs/PMIDs → {feedbacks:[]}); the devkey is hardcoded into the public extension, NOT ours. So the S250 plan's 'PubPeer Developer API' premise was wrong — SerpAPI migration Slice 3 is BLOCKED; PubPeer integrity stays on SerpAPI; sanctioned-access email sent."
metadata:
  node_type: memory
  type: project
  status: active
  scope: reviewer
  last_verified: 2026-06-13 (S251) — FAQ + PubPeerFoundation/PubPeerBrowserExtensions source read directly
---

## Recall Rule
Read before any PubPeer integration, Slice 3 of the SerpAPI migration, or restating "PubPeer
API" capability. Pairs with [[project-serpapi-capability-erosion]] (the audit that wrongly
assumed this API exists) and the plan `docs/REVIEWER_FINDER_SERPAPI_MIGRATION_PLAN.md` (Slice 3).

## The verified facts (don't re-assume)
- PubPeer's FAQ (`pubpeer.com/static/faq`): an API is **"coming soon"** — contact them for a key.
  No published endpoint, no self-serve registration, no terms. Not generally available.
- The only WORKING programmatic surface is the **official browser extension's undocumented
  endpoint** (`PubPeerFoundation/PubPeerBrowserExtensions`, `js/contentScript/pubpeer.js`):
  `POST https://pubpeer.com/v3/publications?devkey=PubMed<BrowserName>`, `Content-Type:
  application/json`, body = the page's DOIs/PMIDs, response `{ feedbacks: [...] }`. The `devkey`
  (`PubMed<Browser>`, e.g. `PubMedChrome`) is a **hardcoded, non-secret string baked into the
  public extension** — NOT a per-developer key issued to us.

## Why this matters / the lesson
- This is a **feedback-verify-external-platform-claims** miss: the S250 plan + several S251
  summaries restated "register for a PubPeer Developer API key" as a near-ready task. It isn't —
  the API doesn't exist. Verify external-platform capabilities from primary sources BEFORE
  scoping a migration around them.

## Decision (S251)
- **PubPeer integrity (#6) STAYS on SerpAPI** (`site:pubpeer.com` via `google`). Slice 3 is BLOCKED
  until/unless PubPeer grants sanctioned access. A request email was sent to PubPeer (S251).
- **Do NOT call `/v3/publications` server-side without explicit sanction.**

## Load vs authorization (the two axes — they point OPPOSITE ways)
- **Load on PubPeer:** the SerpAPI `site:pubpeer.com` route hits **Google's index, not PubPeer** →
  zero real-time load on PubPeer. The `/v3/publications` endpoint is the ONLY route that touches
  PubPeer's DB. So the Google route is *lighter* on PubPeer — "gentler on their infrastructure" is
  the WRONG argument for wanting sanctioned access.
- **Authorization:** Google's public index is unambiguously fine to query; PubPeer's undocumented
  endpoint uses **their extension's** devkey for a use it wasn't offered for (batch server
  screening, not interactive per-pageview) with no permitting terms — that's the grey part.
- **The real reasons to want sanctioned access:** accuracy (DOI-based vs fuzzy name-based Google)
  and consent/durability (our own key, won't break on an extension build) — NOT load.
