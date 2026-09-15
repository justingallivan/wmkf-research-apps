---
title: Reviewer Institution Phase 2 Adversarial Re-review of d0f37745
domain: reviewer-identity
kind: audit
status: complete
summary: "Read-only re-review of the fix range d1c91ea6..d0f37745: all six prior findings are fully fixed with focused negative tests, every required gate and the build are green, no new merge-blocking defect was found, and the dormant-path rollout prerequisites remain open with the flag kept off."
canonical: false
cataloged: 2026-09-15
last_verified: 2026-09-15
owner: product-engineering
related:
  - docs/audits/reviewer-institution-phase2-d1c91ea6-adversarial-review-2026-09-14.md
  - docs/audits/reviewer-institution-phase2-contract-audit-2026-09-14.md
  - docs/plans/REVIEWER_INSTITUTION_AUTO_RESOLUTION_PLAN_2026-09-14.md
  - lib/services/reviewer-institution-evidence-attestation.js
  - lib/services/reviewer-independent-identity-runtime.js
  - lib/services/reviewer-institution-coi-screen.js
  - lib/services/deduplication-service.js
  - lib/services/reviewer-finder/save-candidates-service.js
  - lib/services/workbench/promote-applicant-reviewer-service.js
  - pages/api/reviewer-finder/discover.js
  - pages/api/workbench/reviewer-roster.js
---

# Adversarial re-review of d1c91ea6..d0f37745

## Executive verdict

**All six prior findings are fully fixed.** Each fix is enforced at the named
boundary, has a focused negative test that contains the dangerous value, and
survived the additional dangerous-input checks recorded below. Every required
gate, each paired self-test, and `npm run build` are green. **No new
merge-blocking defect was found.** The dormant-path rollout prerequisites from
the prior review remain open and are listed below. **Do not enable
`REVIEWER_INSTITUTION_PHASE2`.** Enabling it today would hold every ordinary
reviewer save, which the runbook now states.

Recommendation: **mergeable as a dormant, exact-off path.**

## Scope and commit range

- Worktree: `/Users/gallivan/Code/WMKF_Apps-codex`, branch
  `codex/ror-measurement-runs`, HEAD `d0f37745` (two commits ahead of origin).
- Range reviewed: `git diff d1c91ea6..d0f37745` (20 files, +407/-66).
  - `994394c3` Harden reviewer institution evidence boundaries
  - `d0f37745` Reconcile reviewer institution Phase 2 docs
- Method: `/contract-reconcile` Mode A, read-only. No implementation, test,
  plan, or existing documentation file was modified. The only write is this
  file. Scratch tests were created under `tests/unit/__scratch/`, run, and
  deleted; the worktree afterward carries only the two untracked audit files.
- Reviewer: Claude Fable 5.1, 2026-09-15. No metered review product was used.

## Findings ordered by severity

**No actionable merge-blocking findings.** The items below are residual
rollout prerequisites and hygiene notes for the dormant path; none changes
exact-off behavior.

1. **RESIDUAL (dormant path). Exact-on ordinary saves cannot succeed today.**
   No producer emits `currentness: 'current'`
   (`lib/services/discovery/affiliation.js:141` always `unknown`;
   `lib/services/discovery/provenance.js:41` yields `historical` or `unknown`),
   and the adapter now supplies no source work, so every candidate with
   author-specific assertions holds as `institution_coi_incomplete` and every
   candidate without evidence holds as `institution_evidence_required`
   (`lib/services/reviewer-finder/save-candidates-service.js:1120-1131,1165-1177`).
   The runbook row for the flag now states this [VERIFIED via
   `docs/CREDENTIALS_RUNBOOK.md:205`]. This is the intended fail-closed shape
   for a dormant path, not a defect, but it means a positive exact-on save
   path is untested because none exists.
2. **RESIDUAL. Future ORCID end year classified historical**
   (`lib/services/discovery/provenance.js:41`, unchanged in this range). A
   current appointment with a recorded future end date becomes COI-inert.
3. **RESIDUAL. `authorSpecific: 'unknown'` assertions are inert**
   (`lib/services/reviewer-institution-coi-screen.js:63-66`;
   `lib/services/deduplication-service.js:826-828`, unchanged). No producer
   emits that value today.
