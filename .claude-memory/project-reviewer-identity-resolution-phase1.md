---
name: project-reviewer-identity-resolution-phase1
description: Reviewer identity-resolution Phase 1 shipped S214 (Scholar name guard + ORCID scoring); persisted-Scholar exposure is ~3 persons, not ~330
metadata:
  type: project
  status: active
  scope: reviewer
  last_verified: 2026-06-04 via live Dataverse probe (pool ORCID 1,773 / probable 1,772 after the S219 lone-ORCID backfill)
---

> **S219 — lone-ORCID residual CLOSED.** The S215 backfill only persisted institution-corroborated ORCIDs, leaving 454 lone (name-only) ORCID rows `unresolved`. `scripts/backfill-lone-orcid-scholar.js` ran Google Scholar over those 454 and, where Scholar was CLEAN (no name/inst mismatch), fed both weak anchors (lone public ORCID + clean Scholar) through `resolveIdentity` → `probable` → wrote the ORCID. Result: **240 clean → written, 144 rejected (correctly gated), 70 no-Scholar.** Pool: ORCID 1,533→**1,773** (+240), probable 1,532→**1,772** (+240), 0 failures/conflicts, independently re-counted. Scholar used as corroborating evidence ONLY — `wmkf_googlescholarid` NOT persisted (verified null on written rows). Two Codex rounds (transient-failure suppression + fail-closed apply re-read) + a live bug fix (SerpAPI 200-with-`data.error` "no results" must map to `sch_none`, not a retryable error). Same safety adapters as S215 (fill-if-empty ORCID + writeIdentityDecision skips `confirmed`).

## Recall Rule

Read this when: working on reviewer identity resolution, Scholar/ORCID enrichment persistence, or the `wmkf_identity*` decision fields.

Do:
- Treat the deterministic resolver verdict as the gate on ALL identity-bearing writes (scholar id/url+metrics+ORCID id/url) across `save-candidates`, `enrich-recommended`, AND `saveToDatabase`.
- Use the keep-biased name/institution guards (reject only on positive conflict evidence); null-clear identity fields on downgrade via `clearIdentityFields`.
- Audit already-persisted Scholar/ORCID metrics (probe by URL, resolve `user=` id from URL) rather than trusting them; run the disconfirming-count query.

Do not:
- Assume "~330 enriched persons" have Scholar identity — that was the affiliation backfill; real persisted-Scholar footprint is ~8 pinned profiles.
- Filter an audit on `wmkf_googlescholarid ne null` alone (silently misses rows that carry the id only in the URL).
- Mark this work complete without the manual Workbench smoke (CI-green ≠ correct).

Ground truth: `docs/REVIEWER_IDENTITY_RESOLVER_PHASE2_DESIGN.md`, `docs/REVIEWER_IDENTITY_RESOLUTION_PLAN.md`, `lib/services/reviewer-identity-resolver.js`, `scripts/audit-persisted-scholar-identity.js`, `scripts/remediate-scholar-identity.js`, `tests/unit/reviewer-identity-guard.test.js`.

**Phase 2 PR1 SHIPPED S214 (2026-06-03).** The deterministic resolver landed: `lib/services/reviewer-identity-resolver.js` (`resolveIdentity` post-enrichment classifier — weak-only PR1 rules: lone weak→unresolved, 2 corroborating weak→probable, ORCID multi-match→ambiguous, Scholar name/inst-mismatch=rejected ANCHOR; confirmed/rejected not reachable in PR1). 6 `wmkf_identity*` decision fields **deployed to prod** on `wmkf_potentialreviewers` (`lib/dataverse/schema/wave6/03_*.json`; deploy was blocked ~15min by a rolling Microsoft managed-solution import wave, landed once it cleared). Verdict threaded through `enrichCandidate._finalize` → gates ALL identity-bearing writes (scholar id/url+metrics+ORCID id/url) in `save-candidates`, `enrich-recommended`, AND `saveToDatabase` (the 3rd path — Codex post-impl MUST-FIX catch); `clearIdentityFields` null-clears on downgrade; `relevance-score` counts bibliometrics only when trusted. ORCID `findContact` now returns `{status:'ambiguous'}` (was bare null). Manual `my-candidates` PATCH intentionally NOT gated (staff override). Full loop ran: design v1→v2→v3 (Codex pre-impl ×2 → READY) → impl → Codex post-impl (MUST-FIX fixed). Commits 8350551/19a9792/b6bfadc + schema 610286f/1f9b3a8. **⚠ Still needs manual Workbench smoke** (CI-green≠correct). Design/build-plan: `docs/REVIEWER_IDENTITY_RESOLVER_PHASE2_DESIGN.md` (later PRs: PubMed-cluster+faculty verification→enables `confirmed`; Postgres leads/rejected-anchor table; Perplexity Search-API lead source).

