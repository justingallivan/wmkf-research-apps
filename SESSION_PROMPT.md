# Session 322 Prompt: Measure the shipped gating redesign (or pick up B2)

## Session 321 Summary

The delegated reviewer-gating strategy review ran and its full arc SHIPPED in one
session: Claude led the strategy review (subagents verified the periphery), Codex
adversarially reviewed rev 1 (2 blockers → rev 2 two-tier vindication), Codex built
from the reviewed plan (Claude took over twice when Codex runs stalled), and the
Contract 5 COI follow-up was probed, planned, and built through owner-approved
Phase C. The owner then ENABLED `REVIEWER_PAGE_EMAIL_TIER_ENABLED` in Production.

### What Was Completed

1. **Reviewer gating strategy review + redesign doc** (`docs/REVIEWER_GATING_STRATEGY_REDESIGN.md`).
   Verdict: policies defensible; two gates consumed wrong input / fired pre-evidence;
   the rejected-leads drawer was a dead end. Codex R1 found rev 1's vindication
   trusted non-identity-proven affiliations (dedup name-merge graft) → rev 2 splits
   vindication into anchored (ID-resolved, full recover) vs plausible (contested lane
   only). Review history + implementation status recorded in the doc.

2. **Email-gate implementation (Phases 0–4 all complete)** — `29c6748c`:
   - Domain guard contests (`emailSource='search_contested'`, LOW at send) instead
     of nulling; anchored-set match (OpenAlex domain + ORCID disambiguated-org RORs
     on trusted identity) fully recovers; name-resolved domains route lanes only.
   - `name_mismatch` rejects on a plausible domain re-adjudicated to contested in
     `_finalize` (zero new network — `rejectedEmail` already preserved).
   - `search_contested` fail-closed everywhere: explicit LOW reason in
     `emailConfidence`, in the persist denylists, authoritative
     `wmkf_emailsource` overwrite alongside `'manual'`.
   - `InviteEmailModal`: per-recipient LOW checkboxes (only ticked ids sent as
     `confirmedLowConfidenceIds`) + retained batch irreversible-send confirm
     (Codex's build had removed it; Claude restored).
   - Fetch tier SSRF-bound to `anchoredInstitutionDomains` (fallback: single
     `verifiedInstitutionDomain`); plausible set excluded.
   - **Owner enabled `REVIEWER_PAGE_EMAIL_TIER_ENABLED` in prod (2026-07-03)** —
     Phase 4 complete (`f65123fb`).

3. **Contract 5 institution-COI arc** (`16441575`, `2a244b9d`, `dae623c5`):
   - Probe (`scripts/probe-institution-coi-breakdown.mjs`): discovery drops were
     structurally invisible; matcher false-positived 7/10 curated distinct pairs.
   - Phase A: durable `coi_dropped` roster ledger (migration 023, applied to live
     DB) from all three drop sites; never selectable/recoverable/evicted.
   - Phase B: `institutionsMatchForCOI` — ID-first, no containment/subset/similarity;
     curated suite locked as tests (0/10 FP, 0/3 FN, was 7/10 FP).
   - Phase C (owner-approved): hard drop stays default; flag-not-drop ONLY for a
     single low-trust affiliation match contradicted by high-trust current evidence;
     flagged rows visible read-only, `hasInstitutionCOI` true, save gate untouched.
     Decision + reason recorded in `institutionCOIDetails`; probe reports the split.

4. **Docs/memory reconciled throughout** — enforcement contracts (3/5/7 re-verified,
   Last verified bumped), reviewer-identity + workbench-lifecycle wiki topics,
   leads spec, both faculty-page designs, follow-on plan, email-persist plan
   (Cause #2 RESOLVED), Atlas roster page, COI policy memories
   (`project-reviewer-coi-rely-on-self-disclosure`, `project-reviewer-recall-over-precision`).

### Commits

- `b6b23720` docs: gating strategy verdict + redesign (rev 1)
- `fe48ff0e` docs: rev 2 — two-tier vindication per Codex R1
- `29c6748c` feat: contested-email lane + two-tier domain vindication
- `16441575` probe: institution-COI mis-drop exposure
- `2a244b9d` feat: COI drop ledger + precision matcher (Phases A+B)
- `dae623c5` feat: COI flag-not-drop (Phase C)
- `f65123fb` docs: flag enabled in prod (Phase 4 complete)

## Next Items

### Verified Open

1. **B2 — enrichment-timeout partial-return.**
   Evidence: `lib/services/contact-enrichment-service.js:1356` (`enrichCandidates`
   throws on abort, discarding enrichment already computed);
   `docs/REVIEWER_EMAIL_PERSIST_FIX_PLAN.md` §B2. Last open item on the
   reviewer-email reliability track; independent of everything shipped S321.

### Measure Later (time-driven, not work-driven)

1. **Re-run `scripts/probe-no-email-breakdown.mjs 120`** after a few weeks of
   enrichment cycles. Expect: `verified_domain_contradiction`/`name_mismatch`
   buckets ~0; `search_contested` rows appearing; `institution_page` recoveries
   now that the fetch tier is live. Watch confirm-lane volume and any
   wrong-person report (expected none — send gate unchanged or stronger).
2. **Re-run `scripts/probe-institution-coi-breakdown.mjs 120`** once searches
   accumulate `coi_dropped` ledger rows. That data validates (or revisits) the
   Phase C corroboration thresholds and the dropped/flagged split.

### Owner Decision Needed

1. **Whether to delete merged remote feature branches.**
   Evidence: `git ls-remote --heads origin codex/referral-seeding-build codex/program-area-normalization`.
   Carryover from S320; harmless to keep. Verify merged before deleting.

### Parked

1. **Spec-audit docs recovery.**
   Evidence: `.claude-memory/project-spec-audit-docs-recovery-parked.md`.
   Re-open ~2026-07-08 on the work computer: push `codex/spec-audit` there, then
   fetch/review/merge here. Do not re-search local/origin first.

### Verify Before Acting

1. **Line anchors in S321 docs are post-ship snapshots.** The gating redesign and
   COI plan cite `file:line` verified 2026-07-03; code moves — re-confirm against
   live files before relying on them.

### Do Not Reopen Without New Decision

1. **Cause #2 is RESOLVED** (email-gate redesign shipped; flag enabled). Evidence:
   `docs/REVIEWER_EMAIL_PERSIST_FIX_PLAN.md` Cause #2 note; commits above. Do not
   re-diagnose; only re-measure per "Measure Later".
2. **COI Phase C policy is owner-decided and shipped** (flag-not-drop for the
   narrow contradicted-single-source case only; save gate fail-closed; NO staff
   COI-waiver workflow — that would be a NEW decision). Evidence:
   `docs/REVIEWER_COI_PRECISION_PLAN.md`; contracts doc §5.
3. **`REVIEWER_PAGE_EMAIL_TIER_ENABLED` is ON in prod (owner, 2026-07-03).** Do
   not treat its state as unknown; do not disable without a new owner decision.
4. **The invite send gate predicate is unchanged** — contested/flagged states rely
   on it as the backstop. Any loosening there is a new high-stakes decision.

## Key Files Reference

| File | Purpose |
|------|---------|
| `docs/REVIEWER_GATING_STRATEGY_REDESIGN.md` | Verdict + redesign + review history + implementation status (email gates). |
| `docs/REVIEWER_COI_PRECISION_PLAN.md` | COI probe evidence + Phases A/B/C (all shipped). |
| `docs/REVIEWER_FINDER_ENFORCEMENT_CONTRACTS.md` | Live contracts; 3/5/7 re-verified 2026-07-03. |
| `lib/services/contact-enrichment-service.js` | Contested-email mechanics: `_buildInstitutionDomainEvidence` (:255), `_markEmailContested` (:303), `_readjudicateNameMismatchRejectedEmail` (:312), guard (:419), fetch tier (:1168). |
| `lib/services/deduplication-service.js` | `institutionsMatchForCOI`, `partitionConflicts` + `institutionCOIDecision` (Phase C fork). |
| `lib/services/reviewer-roster-store.js` | `recordCoiDropped` ledger; status lifecycle incl. `coi_dropped`. |
| `lib/utils/reviewer-invite.js` | `emailConfidence` — `search_contested` explicit LOW. |
| `shared/components/reviewers/InviteEmailModal.js` | Per-recipient LOW checkboxes + batch send confirm. |
| `scripts/probe-no-email-breakdown.mjs` | Email-recovery re-measure. |
| `scripts/probe-institution-coi-breakdown.mjs` | COI ledger/split re-measure + matcher suite. |

## Testing

```bash
npm test   # full suite; known-red baseline: bill, discovery-verification-status, stage2a (30 tests)
npx jest tests/unit/institution-coi-precision.test.js tests/unit/contact-leads-slice2a.test.js tests/unit/reviewer-invite.test.js tests/unit/reviewer-route-identity-gate.test.js --runInBand
node scripts/probe-no-email-breakdown.mjs 120        # needs .env.local creds
node scripts/probe-institution-coi-breakdown.mjs 120 # needs .env.local Postgres
```
