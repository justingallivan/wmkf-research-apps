---
name: project-reviewer-identity-resolution-phase1
description: Reviewer identity-resolution Phase 1 shipped S214 (Scholar name guard + ORCID scoring); persisted-Scholar exposure is ~3 persons, not ~330
metadata:
  type: project
---

**Phase 1 SHIPPED S214 (2026-06-02, commit 40d7327).** The forward-fix for the persistent reviewer false-match (target "Li-Huei Tsai" → her MIT lab-member "Masayuki Nakano"'s Scholar profile: institution matched, no name check). Plan: `docs/REVIEWER_IDENTITY_RESOLUTION_PLAN.md`.

What landed:
- `SerpContactService.extractScholarDisplayName()` + `scholarNameMismatch()` — strict displayed-name guard, **keep-biased** like `institutionConflicts` (only rejects on positive name-conflict evidence; unextractable title → no reject). `findScholarProfileViaGoogle` returns `nameMismatch`.
- `ContactEnrichmentService._attachScholarMetrics` skips on `nameMismatch || institutionMismatch` (records `skipped:'name_mismatch'` + `scholarIdentityStatus`).
- `save-candidates.js` + `workbench/enrich-recommended.js` — gate persistence: null the Scholar id/url + h-index/i10/citations when the tier abstained (null is a safe adapter no-op — `pruneEmpty` drops it, never erasing a prior-good value).
- `ORCIDService.findContact` — scores by strict name match (`namesMatch` on givenNames+family / creditName / otherNames), narrows by affiliation, **abstains (null)** on no-match or unresolvable ambiguity (was: first-result-with-email).
- Tests: `tests/unit/reviewer-identity-guard.test.js` (15). Reuses `ContactParser.namesMatch` (exact surname + compatible given name) — strict enough; "Tsai" vs "Nakano" already fails it.

**Ground-truth (S214 audit, `scripts/audit-persisted-scholar-identity.js`):** the plan's "~330 enriched persons" was a conflation — that was the [[project-appresearcher-collapse-post-pilot]] *affiliation* backfill (affiliation strings, no Scholar identity). Actual persisted-Scholar footprint in prod (disconfirming-count probe): **12 persons with `wmkf_googlescholarurl`** = 4 search-fallback URLs (no profile, no risk) + **8 real pinned profiles** (`citations?user=`). Only **3** of those 8 have the id in the dedicated `wmkf_googlescholarid` field; the other 5 carry the `user=` id ONLY in the URL. **The first audit-script version filtered on `wmkf_googlescholarid ne null` and so silently checked only 3 of 8** — a real falsification catch (the script now derives the id from the URL too).

Corrected audit (queries by URL, resolves the `user=` id from the URL, skips search-fallbacks) checked all **8** pinned profiles: **7 name-OK, 1 confirmed wrong match.** **Frank Noe's persisted Scholar URL points to Cecilia Clementi's profile** (`user=0na1SpQAAAAJ`; SerpAPI displayed name = "Cecilia Clementi"). Clementi's OWN row (same id, h=62) is correct → **Noe is the wrong row** (he has no metrics attached, just the bad URL). Separately, **Matthew Sigman's `wmkf_googlescholarid` field is malformed** (doubled URL) though the URL resolves to his real profile (name-OK) — a stored-value nit.

Remediation (prod writes, pending authorization): clear Noe's `wmkf_googlescholarid`/`wmkf_googlescholarurl`; normalize Sigman's id field to the clean token `e9M2kmYAAAAJ`. So retroactive cleanup was NOT moot. [[project-reviewer-identity-resolution]] Phase 2 (shared identity resolver) still unbuilt.