4. **RESIDUAL. Applicant parity gap** unchanged: the applicant screen passes
   only the applicant-known reviewer affiliation
   (`lib/services/workbench/promote-applicant-reviewer-service.js:481`), while
   ordinary save also re-reads matched CRM reviewer affiliations.
5. **RESIDUAL. Serial provider evaluation** in discover under exact-on
   (`pages/api/reviewer-finder/discover.js:663-693`) is unchanged; today it is
   cheap because the adapter short-circuits to `not_evaluable` before any
   provider call.
6. **HYGIENE. `PROJECTION_VERSION` stayed at 1** while the projection gained
   `affiliationAssertionsComplete`
   (`lib/services/reviewer-institution-evidence-attestation.js:16,161-171`).
   A token minted before the change fails as `claim_mismatch` rather than a
   version mismatch. Fail-closed and moot because the flag has never been on in
   any environment [ASSUMED per runbook], but bump the version on the next
   projection change.
7. **HYGIENE. Test coverage of the completeness bit on the applicant path is
   by code read only.** The promote suite mocks the entire screen module
   (`tests/unit/workbench-promote-applicant-reviewer-service.test.js`), so the
   bit reaching `recomputeReviewerInstitutionCOI` from the roster row is
   verified at `promote-applicant-reviewer-service.js:477-484` (passes
   `rosterCandidate` whole) rather than by a test.
8. **PRE-EXISTING, not introduced here.** Verified Track A candidates keep a
   browser-supplied `candidateKey` through the suggestion spread
   (`lib/services/discovery/verification.js:277`), and
   `reviewerCandidateKey` honors an existing string
   (`lib/utils/reviewer-candidate-key.js:18-21`). The institution JWT therefore
   binds whatever key the server surfaced, which the browser may have chosen.
   This is the same shape as the incumbent identity attestation and grants no
   institution, identity, or write authority. Recorded for completeness.

## Disposition of the six prior findings

| # | Prior finding | Disposition | Enforcing code (current lines) | Negative test containing the dangerous value |
|---|---|---|---|---|
| 1 | Browser-carried provenance manufacturing proposal-citation source-work authority | **Fully fixed** | `lib/services/reviewer-independent-identity-runtime.js:19-25` returns `null` unconditionally; the evaluator then returns `not_evaluable` / `source_work_lineage_missing` before any provider call (`lib/services/independent-reviewer-identity.js:916-927`) | `tests/unit/reviewer-independent-identity-runtime.test.js` "forged citation provenance remains not evaluable and never calls a provider" |
| 2 | Flag-off COI-drop ledger writes persisting dormant institution evidence | **Fully fixed** | `pages/api/reviewer-finder/discover.js:61-80` strips through `stripDormantInstitutionEvidence` (lines 47-59, now including `affiliationAssertionsComplete`) before `pruneCandidateForRoster` when the flag is off | `tests/unit/reviewer-discover-unverified-author-filter.test.js` "exact-off strips dormant institution evidence before recording a COI drop" (input carries a forged receipt and token) |
| 3 | PATCH exclude/confirm_identity persisting browser-authored institution evidence | **Fully fixed** | `pages/api/workbench/reviewer-roster.js:160-171` new `stripClientInstitutionEvidence`; applied at `471-473` (exclude) and `528-530` (confirm_identity); POST reuses it at `426` | `tests/unit/reviewer-roster-endpoint.test.js` "strips browser-carried institution evidence from a non-applicant exclude" and "confirm_identity strips browser-carried institution evidence before persistence" |
| 4 | Exact-on legacy save payloads bypassing institution-evidence requirements | **Fully fixed** | `lib/services/reviewer-finder/save-candidates-service.js:1120` now `if (phase2Enabled && !phase2EvidenceTrusted)`; a legacy payload never loads a roster row (`782-790`, `866-876`) so it is rejected before any CRM read or write | `tests/unit/save-candidates-service.test.js` "Phase 2 exact-on rejects a legacy payload without roster evidence before writes" (asserts no roster read, no upserts) |
| 5 | More than 24 assertions silently truncating and reporting clear | **Fully fixed** | Completeness bit computed from raw length and any upstream `false` at `reviewer-institution-evidence-attestation.js:161-171`, included in the signed projection digest (`202,224,268`); dedupe by source, normalized text, and reference with conservative currentness rank at `deduplication-service.js:45-64,259-273`; screen reports `incomplete` at `reviewer-institution-coi-screen.js:67-72` | `tests/unit/reviewer-institution-evidence-attestation.test.js` "an over-cap assertion set is bounded and explicitly marked incomplete"; `tests/unit/institution-coi-historical.test.js` "a truncated typed assertion projection is incomplete even when retained rows are clear"; `tests/unit/save-candidates-service.test.js` "Phase 2 exact-on holds a truncated affiliation projection before writes" |
| 6 | Red `check:drain-table-mentions` gate | **Fully fixed** | `docs/audits/reviewer-institution-phase2-contract-audit-2026-09-14.md:226` now carries a post-W6 context annotation | Gate result below: OK, 742 files scanned |

