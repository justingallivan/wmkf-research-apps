# Reviewer-Finder SerpAPI → Free-Stack Migration Plan

> **Status:** Slices 1a + 1b + 2 SHIPPED (S250–S251). Slice 3 (PubPeer) **BLOCKED** — no public
> PubPeer API exists; PubPeer stays on SerpAPI pending sanctioned access (email sent S251). See Slice 3.
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
| 6 | `integrity-service.searchPubPeer` | `google` + `site:pubpeer.com` | PubPeer integrity | **REPLACE — BLOCKED**: no public PubPeer API (see Slice 3); stays on SerpAPI |
| 7 | `integrity-service.searchNews` | `google_news` | News integrity | **KEEP** — irreplaceable |

Residual SerpAPI after Slices 1–2 = **#1 (contact) + #6 (PubPeer) + #7 (news)**. #6 would drop
only if PubPeer grants sanctioned API access (Slice 3 is BLOCKED — see below); #1 + #7 are
irreducible keepers. The bulk of the per-call volume (the per-candidate Scholar metrics, #2/#3)
is already gone, so a **Hobby-tier downgrade** (~$100/mo) is worth evaluating now — but that is a
**billing-dashboard decision** (real call volume), out-of-repo. Not part of any slice.

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

> **Split into 1a then 1b after the S250 Codex pre-impl review (HIGH).** The enrichment
> path today has **no OpenAlex author evidence**: `_finalize` calls
> `resolveIdentity(evidenceFromEnrichment(...))` with only `scholar` + `orcid` anchors
> (`reviewer-identity-resolver.js:45-68`), and `_attachScholarMetrics`
> (`contact-enrichment-service.js:667-680`) gates purely on the Scholar profile's own
> `nameMismatch`/`institutionMismatch` flags. Removing Scholar therefore removes the
> identity gate that decides whether metrics/domain may be trusted — it must be **replaced
> with an explicit OpenAlex author contract first**, not bolted on. A full OpenAlex-anchored
> spine already exists (`reviewer-identity-evidence.js` + `classifySpineEvidence`, resolver
> `1.2.0-openalex-orcid-spine`) — it runs in discovery, not enrichment. Reuse it; do not
> invent new rules.

### Slice 1a — OpenAlex author identity contract in the enrichment path (do FIRST)

**Files:** `lib/services/reviewer-identity-resolver.js`, `lib/services/reviewer-identity-evidence.js`,
`lib/services/contact-enrichment-service.js`.

**Accept/abstain rules for the OpenAlex author used to source metrics + the domain guard:**
1. **ORCID anchor present** → `OpenAlexService.getAuthorByOrcid(orcid)`. ORCID is the hard
   identity key → the strong path. **The resolver re-proves the hard key** (post-impl HIGH):
   the producer must pass both the resolved record's `orcid` and the looked-up `claimedOrcid`,
   and the anchor is accepted only when they match — a bare `acceptPath: 'orcid'` flag is
   rejected (`orcid_unproven` / `orcid_mismatch`).
2. **No ORCID** → **never accept a bare first-match `searchAuthors` hit.** Either (preferred)
   consume the **spine's already-resolved** OpenAlex author id + verdict threaded from
   discovery, or run the spine resolution (`reviewer-identity-evidence`) and require
   `mayPersistIdentity(status)` (probable/confirmed) **with the forename gate**
   (`classifySpineEvidence` `spine.forenameContradicts !== true`) before the author may be
   used. ⚠ **Verify first:** does the candidate reach enrichment carrying a spine author id?
   Today it does **not** (`contact-enrichment-service.js` has no `openAlexId`) — so this is
   either a discovery→enrichment handoff change (thread it) or an in-enrichment spine call.
3. **No accepted author** → **ABSTAIN**: no metrics, no domain-guard action,
   `scholarPersistAllowed=false`, leave the free Scholar search link. Mirrors today's
   Scholar-mismatch → skip (`contact-enrichment-service.js:667-680`).
4. **Domain guard** (`_validateEmailAgainstVerifiedDomain`, `contact-enrichment-service.js:210-241`)
   may **only** confirm (`emailPersistAllowed=true`) or drop a scraped email **when the
   OpenAlex author passed the gate** — never on an unverified name-search match. (Codex MEDIUM:
   the institution-homepage domain is only as good as the author match; the "harder identity"
   rationale holds only on the ORCID path.)

**Resolver wiring:** removing the Scholar metrics call also removes the `scholar_profile`
tierResult, so `evidenceFromEnrichment` + `scholarAnchor` (`reviewer-identity-resolver.js:45-89`)
need updating. Add/route an OpenAlex-author anchor (reuse the spine's `affiliation_match` /
`orcid_employment_corroborated` / `authorship_grounded` anchor types) so the enrichment-path
resolver verdict reflects the OpenAlex author rather than a now-absent scholar anchor. Tests for
the resolver must cover the new anchor + the abstain path.

**Concrete evidence key/DTO (Codex re-review LOW; hardened by post-impl HIGH):** the accepted
author rides on a `contactEnrichment.tierResults.openalex_author` key (replacing the
`scholar_profile` slot `evidenceFromEnrichment` reads), shape:
`{ openAlexId, displayName, lastKnownInstitution, ror, acceptPath: 'orcid' | 'spine',
orcid, claimedOrcid, identityStatus, forenameContradicts, hIndex, i10Index, citedByCount }`.
The resolver **re-proves acceptance (allowlist gating), it does not trust the producer's label**
(Slice 1a, SHIPPED `395294e` + hardening): an anchor passes ONLY when `acceptPath === 'orcid'`
**and** `normOrcid(orcid) === normOrcid(claimedOrcid)` (the hard-key proof), OR
`acceptPath === 'spine'` **and** `mayPersistIdentity(identityStatus)` **and**
`forenameContradicts !== true`. Every other shape (unknown/missing acceptPath, missing
`identityStatus`, unproven/mismatched ORCID) → rejected anchor → abstain. **1b's producer must
populate `orcid` + `claimedOrcid` on the ORCID path** (`getAuthorByOrcid` record ORCID + the
looked-up ORCID), or the resolver rejects it. `null` (no author) → no anchor → abstain.

**⚠ 1b producer authoring constraints (Codex 3rd-pass LOWs — the resolver trusts its
producer, so 1b must not feed it laundered input):**
1. **Source `orcid` + `claimedOrcid` only from the real lookup** — `claimedOrcid` = the ORCID
   we called `getAuthorByOrcid` with (already checksum-validated by that method), `orcid` =
   that record's returned ORCID. Never synthesize both from one unvalidated string: the resolver
   compares for equality but does **not** checksum/format-validate, so two identical garbage
   strings would pass `orcid_mismatch`. The upstream `getAuthorByOrcid` validation is the real
   guard — keep it on the path.
2. **Pass only the canonical `mapAuthorRecord.openAlexId`** into the DTO — never an assembled or
   user-influenced URL. The resolver's `shortOpenAlexAuthorId` extracts the first `A\d+` token
   anywhere in the string (first-match-wins, no min-length), so a non-canonical URL
   (`…/W123/A1`, `?x=A5`) could mis-extract.

### Slice 1b — metrics + domain endpoint replacement (depends on 1a) — SHIPPED (S251)

> **Implementation disposition (S251).** Built as designed below, with these resolved decisions:
> - **No-ORCID path reuses the discovery spine, does NOT re-run it.** The plan floated "in-enrichment
>   spine call vs thread from discovery"; the spine already attaches `openAlexId`+`identityStatus`
>   to candidates (`discovery-service.mapSpineVerificationResult`), so 1b reuses that verdict via a
>   new `OpenAlexService.getAuthorById` (metrics only). A candidate with neither ORCID nor a carried
>   spine author id → ABSTAIN (no metrics). This keeps the hot path at ≤2 logical lookups (the plan's
>   latency claim) — a fresh in-enrichment spine would have blown past it.
> - **Metrics decoupled from the paid `useSerpSearch` toggle.** OpenAlex is free, so metrics run
>   whenever there's an identity anchor (was gated on the SerpAPI toggle). `useSerpSearch` still gates
>   the Tier-4 `findContact` email search (#1, KEEP).
> - **Full honest field rename (Justin's call).** `scholarVerifiedEmail`→`verifiedInstitutionDomain`,
>   `scholarAffiliations`→`openAlexAffiliation`, `affiliationSource:'scholar_current'`→`'openalex_current'`,
>   `tierResults.scholar_profile`→`tierResults.openalex_author`, `_attachScholarMetrics`→`_attachOpenAlexMetrics`.
>   Reconciled across the consumer set found by grep (broader than the plan's starting list): the affiliation-
>   pin label sites (`reviewer-finder.js`, `ReviewerSearchSection.js` — added `openalex_current`→'OpenAlex',
>   kept `scholar_current` for legacy roster rows) AND the `scholar_profile.skipped` persistence fallback in
>   FOUR consumers (`saveToDatabase`, `save-candidates.js`, `enrich-recommended.js`, `reviewer-search-logic.js`).
> - **#2 dropped** (recommended): `googleScholarId=null`; new candidates keep the free search link.
> - **Shared accept gate:** `isOpenAlexAuthorAccepted` exported from the resolver so the metrics step and
>   the resolver re-proof use ONE allowlist (the domain guard runs before the resolver verdict exists, so
>   the metrics step must gate acceptance itself — no drift).
> - **New `getInstitution` + registrable-domain (eTLD+1) extractor** (curated multi-label-suffix list;
>   `web.mit.edu`→`mit.edu`, `www.ox.ac.uk`→`ox.ac.uk`). `api.openalex.org` was already SSRF-allowlisted.
> - **Serp Scholar methods KEPT** (not deleted): dormant S215/S219 scripts reference them; severed from
>   enrichment + a deprecation banner added. `findContact` (#1) stays live.
> - Tests: rewrote `contact-enrichment-scholar-metrics` + the affiliation-pin/guard/route-gate suites to
>   OpenAlex; added `openalex-service` unit tests (metrics, `getAuthorById`, `getInstitution`,
>   registrable-domain). Full suite green (166 suites / 2397 tests); offline contact-anchoring smoke green.

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
1. **Resolve the OpenAlex author per the Slice 1a contract** (above) — do **not** restate it
   loosely here: ORCID hard-key accept; no-ORCID requires the spine `mayPersistIdentity` +
   forename gate (never a bare first-match); abstain when no author passes. Steps 2–5 below run
   **only** on an author that cleared 1a.
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

### Field / provenance changes (durable — reconcile, NOT a local refactor) (Codex MEDIUM+LOW)
- **`affiliationSource` gains `openalex_current`** (retiring `scholar_current` for new
  enrichments). A new provenance value renders as **no label** unless every consumer that
  switches on `scholar_current`/`orcid_current` is updated. Explicit consumer checklist (grep
  first to confirm current — these are Codex-cited starting points, not the verified-complete
  set): `_applyAffiliationOverride`; `pages/reviewer-finder.js` (merge/save promotion,
  ~226-231, ~1068-1076, ~1120-1134); `shared/components/reviewers/ReviewerSearchSection.js`
  (~113-123, ~218-223); `shared/components/reviewers/reviewer-search-logic.js`
  (merge/prune/restore, ~59-70, ~150-163, ~224-230); Workbench card provenance labels.
- **`scholarVerifiedEmail` → `verifiedInstitutionDomain`** is **durable-fact reconciliation**,
  not an internal rename. Beyond `_validateEmailAgainstVerifiedDomain`, the name appears in:
  `scripts/smoke-reviewer-contact-anchoring.mjs` (~70-145),
  `tests/unit/contact-enrichment-affiliation-pin.test.js` (~388-445),
  `docs/REVIEWER_FACULTY_PAGE_RECOVERY_DESIGN.md` (~47-78),
  `docs/REVIEWER_CONTACT_INVITE_FEATURES_AND_PROD_TESTS.md` (~67-73). Run `/sweep`-style
  reconciliation across code + tests + smoke + docs in one pass (CLAUDE.md durable-docs rule),
  or keep the old field name to avoid the blast radius — decide explicitly, don't half-rename.
- `googleScholarId` = null for new candidates; UI must render the search link when ID absent
  (already the fallback).

### Latency / call count (Codex MEDIUM+LOW — claim corrected)
- **Cost / call-count win is real and is the claim we make:** 0 paid SerpAPI calls vs. today's
  2 paid sequential calls, replaced by **≤2 *logical* OpenAlex lookups** (author + institution).
  "Logical lookups" not "HTTP requests": `fetchJsonWithRetry` (`openalex-service.js:62-101`) may
  retry on a retryable failure, so physical attempts can exceed 2.
- **No parallelism claim.** Slice 1 is a like-for-like swap and does **not** include a
  scheduling refactor; enrichment still processes candidates sequentially and `_finalize`
  (`contact-enrichment-service.js:722-728`) still awaits metrics/domain after the Tier-3/4
  contact search. The OpenAlex lookups remain serialized exactly where the Scholar calls were —
  we claim fewer/free calls, not lower wall-clock from parallelization. (A scheduling refactor
  is a separate, later optimization if latency measurements demand it.)
- OpenAlex polite pool (with `mailto`) is more generous than the ~1 rps figure in
  `project-serpapi-capability-erosion`.

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
- **Source/key compatibility (Codex LOW):** `searchAll` returns a `googleScholar` key and each
  result carries `source: 'google_scholar'` (`literature-search-service.js:47-54`, `216-275`).
  Consumers (analyze/integrity collation) may key on those labels — make an explicit decision:
  keep the `googleScholar` key/`source` strings for compatibility, or rename and update every
  consumer in the same pass. Don't silently change the label.

### Slice 2 disposition — SHIPPED (S251)
Built as designed. Resolved decisions:
- **`searchWorks(query, {yearFrom})` helper added** to `openalex-service.js` (full-text works
  search + `from_publication_date:<year>-01-01` recency filter). `mapWorkRecord` extended with
  `citedByCount` + a reconstructed `abstract` (new `reconstructAbstract` from the inverted index;
  the literature layer truncates the snippet to 300 chars, parity with the other DBs).
- **`_searchGoogleScholar` → `_searchOpenAlexWorks`** (top-4 novelty queries, year≥now−5);
  **`_searchPIPubs`** now resolves the PI via `searchAuthors` + a distinctive-token institution
  overlap (`_pickAuthorForPI`; acronym→full-name is out of scope — best-effort, the collation
  prompt re-filters PI pubs) → `getWorksByAuthor`. `Promise.allSettled` shape kept; `SERP_API_KEY`
  branch dropped.
- **Honest source rename (Justin's call):** `searchAll` key `googleScholar` → `openAlex`;
  per-result `source: 'google_scholar'` → `'openalex'`. Reconciled the LLM-facing label in the
  collation prompt prose + the `source` enum hint + the Stage-0d intelligence prose
  (`shared/config/prompts/virtual-review-panel.js`) and the Stage-0b progress message
  (`panel-review-service.js`). The Stage-0c output schema does NOT enforce the `source` value
  (`optStr`), so no schema change. `check:prompt-injection-tagging` re-run green.
- Tests: new `tests/unit/literature-search-service.test.js`; `searchWorks`/`reconstructAbstract`
  unit tests; integration mock key `googleScholar`→`openAlex`. Full suite green (167 suites / 2413).
- Residual SerpAPI after Slice 2 = **#1 contact + #6 PubPeer + #7 news**. #6 is Slice 3.

**Codex post-impl review (`d90d4e0`) — areas 1/6 clean; `per-page` confirmed correct; 1 MEDIUM + 2 LOW folded:**
- **[MEDIUM] PI recency filter silently dropped** — `_searchPIPubs` passed `yearFrom` to
  `getWorksByAuthor`, which didn't accept it (PI pubs came back unfiltered by year, unlike the
  old `as_ylo`). Added a `yearFrom` → `from_publication_date` AND-clause to `getWorksByAuthor`
  (the spine-rescue path omits it, unchanged).
- **[LOW] PI namesake mitigation** — surfaced the *resolved* OpenAlex author's `lastKnownInstitution`
  as `resolvedInstitution` in the PI-pubs payload, and instructed the collation prompt to exclude a
  publications set whose resolvedInstitution conflicts with the proposal PI's institution (closes the
  acronym-can't-token-match gap from the prompt side).
- **[LOW] stale labels** — fixed two non-runtime "Google Scholar" references (a panel-review-service
  Stage-0b comment + `docs/VIRTUAL_REVIEW_PANEL.md`).
- **[MEDIUM→resolved] `per-page` param** — confirmed correct: all five OpenAlex methods use the
  hyphenated `per-page` and the production identity spine relies on them; not a regression.
- 3 new tests (getWorksByAuthor yearFrom filter; resolvedInstitution payload). Full suite green
  (167 suites / 2415 tests).

## Slice 3 — PubPeer → (sanctioned API) — BLOCKED, stays on SerpAPI

**File:** `lib/services/integrity-service.js` (`searchPubPeer`).

> **⚠ VERIFIED S251 — the premise was wrong.** The S250 plan assumed a "PubPeer Developer API"
> that we could register for and key into. **It does not exist as a self-serve, documented API.**
> Verified from primary sources:
> - PubPeer's own FAQ (`pubpeer.com/static/faq`) says an API is **"coming soon"** and to **contact
>   them** for a key — i.e., not generally available, no published endpoint/terms.
> - The ONLY working programmatic surface today is the **undocumented endpoint the official browser
>   extension uses** (`PubPeerFoundation/PubPeerBrowserExtensions`, `js/contentScript/pubpeer.js`):
>   `POST https://pubpeer.com/v3/publications?devkey=PubMed<BrowserName>`, JSON body of DOIs/PMIDs,
>   returns `{ feedbacks: [...] }`. The `devkey` is a **hardcoded, non-secret string baked into the
>   public extension** (e.g. `PubMedChrome`) — NOT a per-developer registered key.
>
> **Therefore Slice 3 as planned is not buildable now.** Decision (S251): **PubPeer stays on
> SerpAPI** (`site:pubpeer.com`, #6) — the plan's own escape hatch ("no API → stays on SerpAPI").
> A sanctioned-access **email was sent to PubPeer (S251)** requesting a real key/terms; if granted,
> the slice becomes buildable. Do **not** call the `/v3/publications` endpoint server-side without
> explicit sanction — see the load-vs-authorization note below.
>
> **Load vs authorization (why we did NOT just switch to the direct endpoint).** These are
> different axes and they point opposite ways:
> - *Load on PubPeer:* the SerpAPI `site:pubpeer.com` route hits **Google's index, not PubPeer** —
>   zero real-time load on PubPeer. The `/v3/publications` endpoint is the ONLY route that touches
>   PubPeer's DB. So the Google route is *lighter* on PubPeer, not heavier ("gentler on their
>   infrastructure" is the wrong argument for sanctioned access).
> - *Authorization:* querying Google's public index is unambiguously permitted; calling PubPeer's
>   undocumented endpoint with **their extension's** hardcoded devkey, for a use it wasn't offered
>   for (batch server screening, not interactive per-pageview), with no terms permitting it, is the
>   grey part. The real reasons to want sanctioned access are **accuracy** (DOI-based vs fuzzy
>   name-based Google) and **consent/durability** (our own key, won't break on an extension build).

**If/when sanctioned access is granted, the build is:**
- **Prereqs:** add `PUBPEER_API_KEY` (or the sanctioned devkey) to `lib/utils/tracked-secrets.js` +
  `docs/CREDENTIALS_RUNBOOK.md`; add `pubpeer.com` (or the API host) to the `safeFetch` allowlist
  (`lib/utils/safe-fetch.js`) — **not currently permitted**.
- Reshape: the endpoint returns structured publication/comment records; feed them to the existing
  Haiku summarizer (or summarize structurally). `searchNews` (#7) stays on SerpAPI.
- **Scope is `screenApplicants`, not just `searchPubPeer` (Codex MEDIUM).** Today both PubPeer
  and news are gated behind one `effectiveSerpKey` (`integrity-service.js:88-172`). Once PubPeer
  moves to its own key, the two sources need **separate availability gating + source-specific
  error text** in `screenApplicants` (news may run while PubPeer is unconfigured, and vice-versa).
- **Preserve the `sources.pubpeer` shape** consumed by the integrity UI/export
  (`pages/integrity-screener.js` ~190-192, ~506-519, ~635-646) — the API replacement must emit
  the same shape (`hasConcerns`, `summary`, `resultCount`, `searchUrl`, …) or update those
  renderers in the same slice.
- Note the migration is DOI/PMID-based (the endpoint keys on publication ids), so the screen would
  shift from name-based to publication-based matching — more precise, but it needs the applicant's
  DOIs/PMIDs (already available from the PubMed/OpenAlex enrichment data; no extra PubPeer calls to
  obtain them). Volume estimate for the access request: ≈1 batched request per person vetted
  (~hundreds per review cycle), cacheable per person.

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
1. **Slice 1a** (OpenAlex author identity contract in enrichment) — **SHIPPED S250.**
   Defines accept/abstain + resolver evidence. The contact-correctness foundation.
2. **Slice 1b** (metrics + domain endpoint replacement) — **SHIPPED S251.** Killed the login-wall
   risk; free/fewer calls; hot path. (Disposition under the Slice 1b heading above.)
3. **Slice 2** (literature / PI-pubs) — **SHIPPED S251.** Reuses `getWorksByAuthor`; added `searchWorks`.
4. **Slice 3** (PubPeer) — **BLOCKED**: no public PubPeer API exists (verified S251); stays on
   SerpAPI. Unblocks only if PubPeer grants sanctioned access (email sent S251). Build scope (for
   then) = `screenApplicants` source gating + integrity UI/export shape.
5. **Now (post-1–2):** confirm real SerpAPI call volume in the billing dashboard → decide on the
   **Hobby-tier downgrade** (Justin, out-of-repo). The per-candidate Scholar calls are already
   gone, so this is worth evaluating now even with PubPeer (#6) still on SerpAPI.

## Codex pre-impl review (S250) — disposition

Reviewer: `codex:codex-rescue`, against commit `a134d2e`. All findings **ACCEPTED and folded**
above (Justin: "Accept and fold"). One refinement on Codex's instruction: the latency finding is
folded by **dropping the parallelism claim** (Slice 1 stays a like-for-like swap), not by adding a
scheduling refactor.

- **[HIGH] Slice 1 OpenAlex no-ORCID identity contract underspecified** → folded into **Slice 1a**:
  explicit accept/abstain rules (ORCID hard-key accept; no-ORCID requires spine `mayPersistIdentity`
  + forename gate; abstain otherwise; never first-match), resolver evidence wiring.
- **[MEDIUM] Domain guard only "harder identity" on the ORCID path** → folded: domain guard may act
  only when the OpenAlex author passed the gate (Slice 1a rule 4).
- **[MEDIUM] Latency parallelism claim ungrounded** → folded: parallelism claim removed; claim
  cost/call-count only; "≤2 *logical* lookups".
- **[LOW] Physical HTTP attempts can exceed 2 on retry** → folded: "logical lookups" wording.
- **[MEDIUM] `openalex_current` needs UI/merge updates beyond `_applyAffiliationOverride`** → folded:
  consumer checklist expanded (reviewer-finder page, ReviewerSearchSection, reviewer-search-logic).
- **[LOW] `scholarVerifiedEmail` rename spans tests/smoke/docs** → folded: treated as durable
  reconciliation (or keep the name) — decide explicitly.
- **[MEDIUM] Slice 3 scope too narrow** → folded: scope expanded to `screenApplicants` source
  gating + `sources.pubpeer` shape compatibility.
- **[MEDIUM] Slice 1 resolver contract before endpoint replacement** → folded: the 1a/1b split.
- **[LOW] Slice 2 source/key semantics** → folded: explicit compatibility decision for the
  `googleScholar` key / `source` strings.

### Codex re-review (S250, against `885e577`) — 9/9 prior findings RESOLVED; 2 new LOWs folded
- **[LOW] Evidence key/DTO for the accepted OpenAlex author unnamed** → folded into Slice 1a
  (concrete `tierResults.openalex_author` shape below).
- **[LOW] Stray `</content>`/`</invoke>` tags at EOF** → fixed (Write artifact removed).

### Codex post-impl review of Slice 1a (`395294e`) — folded (hardening commit)
Verdict was **BLOCKED — fix before 1b**; all three fixed:
- **[HIGH] Fail-OPEN gate on unknown shapes** → inverted to an **allowlist** (prove-good): unknown/
  missing `acceptPath` (`unknown_accept_path`) and missing `identityStatus` (`identity_unknown`)
  now reject instead of passing as a strong anchor.
- **[MEDIUM] ORCID path trusted a bare flag** → resolver now requires `orcid`+`claimedOrcid` in
  the DTO and accepts only on a normalized match (`orcid_unproven`/`orcid_mismatch` otherwise).
- **[MEDIUM] Unstable id canonicalization** → `shortOpenAlexAuthorId` extracts the `A\d+` token
  from any URL/query form, so `canonicalKey`/`value` dedup is stable.
6 new fail-closed/canonicalization tests added (44 total, suites green).

### Codex 3rd-pass re-review of the 1a hardening (`8a7ce2e`) — VERDICT: CLEAN-TO-BUILD-1B
All three originals re-confirmed FIXED. Two "NOT-REPRODUCIBLE" probes (fail-anchor
classification leak; residual gate on the proven-ORCID path) confirmed the intended behavior.
Two new LOWs, both explicitly **1b authoring constraints, not 1a defects** — recorded above as
the "1b producer authoring constraints" callout (source ORCID fields from the real lookup; pass
only the canonical `mapAuthorRecord.openAlexId`). No 1a code change warranted.

### Codex post-impl review of Slice 1b (`242d96c`) — trust boundary CLEAN; 1 HIGH + 2 LOW folded
7 adversarial probes. The producer→resolver trust boundary was confirmed sound (NOT-REPRODUCIBLE:
shared accept gate has no pass/fail divergence; ORCID hard-key proof honors both 1b constraints;
metrics-gate decoupling is intentional with no correctness regression; consumer reconciliation
complete). All three actionable findings fixed (commit after `242d96c`):
- **[HIGH] Registrable-domain over-broadening.** The curated `MULTI_LABEL_SUFFIXES` list silently
  returned a bare public suffix (e.g. `edu.ph`, absent from the list) as the "verified domain", so
  the keep-biased email guard matched `anyone@x.edu.ph` and could persist a namesake email. A first
  fix (a pattern heuristic) still leaked the next omitted educational suffix (Codex 3rd pass found
  `school.ge`), so `registrableDomainFromUrl` now uses the **canonical Mozilla Public Suffix List
  via the `psl` dependency** (Justin's call) — ends the whack-a-mole class. FAILS CLOSED (null →
  guard skips) on a bare suffix, IP literal, or unparseable host. IDN/Unicode homepages remain
  fail-safe (the ASCII-only `_normalizeDomain` no-ops, never over-keeps).
- **[LOW] Track-B no-ORCID candidates missed metrics** — they carry `openAlexAuthorId`, not
  `openAlexId`. The spine-path read now falls back to `candidate.openAlexAuthorId`.
- **[LOW] OpenAlex outage was indistinguishable from no-anchor** — a non-abort lookup error left
  `tierResults.openalex_author` unset. The catch now records `{ skipped: 'openalex_error' }`
  (fail-closed for the persistence/UI fallbacks).
5 new tests (registrable-domain generalization + fail-closed; Track-B `openAlexAuthorId`; outage
marker). Full suite green (166 suites / 2402 tests).
