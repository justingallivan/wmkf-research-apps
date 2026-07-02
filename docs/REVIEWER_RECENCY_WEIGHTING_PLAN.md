---
title: "Reviewer Recency-Weighting Plan (S223, Topic #2)"
domain: reviewer-identity
kind: plan
status: active
summary: "Owner task: Topic #2 from project-reviewer-finder-next-topics. Decisions locked with Justin S223 (see..."
canonical: false
cataloged: 2026-07-02
owner: product-engineering
related:
  - lib/utils/relevance-score.js
  - lib/services/discovery-service.js
  - lib/services/contact-enrichment-service.js
  - lib/services/orcid-service.js
---

# Reviewer Recency-Weighting Plan (S223, Topic #2)

**Status:** SHIPPED — pieces 1–2 (ranking rebalance + recency-weighted PubMed affiliation) committed S223 (`c694bcb`); pieces 3–6 (current-affiliation pinning: ORCID always-fetch-profile, Scholar author block, identity-gated `_finalize` override, UI provenance) built + Codex-confirmed S224. Two Codex post-impl rounds (HIGH: ORCID ended-employment fallback; MEDIUM: Scholar no-metrics-table author-block loss) — both fixed and re-confirmed READY TO SHIP.
**Owner task:** Topic #2 from `project-reviewer-finder-next-topics`. Decisions locked with Justin S223 (see [[project-reviewer-ranking-recency-over-citations]]).

## Problem
A potential reviewer has a long digital tail (grad → postdoc → current). The footprint is dominated by the *postdoc* stage (more papers, more presence, older highly-cited work), but the reviewer we want is the *current* role — often a new professor: sparse but correct. Two distinct failures today:

1. **Affiliation labels the dominant (postdoc-era) institution.** `DiscoveryService.extractBestAffiliationMultiVariant` (discovery-service.js:871) is documented verbatim: *"Uses the MOST COMMON affiliation across all papers, not the most recent."*
2. **Ranking rewards cumulative longevity.** `relevance-score.js` adds up to **35 pts for all-time h-index + total citations** (20+15) and **0 for recency**. h-index/citations are longevity signals (old work has had longer to accrue; h-index only grows) — they bury the new professor under the dormant-but-famous emeritus. Justin's own most-cited paper is 1999.

## Decisions (Justin, S223 — locked)
1. **Scope:** affiliation pinning (A+B) **and** ranking rebalance (C).
2. **Citations/h-index leave the rank order entirely.** They remain ONLY as (a) identity-resolver corroboration (unchanged — see [[project-reviewer-identity-resolution-phase1]]) and (b) human-facing context shown in the Workbench cards for the picker to judge seniority. No additive contribution to `relevanceScore`.
3. **Dominant rank signal = recent in-area publication activity** (~last 5 years, topic-relevant).
4. **Current-affiliation authority: ORCID > Scholar > recency-weighted PubMed.** All identity-gated (only override when the resolver trusts the match).

## Ground truth (S223 probes)
- Candidate `publications[]` carry `year` (discovery-service.js:377/434/490/554/611). **Caveat:** verified candidates keep only `finalArticles.slice(0, 5)` (line 375) — recency must be computed from the FULL article set at verification time and stashed as a numeric field, not recomputed from the truncated 5.
- Recency infra already exists: `YEARS_LOOKBACK`, `MIN_PUBLICATIONS` ("active in last 5 years"), `countRecentPublications(articles)` (line 1091) — used today only as an accept/reject filter, not for ranking.
- ORCID dated employment → `currentAffiliation` is already parsed (orcid-service.js:284) and returned by `findContact` as `orcidResult.affiliation` (line 420), but the enrichment tier **drops it** (contact-enrichment-service.js:205-232 captures id/url/email/website, never affiliation).
- Scholar `author.affiliations` + `author.email` (verified domain) are **live and populated** (S223 SerpAPI probe) but `fetchScholarMetrics` reads only `cited_by.table` — the author block is discarded.
- Two rank sites: server `/discover` (`DiscoveryService.rankAllCandidates` → `rankByRelevance`) pre-enrichment, and the Workbench client re-rank post-enrichment (`reviewer-search-logic.js`), both delegating to the shared `relevance-score.js`. **Pub years are available at BOTH** (they come from discovery, not enrichment) — so recency ranking works server-side too. Removing Scholar metrics from the score *reduces* server/client divergence (metrics were the only score input that needed enrichment).

## Design