## Contract trace: caller, persistence, consumer

**Discovery (ordinary Find).** Browser POSTs Stage 1 `analysisResult`
(`discover.js:133-139`). Verified suggestions spread the browser object but
overwrite `affiliationAssertions` with server-collected PubMed assertions
(`verification.js:277,292`); unverified suggestions keep browser fields but
never reach ranking (`lib/services/discovery/ranking.js:21-27` builds only from
`verified` and `discovered`) [VERIFIED via scratch test: an unverified
browser-shaped candidate is absent from `rankAllCandidates` output]. Under
exact-on, the mint loop evaluates identity (always `not_evaluable` today),
computes the completeness bit, and signs the projection (`discover.js:663-693`);
under exact-off all four result lists and the COI-drop ledger are stripped
(`discover.js:61-80,698-701`) [VERIFIED]. The `result` SSE event emits only
the stripped lists (`discover.js:760-768`).

**Roster POST.** `pruneCandidateForRoster` bounds the fields and recomputes the
bit from the browser array length (`reviewer-search-logic.js:1162-1170`);
`stripClientRosterAuthority` removes the receipt; the JWT is verified against
the pruned candidate and its key compared to the final bound key
(`reviewer-roster.js:401-412`); browser evidence is stripped and replaced only
by the verified projection (`426-443`). A browser refresh without a token
restores stored evidence only when the stored row's receipt still verifies
against the stored fields (`255-283`).

**Roster PATCH.** `exclude` and `confirm_identity` strip institution evidence
after pruning (`471-473,528-530`); `promote` and `saved` operate on stored rows
or refuse (`487-522`); `update_contact_draft` accepts only website and
affiliation strings (`590-640`); `remove_previous_results` takes candidate
references only (`654-676`) [VERIFIED by reading each handler].

**Applicant enrichment.** Server candidates are pruned, projected, and given a
receipt carrying the bit (`enrich-recommended-service.js:365-379`); exact-off
strips all five fields (`383-391`). The response DTO's bit is display only;
applicant rows cannot be POSTed by the browser
(`reviewer-roster.js:376-381`).

**Persistence.** `reviewer_find_roster.candidate` jsonb; `candidateFromRow`
spreads the blob and adds `candidateKey` at top level
(`lib/services/reviewer-roster-store.js:48-62`), so the receipt check sees
the same shape it signed. `deduplicateAndStore` performs no database write
despite its name [VERIFIED via `deduplication-service.js:54-75`: no `sql` or
insert].

**Consumers.** Ordinary save re-reads the roster row, verifies the receipt,
copies the row's assertions and bit onto the screened candidate
(`save-candidates-service.js:1113-1140`), and holds before any CRM read or
Dataverse write. Applicant promotion verifies the receipt on the canonical row
and screens the whole row with `includeAdditionalAffiliations: true` before any
contact or suggestion mutation (`promote-applicant-reviewer-service.js:455-515`).
Both save entry points are the only routes that reach these services
[VERIFIED via grep: `pages/api/reviewer-finder/save-candidates.js:53`,
`pages/api/workbench/promote-applicant-reviewer.js:43`], and the only
suggestion writer outside the adapter is the save service [VERIFIED via grep
and the green `check:reviewer-engagement-boundary`].

## Dangerous-input tests performed

All ran against the real modules (no mocks) in a scratch Jest file that was
deleted afterward. All passed.