**Phase 1 SHIPPED S214 (2026-06-02, commit 40d7327).** The forward-fix for the persistent reviewer false-match (target "Li-Huei Tsai" → her MIT lab-member "Masayuki Nakano"'s Scholar profile: institution matched, no name check). Plan: `docs/REVIEWER_IDENTITY_RESOLUTION_PLAN.md`.

What landed:
- `SerpContactService.extractScholarDisplayName()` + `scholarNameMismatch()` — strict displayed-name guard, **keep-biased** like `institutionConflicts` (only rejects on positive name-conflict evidence; unextractable title → no reject). `findScholarProfileViaGoogle` returns `nameMismatch`.
- `ContactEnrichmentService._attachScholarMetrics` skips on `nameMismatch || institutionMismatch` (records `skipped:'name_mismatch'` + `scholarIdentityStatus`).
- `save-candidates.js` + `workbench/enrich-recommended.js` — gate persistence: null the Scholar id/url + h-index/i10/citations when the tier abstained (null is a safe adapter no-op — `pruneEmpty` drops it, never erasing a prior-good value).
- `ORCIDService.findContact` — scores by strict name match (`namesMatch` on givenNames+family / creditName / otherNames), narrows by affiliation, **abstains (null)** on no-match or unresolvable ambiguity (was: first-result-with-email).
- Tests: `tests/unit/reviewer-identity-guard.test.js` (15). Reuses `ContactParser.namesMatch` (exact surname + compatible given name) — strict enough; "Tsai" vs "Nakano" already fails it.

**Ground-truth (S214 audit, `scripts/audit-persisted-scholar-identity.js`):** the plan's "~330 enriched persons" was a conflation — that was the [[project-appresearcher-collapse-post-pilot]] *affiliation* backfill (affiliation strings, no Scholar identity). Actual persisted-Scholar footprint in prod (disconfirming-count probe): **12 persons with `wmkf_googlescholarurl`** = 4 search-fallback URLs (no profile, no risk) + **8 real pinned profiles** (`citations?user=`). Only **3** of those 8 have the id in the dedicated `wmkf_googlescholarid` field; the other 5 carry the `user=` id ONLY in the URL. **The first audit-script version filtered on `wmkf_googlescholarid ne null` and so silently checked only 3 of 8** — a real falsification catch (the script now derives the id from the URL too).

Corrected audit (queries by URL, resolves the `user=` id from the URL, skips search-fallbacks) checked all **8** pinned profiles: **7 name-OK, 1 confirmed wrong match.** **Frank Noe's persisted Scholar URL points to Cecilia Clementi's profile** (`user=0na1SpQAAAAJ`; SerpAPI displayed name = "Cecilia Clementi"). Clementi's OWN row (same id, h=62) is correct → **Noe is the wrong row** (he has no metrics attached, just the bad URL). Separately, **Matthew Sigman's `wmkf_googlescholarid` field is malformed** (doubled URL) though the URL resolves to his real profile (name-OK) — a stored-value nit.

**Remediation EXECUTED on prod 2026-06-02** (`scripts/remediate-scholar-identity.js --execute`, 6 writes, 0 failed): cleared Noe's wrong `wmkf_googlescholarid`/`wmkf_googlescholarurl`/metrics; backfilled the clean 12-char id token into the `wmkf_googlescholarid` field for 5 rows that had a correct URL but empty/malformed id field (Schneider, Ferguson, Pappu, Sigman, Rotskoff). Re-audit after: **7 pinned profiles, 0 mismatches** — prod clean. So retroactive cleanup was NOT moot. [[project-reviewer-identity-resolution]] Phase 2 (shared identity resolver) still unbuilt.
