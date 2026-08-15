---
title: Memory Housekeeping Sweep — 2026-08-15
summary: "Source-backed reconciliation of the eight active memories flagged by check:memory-health, plus correction of the advisory's feedback weak-basis mismatch."
canonical: false
owner: product-engineering
last_verified: 2026-08-15
---

# Memory Housekeeping Sweep — 2026-08-15

## Scope

- **Mode:** B — domain truth audit.
- **Domain:** the eight active memories reported by `check:memory-health` at session
  start: shadow-Atlas, weak-basis, missing-recall-rule, and oversize-routed signals.
- **Authoritative sources:** current implementation and tests, the Application State
  Atlas, active plans, current owner decisions, benchmark artifacts, and harness hooks.
- **Durable surfaces:** the eight memory leaves, their unchanged `MEMORY.md` routes, and
  `scripts/check-memory-health.js` because its output defined the queue.
- **Excluded:** unrelated memory leaves; production Dataverse was not re-probed because
  the standing owner rule requires explicit authorization. No new undated production
  claim was introduced.

## Evidence matrix

| Claim | Producer / entry | Persistence / truth | Consumer | Strongest evidence | Status |
|---|---|---|---|---|---|
| Behavioral `feedback-*` rules do not require live-state `last_verified` metadata | Memory authoring | Feedback leaf | Health advisory | `scripts/check-memory-health.js` contract plus `docs/audits/memory-triage-2026-07-08.md`; implementation lacked the exemption | VERIFIED; checker conflict fixed |
| Measurement artifacts must be applied to every affected metric | Benchmark/audit author | Published benchmark result | Later audit conclusions | `benchmarks/fuzzy-matching-falsification/README.md` and `baseline/ror-chosen-2026-08-07.md` | VERIFIED |
| The owner-set transient-access copy remains live | `requireAppAccess` | Source response | Invite/manage retry UI | `lib/utils/auth.js`; focused retry-copy tests | VERIFIED |
| Institution display-tier false clears are cheap, while person binding remains strict | Owner decision + enrichment service | Current plan/benchmark/source | Reviewer matching decisions | `docs/INSTITUTION_PAIR_CONSISTENCY_RESOLUTION_PLAN.md`; Wave 6 result; `enrich-recommended-service.js` | VERIFIED |
| Production Dataverse reads require owner authorization in addition to the technical interlock | Owner decision + target interlock | Harness rule and source guard | Agent-run probes | `feedback-never-self-authorize-prod-dataverse-reads.md`; `lib/dataverse/core/interlock.js`; current audit ledger | VERIFIED |
| Review-shaped Codex work and rescue-shaped work use distinct enforced routes | Delegation hook | Hook policy | Claude/Codex handoff | `pre-review-delegation-trace-guard.js` and hook tests | VERIFIED |
| Codex review needs analysis represented in a Git-visible diff | Review workflow + Git | Working tree/commit | Review command | `.gitignore:55`, review-routing guard, and dated successful review evidence | VERIFIED |
| Candidate-card simplification is not implemented; matching decisions precede the planned UI | Find-tab card | Current component/source | Reviewer Finder UI | `ReviewerSearchSection.js`; strategic-reset brief; owner answers | VERIFIED for current state; PLANNED for redesign |
| Terminal statuses and per-reviewer due override are live contracts | Dedicated services | `wmkf_appreviewersuggestion` | Staff UI, portal, email, reminder, token consumers | Current services/tests and `docs/atlas/dataverse-wmkf-appreviewersuggestion.md` | VERIFIED |
| Ordered dispatch/deadline evidence remains separate and unbuilt | Future dispatch design | None yet | Future reliability metric | Active terminal-status/dispatch-evidence plan plus absence search across runtime source | PLANNED |

## Classification and fixes

The nine directly inspected surfaces (eight memories plus the advisory script) classified
as **AGREE 6 / STALE 3 / HISTORICAL 0 / UNRELATED 0**. “STALE” here means structurally
misleading current guidance: the checker contradicted its behavioral-feedback contract,
and the two oversized routed memories mixed active contracts with long implementation
chronologies.

Structural fixes:

1. Implemented the documented `feedback-*` weak-basis exemption.
2. Added four missing recall rules and source evidence to the three shadow-Atlas entries.
3. Compressed candidate-card and reviewer-reliability memories below 5 KiB, retaining one
   current contract and routing detailed history to the controlling plans, Atlas, and
   benchmark artifacts.
4. Preserved every existing router filename; no routing change or memory deletion occurred.

Semantic omissions found and corrected:

- The advisory described an exemption it did not enforce.
- Candidate-card history obscured that the redesign is still unbuilt and subordinate to
  the strategic reset.
- Reviewer-reliability history obscured the key boundary: the operational due-date
  override is live, while append-only communicated-deadline evidence is not.

## Verification

The falsification pass reruns the exact health classification, router structure and
self-test, memory/doc fact consistency and self-test, symbol-reference checks and
self-test, and inspects the complete Git diff. Search terms include the benchmark counts,
owner-set error copy, production-read acknowledgement, Codex routing markers, card status
band, due-date override, terminal statuses, and dispatch-ledger language.

Claims: **10 VERIFIED / 0 PARTIAL / 2 PLANNED / 0 ASSUMED / 0 STALE-CONFLICT /
0 UNKNOWN**. Remaining live stale claims in the defined scope: **0**.

**Verdict: RECONCILED**, bounded to the scope above.