1. Mint a token over 25 assertions including a PI-institution entry at
   position 25; prune to 24 with the bit `false`; the token still verifies
   with `affiliationAssertionsComplete: false`. Flip the bit to `true`, or
   delete it: `claim_mismatch`. Build a stored receipt and flip the bit on the
   stored row: receipt check returns `false`. Screen the stored row: `incomplete`.
2. 24 valid assertions plus one invalid raw entry: projection keeps 24 and
   marks incomplete (raw length counts, which is the conservative direction).
3. Dedup with historical, current, and unknown duplicates of the same PI
   institution: one entry survives with `current`; a member carrying
   `affiliationAssertionsComplete: false` poisons the merge; the surviving
   entry enters the COI signal set as `pubmed_additional`.
4. Thirty distinct assertions across a merged group: all retained by the
   merge, and the projection marks incomplete.
5. Unverified browser-shaped candidate with browser `affiliationAssertions` and
   `candidateKey`: absent from the real ranking output, so it is never signed.

Focused suites (real modules, existing mocks): 9 suites, 272 tests passed,
covering attestation, runtime adapter, roster endpoint, save service, promote
service, COI historical, discovery affiliation recency, discover route, and the
independent identity evaluator.

## Gates and exact results

Run sequentially in the worktree at `d0f37745`, each gate before its self-test,
before this file existed. Re-run of the four doc gates after writing this file
is recorded in the last section.

| Gate | Result |
|---|---|
| `check:types` | rc=0 |
| `check:api-routes` then `:self-test` | rc=0, rc=0 |
| `check:drain-table-mentions` then `:self-test` | rc=0 (OK, 742 files scanned), rc=0 |
| `check:atlas` then `:self-test` | rc=0, rc=0 |
| `check:doc-currency` then `:self-test` | rc=0, rc=0 |
| `check:fact-consistency` then `:self-test` | rc=0, rc=0 |
| `check:route-service-boundary` then `:self-test` | rc=0, rc=0 |
| `check:reviewer-engagement-boundary` then `:self-test` | rc=0, rc=0 |
| `check:migrations-manifest` | rc=0 |
| `check:docs-catalog` | rc=0 |
| `check:doc-symbol-refs` | rc=0 |
| `check:build-claim-freshness` | rc=0 |
| `check:agent-invariants` | rc=0 |
| `npm run build` | rc=0, compiled successfully |

## Residual rollout prerequisites (dormant path, not merge-blocking)

1. A reviewed source-specific dated-currentness policy so producers can emit
   `current`; until then exact-on holds every ordinary save.
2. A server-only, unforgeable proposal-citation marker produced after the
   request boundary and bound into the receipt, so the adapter can supply a
   source work.
3. Future ORCID end-year handling and `authorSpecific: 'unknown'` treatment
   (residuals 2 and 3 above).
4. Applicant-path CRM affiliation parity with ordinary save.
5. A positive exact-on save test, a real (unmocked) applicant-path screen test,
   and the frozen 40-case identity benchmark the plan already lists.
6. Bump `PROJECTION_VERSION` on the next projection change.
7. Keep `REVIEWER_INSTITUTION_PHASE2` unset in every environment. Do not enable
   measurement, apply migration 048, or create a Preview deployment for this
   path.

## Merge recommendation

Mergeable. The range closes every prior finding at the enforcing boundary with
tests that contain the dangerous input, changes no exact-off response or write
shape, keeps all failures before Dataverse mutation with per-candidate
correlation and `continue` semantics intact, and leaves all gates and the build
green. Merge as a dormant path with the flag off.

## Uncertainty and checks not completed

- Migration 048 "not applied" remains [ASSUMED per plan and runbook]; live
  Postgres was not read and must not be self-authorized.
- The flag's deployed state in Vercel was not checked with `vercel env ls`;
  "never on anywhere" is [ASSUMED per runbook].
- Completeness-bit flow on the applicant path is verified by code read, not by
  an unmocked test (hygiene item 7).
- The worktree carried one pre-existing untracked file before this review
  (`docs/audits/reviewer-institution-phase2-d1c91ea6-adversarial-review-2026-09-14.md`);
  it and this file are the only untracked changes.

## Post-write gate rerun

With this file present, `check:drain-table-mentions`, `check:doc-currency`,
`check:doc-symbol-refs`, `check:build-claim-freshness`, and `check:docs-catalog`
were re-run sequentially; all returned rc=0.
