# Reviewer-Finder SerpAPI → Free-Stack Migration Plan

> **Status:** PLANNED (S250) — no code written yet.
> **Author:** Justin Gallivan + Claude.
> **Date:** 2026-06-13.
> **Why:** SerpAPI is the project's largest single monthly line item (~$150/mo Production,
> ~15k calls — Justin-confirmed 2026-06-11). Its value has eroded: `google_scholar_profiles`
> is dead (Google login wall) and most academic uses are now done better by free APIs.
> Source memories: `project-serpapi-capability-erosion`, `project-serpapi-budget-latency`.
> **Binding constraint:** LATENCY, not cost (a PD won't use the tool if enriching is slower
> than Googling the names by hand). Every slice is measured in per-candidate round-trips.

## Call-site inventory (verified S250)

Seven SerpAPI engine call-sites across three services. The audit's "6 uses" groups the two
`google_scholar` literature calls (#4/#5) as one.

| # | Call-site | Engine | Purpose | Verdict |
|---|-----------|--------|---------|---------|
| 1 | `serp-contact-service.findContact` | `google` (1–5 calls w/ fallbacks) | Reviewer contact email / faculty page (Tier-4, hot path) | **KEEP** — irreplaceable |
| 2 | `serp-contact-service.findScholarProfileViaGoogle` | `google` + `site:scholar.google.com` | Resolve exact Scholar profile URL + `user=ID` | **REPLACE / DROP** (see Slice 1) |
| 3 | `serp-contact-service.fetchScholarMetrics` | `google_scholar_author` | h-index / i10 / citations + current affiliation + verified-email-**domain** hint | **REPLACE** → OpenAlex |
| 4 | `literature-search._searchGoogleScholar` | `google_scholar` | Novelty literature search | **REPLACE** → OpenAlex works |
| 5 | `literature-search._searchPIPubs` | `google_scholar` | PI publications | **REPLACE** → OpenAlex |
| 6 | `integrity-service.searchPubPeer` | `google` + `site:pubpeer.com` | PubPeer integrity | **REPLACE** → PubPeer API |
| 7 | `integrity-service.searchNews` | `google_news` | News integrity | **KEEP** — irreplaceable |

After the migration, residual SerpAPI = **#1 (contact) + #7 (news)** only. A Hobby-tier
downgrade (~$100/mo saved) becomes possible — but that is a **billing-dashboard decision**
(real call volume), out-of-repo, made *after* the code lands. Not part of any slice.

## Decisions

**Locked:**
- **Metrics source = OpenAlex, not Semantic Scholar.** OpenAlex is already in-repo
  (`openalex-service.js`), already SSRF-allowlisted, already has `getAuthorByOrcid`, and
  returns h_index **and** i10_index **and** cited_by_count via `summary_stats`/`cited_by_count`
  (verified live S250: a sample author returned h=24, i10=32, cites=5577). Semantic Scholar
  lacks i10. So OpenAlex over-covers the audit's S2 suggestion.
- **Re-source the verified-email-domain guard from OpenAlex (free, better-anchored).** Today's
  guard validates a *scraped* email's domain against a **self-reported** Scholar profile email
  domain. The OpenAlex version derives the domain from the **ORCID-resolved** author's
  institution (`last_known_institutions[0].ror` → institutions endpoint → `homepage_url`,
  verified live S250: MIT → `https://web.mit.edu` → `mit.edu`, which matches `@mit.edu` /
  `@csail.mit.edu` under the existing `_validateEmailAgainstVerifiedDomain` label-boundary
  logic). Tied to a harder identity than Scholar's. Costs one extra (free) OpenAlex call.

**Open (product call — recommendation below):**
- **Exact Scholar profile deep-link for NEW candidates (#2).** OpenAlex does **not** expose
  Google Scholar `user=` IDs, so dropping #2 means new candidates fall back to the **free**
  `buildGoogleScholarUrl` search-authors link (name+institution pre-filled — already the
  default on every candidate). Previously-enriched reviewers keep their stored exact deep-link
  (persisted on the researcher row). `googleScholarId`/`Url` are consumed only by the UI cards
  + persistence — **not contact-correctness**. **Recommendation: DROP #2** (free search link is
  enough; one paid call for a cosmetic deep-link is poor value given the cost goal). Reversible:
  re-add a single paid call later if staff miss the precise link.

## Slice 1 — Scholar metrics → OpenAlex (the contact-correctness slice)

**Files:** `lib/services/openalex-service.js`, `lib/services/contact-enrichment-service.js`,
(retire the Scholar paths in `lib/services/serp-contact-service.js`).

### Current flow (`ContactEnrichmentService._attachScholarMetrics`)
1. Guard: requires `effectiveInstitution` OR an ORCID anchor (else abstain).
2. `SerpContactService.findScholarProfile` (**paid call A**) → profile URL + `scholarId` +
   `nameMismatch`/`institutionMismatch` flags (gate persistence of a likely-wrong person).
3. `SerpContactService.fetchScholarMetrics(scholarId)` (**paid call B**) → h-index/i10/citations
   + `scholarAffiliations` (authority-2 affiliation candidate) + `scholarEmail` (verified-domain
   hint feeding `_validateEmailAgainstVerifiedDomain`).
- **= 2 paid SerpAPI calls per candidate** (independent of the Tier-4 contact search, which stays).

### New flow (OpenAlex)
1. **Resolve the OpenAlex author** (reuse the identity spine's resolution where possible):
   - ORCID anchor present → `OpenAlexService.getAuthorByOrcid(orcid)` — hard key, **no namesake
     risk**.
   - No ORCID → `OpenAlexService.searchAuthors(name)` + disambiguate by institution/topic, with
     the **same abstain-on-mismatch gating** that #2's `nameMismatch`/`institutionMismatch` flags
     provided today. Prefer reusing `reviewer-identity-resolver`/`reviewer-identity-evidence`
     rather than re-implementing. ⚠ **Verify during impl:** does the candidate already arrive
     with a resolved OpenAlex author id from discovery? If so, skip this resolution (latency win).
2. **Metrics** from the author record (requires extending `mapAuthorRecord`): set `ce.hIndex`,
   `ce.i10Index`, `ce.totalCitations`.
3. **Affiliation** (authority-2 candidate): set from `last_known_institutions[0].display_name`.
4. **Verified-domain guard** (re-sourced): `OpenAlexService.getInstitution(ror|id)` →
   `homepage_url` → registrable domain → feed `_validateEmailAgainstVerifiedDomain`.
5. **Deep-link:** leave the free `buildGoogleScholarUrl` search link (per the open decision —
   recommend DROP #2). `googleScholarId` = null for new candidates.

### Code changes
- **`openalex-service.js`:**
  - Extend `mapAuthorRecord` to surface `hIndex` (`summary_stats.h_index`), `i10Index`
    (`summary_stats.i10_index`), `citedByCount` (`cited_by_count`), and the institution ref
    (`last_known_institutions[0].ror`/`.id`) for the domain lookup.
  - New `getInstitution(rorOrId, opts)` → `{ displayName, homepageUrl, domain, ror }`
    (registrable-domain extraction from `homepage_url`).
- **`contact-enrichment-service.js`:** rewrite `_attachScholarMetrics` to the OpenAlex flow
  above; preserve the abstain-on-mismatch and identity-gated persistence semantics.
- **`serp-contact-service.js`:** retire `findScholarProfileViaGoogle` + `fetchScholarMetrics`
  (and the now-unused helpers: `institutionConflicts`, `extractScholarDisplayName`,
  `scholarNameMismatch`, `_numOrNull`) unless still referenced. `findContact` (#1) **stays**.

### Field / provenance changes (durable — reconcile)
- `affiliationSource` gains `openalex_current`; the `scholar_current` value is retired for new
  enrichments (grep consumers in `_applyAffiliationOverride` + UI before renaming the field).
- The verified-domain field (`scholarVerifiedEmail`) is now institution-homepage-derived —
  consider renaming to `verifiedInstitutionDomain`; update `_validateEmailAgainstVerifiedDomain`
  + any consumers in the same pass.
- `googleScholarId` = null for new candidates; UI must render the search link when ID absent
  (already the fallback).

### Latency
- ORCID-anchored: ≤2 free OpenAlex calls (author + institution); fewer if the author id is
  already resolved upstream. Net **win** vs. today's 2 paid sequential SerpAPI calls.
- Name-search: 1 search + disambiguation + 1 institution = ~2 free calls + namesake gating.
- OpenAlex polite pool (with `mailto`) is more generous than the ~1 rps figure in
  `project-serpapi-capability-erosion`; the ≤2 added calls are parallelizable with other
  per-candidate enrichment.

### Tests
- Unit: `mapAuthorRecord` surfaces h/i10/cites + institution ref; `getInstitution` domain
  extraction (`https://web.mit.edu` → `mit.edu`).
- `_attachScholarMetrics` (OpenAlex): ORCID-anchored happy path; name-search abstain on
  mismatch; domain-validation MATCH (recovers `@mbi-berlin.de`) and CONTRADICTION (drops
  namesake) — port the existing Scholar-domain tests; no-ORCID-no-match abstain.
- Rewrite existing serp-Scholar tests to the OpenAlex paths; keep `findContact` tests intact.

### Behavior changes to surface
- New candidates lose the exact Scholar profile deep-link (get the free search link).
- `google_scholar_author` engine no longer called → **kills the unmonitored login-wall
  degradation risk** flagged in `project-serpapi-capability-erosion`.
- Email *sourcing* is unchanged (PubMed / ORCID / Claude-web-search / SerpAPI Tier-4 all stay);
  only the metrics + domain *cross-check* move to free OpenAlex.

## Slice 2 — Literature / PI-pubs → OpenAlex

**File:** `lib/services/literature-search-service.js` (consumers: analyze / integrity novelty).
Lower contact-correctness stakes than Slice 1.
- `_searchGoogleScholar(noveltyQueries)` → OpenAlex works search (a `searchWorks(query, {yearFrom})`
  helper or `getWorkByTitle`), with `from_publication_date`/`publication_year` ≥ now−5.
- `_searchPIPubs(piDetails)` → OpenAlex author resolution (name+institution) → `getWorksByAuthor`
  (**already exists**) per PI.
- Note: OpenAlex abstracts are inverted-index — reconstruct if a snippet is needed.
- Keep the `Promise.allSettled` fan-out shape; drop the `SERP_API_KEY` branch.

## Slice 3 — PubPeer → PubPeer Developer API

**File:** `lib/services/integrity-service.js` (`searchPubPeer`). Most self-contained slice.
- **Prereqs:** (a) register for a free PubPeer Developer API key → add `PUBPEER_API_KEY` to
  `lib/utils/tracked-secrets.js` + `docs/CREDENTIALS_RUNBOOK.md`; (b) add `pubpeer.com` (or the
  API host) to the `safeFetch` allowlist (`lib/utils/safe-fetch.js`) — **not currently
  permitted**.
- ⚠ **Verify before coding:** PubPeer API endpoint shape + access terms (external claim — do not
  assume). If the API requires a paid/approved tier we don't have, this slice stays on SerpAPI
  and we revisit.
- Reshape: the API returns structured publication/comment records; feed them to the existing
  Haiku summarizer (or summarize structurally). `searchNews` (#7) stays on SerpAPI.

## Cross-cutting

- **Gates to run:** `check:atlas` (no schema change expected — fields already on the researcher
  row), `check:api-routes` (no new routes expected), `check:doc-currency`/`fact-consistency`,
  plus `npm test` + the reviewer-contact smoke scripts
  (`scripts/smoke-reviewer-contact-anchoring.mjs`).
- **Docs/memory to reconcile on completion:** `project-serpapi-capability-erosion` (record the
  OpenAlex-over-S2 choice + domain re-sourcing), the reviewer-identity / reviewer-origination
  agent-wiki topic pages, and the D26 pipeline flowchart (enrichment metrics source).
- **`/contract-reconcile`** before declaring each slice done (cross-layer: caller → enrichment →
  persistence → UI).

## Recommended sequencing
1. **Slice 1** (metrics → OpenAlex) — highest value (kills the login-wall risk, latency win, hot
   path, contact-correctness). Do first.
2. **Slice 2** (literature / PI-pubs) — straightforward, reuses `getWorksByAuthor`.
3. **Slice 3** (PubPeer) — gated on confirming the PubPeer API; can be deferred/separate.
4. **Post-migration:** confirm real SerpAPI call volume in the billing dashboard → decide on the
   Hobby-tier downgrade (Justin, out-of-repo).
</content>
</invoke>