### A. Pin current affiliation (ORCID > Scholar > PubMed-recency), identity-gated
**Sequencing (Codex BLOCKER fix):** the identity verdict is computed in `_finalize()` AFTER all tiers — so the override cannot run mid-tier. Instead: during the tiers, **collect** affiliation *candidates* (`{source, value}`) without mutating `candidate.affiliation`; let `resolveIdentity` run on the ORIGINAL affiliation (overriding earlier would corrupt the resolver's own evidence basis); then **apply the override at the END of `_finalize()`**, once the verdict is known.
- **Gate:** apply the override only when the resolver verdict is **`probable`** (PR1 cannot emit `confirmed` — `reviewer-identity-resolver.js:15`). Untrusted → keep the PubMed-derived affiliation, never "correct" to a possibly-wrong person's job (the Tsai→Nakano failure class).
- **ORCID (authority 1):** `orcidResult.affiliation` (= ORCID `currentAffiliation`). **Always fetch the full ORCID profile** (Justin S223): remove `findContact`'s public-email fast-path early-return so the profile (and thus `currentAffiliation`) is fetched even when the search record already has a public email — one extra ORCID call per candidate, accepted for reliable current-affiliation coverage.
- **Scholar (authority 2):** extend `SerpContactService.fetchScholarMetrics` to ALSO return `author.affiliations` + `author.email` from the `google_scholar_author` payload we already fetch (S223 probe confirmed both fields populated live). Used when ORCID has none. The verified-email domain is a corroborator + COI input.
- **PubMed recency-weighted (authority 3, fallback):** replace `extractBestAffiliationMultiVariant`'s most-common logic with recency weighting — weight = 1/(currentYear − pubYear + 1) summed per normalized institution, pick max; keeps the keep-biased `normalizeAffiliationForComparison`. Also fix the single-variant path (`discovery-service.js:972` returns the first variant with any affiliation, hiding a better later one).
- **Provenance + display:** store `affiliationSource` (`orcid_current` / `scholar_current` / `pubmed_recency`) so the Workbench can show "current affiliation (per ORCID)" vs an older guess. Existing institution-COI check consumes the resulting affiliation (improved accuracy is a side benefit).

### B. Recency-weighted PubMed affiliation
(Folded into A's authority-3 above — it's the fallback, not a separate stage.)

### C. Rebalance `relevance-score.js`
- **Remove** the h-index (≤20) and total-citations (≤15) additive terms, AND the raw pub-array-length term (≤20, no dates). <!-- drain-table:ignore reason=in-memory-candidate-array-field-not-the-dropped-pg-table -->
- **Add a recency term as the dominant positive — pure linear (S223 final):**
  ```
  recencyTerm = min(35, 7 * min(max(recentCount, 0), 5))   // capped linear, last-5yr, neg-clamped
  ```
  The earlier `activityFloor` (≥3 → 10) was **dropped** after the post-impl Codex pass: with `max()` semantics it was inert above count=1 and reintroduced a seniority-ish step against the recency-only intent. `recentCount` = **reuse the existing `publicationCount5yr`** field (Track A sets it from its FULL article set — `discovery-service.js:382`; alias, do NOT invent `recentPublicationCount`). Track B: backfilled in `rankAllCandidates` from merged `publications[]` years (Codex Q4 — non-zero so Track B isn't buried). Fallback in the scorer: count `publications[].year` ≥ currentYear−5 when the field is absent.
- **Keep recency and topic-match as SEPARATE terms (Codex Q1):** Claude-suggested (25), keyword/topic match (≤10), affiliation-present (10), source-corroboration (≤10). No per-paper in-area scoring — abstracts aren't stored, and a surfaced candidate is already keyword-relevant.
- **No seniority signal in the math (Justin S223):** there is no non-citation seniority input available, so a productive grad student with recent papers ranks on recency alone. Accepted — **h-index is shown in the dashboard detail pane as a human-facing seniority hint** for the picker, never summed into the score.
- **h-index/citations stay ON the candidate object** for display + the identity resolver; only their score contribution is removed. `relevance-score.js`'s existing identity-gate block becomes moot for scoring but metrics still flow to the card.

## Files touched
| File | Change |
|---|---|
| `lib/utils/relevance-score.js` | DONE (S223): Removed h-index/citations/raw-pub-count terms; added the recency term (dominant) from `publicationCount5yr`. Shared by server + client rank. |
| `lib/services/discovery-service.js` | DONE (S223): `publicationCount5yr` set for Track B too (from merged `publications[]`, lower-confidence). Replaced `extractBestAffiliationMultiVariant` most-common → recency-weighted; fixed single-variant first-match (`:972`). |
| `lib/services/contact-enrichment-service.js` | DONE (S224): collects ORCID/Scholar affiliation candidates in the tiers WITHOUT mutating `candidate.affiliation`; `_applyAffiliationOverride()` applied at the END of `_finalize()` gated on `mayPersistIdentity` (probable/confirmed); sets `affiliation`/`affiliationSource`/`priorAffiliation`; persists the effective affiliation; threads `publicationCount5yr` onto `contactEnrichment`. |
| `lib/services/orcid-service.js` | DONE (S224): removed `findContact` public-email fast-path early-return so the full profile (→ `currentAffiliation`) is always fetched (search-record email preserved as fallback); `getProfile.currentAffiliation` is now STRICTLY a no-end-date employment (no `affiliations[0]` fallback — Codex HIGH). |
| `lib/services/serp-contact-service.js` | DONE (S224): `fetchScholarMetrics` also returns `author.affiliations` (`scholarAffiliations`) + `author.email` (`scholarEmail`), parsed before the `cited_by.table` guard so a no-metrics-table profile still surfaces them (Codex MEDIUM). |
| `shared/components/reviewers/*` + `pages/reviewer-finder.js` | DONE (S224): `mergeEnrichment` + standalone merge sites promote `affiliation`/`affiliationSource`/`publicationCount5yr` to the candidate top-level; both cards show a "current (per ORCID/Scholar)" provenance badge; h-index already rendered as the human-facing seniority hint. |
| `pages/api/reviewer-finder/save-candidates.js` + `lib/dataverse/adapters/reviewer-suggestion.js` | DONE (S223/S237): persist the 0–100 `relevanceScore` to `wmkf_relevancescore` consistently, preferring it over the 0–1 `verificationConfidence`; the Dataverse field is widened to MaxValue 100 and adapter writes clamp to `[0,100]`. |
| `tests/**` | recency-score unit tests; recency-weighted-affiliation tests; ORCID/Scholar affiliation-pin gating tests. **Update** `dedup-rank-by-relevance.test.js` + `relevance-score-identity-gate.test.js` (they assert the now-removed 35-pt metrics contribution). |

## Resolutions (Codex design review + Justin, S223)
All six open questions resolved; folded into the design above.
1. **Q1 in-area composition** → recency and topic-match are **separate** score terms (no per-paper in-area; abstracts not stored). → §C.
2. **Q2 recency curve** → capped linear `min(35, 7·min(count,5))`. → §C.
3. **Q3 established floor** → **no floor in the math** (the initial `activityFloor` was dropped post-impl — inert above count=1; pure linear recency now). No seniority signal available; **h-index shown in the dashboard detail pane as a human-facing seniority hint** (Justin). A productive grad student ranks on recency alone — accepted. → §C.
4. **Q4 Track B recency** → compute `publicationCount5yr` from the merged `publications[]` (lower-confidence, non-zero) so Track B isn't structurally buried. → §C / Files.
5. **Q5 Scholar affiliation** → parse `author.affiliations`/`author.email` opportunistically from the existing payload; don't rely on it for broad coverage (ORCID + PubMed-recency carry most cases). → §A.
6. **Q6 identity-verdict sequencing (was a BLOCKER)** → collect affiliation candidates in the tiers, resolve identity on the ORIGINAL affiliation, apply the override at the **end of `_finalize()`** gated on **`probable`**. → §A.

### Codex blocking/correctness items folded in
- **BLOCKER:** override must run at the end of `_finalize()` (verdict doesn't exist mid-tier). → §A.
- Gate on **`probable`**, not `confirmed` (PR1 can't emit `confirmed`). → §A.
- Reuse **`publicationCount5yr`** (exists on Track A, already displayed); do not invent `recentPublicationCount`. → §C.
- **Always fetch the ORCID profile** (remove `findContact` public-email early-return) — else current affiliation is missing on email-fast-path hits (Justin: do the extra call). → §A / Files.
- Update the two existing tests that assert the 35-pt metrics contribution. → Files.
- `save-candidates` now persists the 0–100 `relevanceScore` (not the 0–1 `verificationConfidence`) to `wmkf_relevancescore`; Dataverse metadata is widened to MaxValue 100 and adapter writes clamp to `[0,100]` so recency rank reaches the stored Track-A score without scale-mixing (Justin S223/S237). → Files.
