---
title: Memory Early-Warning Phase 0 Sweep — 2026-08-21
summary: "Tracked baseline/completion manifest for the Phase 0 semantic sweep of docs/MEMORY_ROUTER_EARLY_WARNING_PLAN.md, with one classification row per hit."
canonical: false
owner: product-engineering
last_verified: 2026-08-21
---

# Memory Early-Warning Phase 0 Sweep — 2026-08-21

Phase 0 evidence artifact required by `docs/MEMORY_ROUTER_EARLY_WARNING_PLAN.md`
§2 Phase 0. Point-in-time record; the completion check re-runs the commands
against the Phase 0 commit, not against later states.

- **Baseline SHA:** `5212e947` (commands run against that tree before edits).
- **Classification vocabulary:** `live-fixed` (stale current-voice claim,
  corrected in this pass) / `historical` (dated point-in-time record, left
  intact) / `quoted` (the pattern appears as a quotation, command, or
  description of the defect itself) / `correct-current-state` (the pattern
  matches accurate current text).
- Rows identify hits by command id and `file:line` only; matched text is not
  repeated here (prevents a self-expanding manifest). This artifact's own
  command block necessarily matches c1 and c4 and carries `quoted` rows.
- File abbreviations: `REV` = `docs/audits/memory-hygiene-best-practices-review-2026-08-21.md`,
  `PLAN` = `docs/MEMORY_ROUTER_EARLY_WARNING_PLAN.md`,
  `RUNBOOK` = `docs/MEMORY_HYGIENE_RUNBOOK.md`.

## Commands (stable block; run unfiltered)

```bash
# c1
rg -n -i "57-gate|all 57" docs/
# c2
rg -n -i "warn band|warn threshold|9 KiB|9,?216" docs/audits/memory-hygiene-best-practices-review-2026-08-21.md
# c3
rg -n -i "owner decisions?" docs/audits/memory-hygiene-best-practices-review-2026-08-21.md
# c4
rg -n "286-287" docs/
# c5
rg -n "2026-08-15" docs/MEMORY_HYGIENE_RUNBOOK.md docs/audits/memory-hygiene-best-practices-review-2026-08-21.md
```

## Baseline manifest (at `5212e947`; raw counts: c1=15, c2=11, c3=6, c4=6, c5=5)

| Cmd | Locator | Classification | Rationale |
|---|---|---|---|
| c1 | docs/OPERATIONAL_OBSERVABILITY_HANDOFF_2026-08-19.md:75 | historical | dated handoff records its own session's gate run |
| c1 | PLAN:47 | quoted | changelog describing the v2 review finding |
| c1 | PLAN:132 | quoted | Phase 0 instruction quoting the defect |
| c1 | PLAN:137 | quoted | Phase 0 instruction quoting the defect |
| c1 | PLAN:158 | quoted | enumerated stale-site address list |
| c1 | PLAN:159 | quoted | enumerated stale-site address list |
| c1 | PLAN:174 | quoted | the c1 command itself |
| c1 | docs/audits/fable-task-ledger-2026-08-14.md:14 | historical | dated ledger of its own run |
| c1 | docs/audits/claude-auth-side-effect-security-audit-2026-08-15.md:14 | historical | dated audit baseline record |
| c1 | docs/audits/documentation-memory-hygiene-sweep-2026-07-27.md:72 | historical | that audit's own dated run claim |
| c1 | docs/audits/documentation-memory-hygiene-sweep-2026-07-27.md:513 | historical | that audit's own dated run claim |
| c1 | REV:66 | live-fixed | current-voice battery claim, corrected to 56-of-57 |
| c1 | REV:174 | live-fixed | current-voice battery claim, corrected to 56-of-57 |
| c1 | REV:393 | live-fixed | current-voice battery claim, corrected to 56-of-57 |
| c1 | docs/audits/session-364-adversarial-review-2026-07-17.md:99 | historical | dated audit record |
| c2 | REV:39 | correct-current-state | accurate description of the live 11 KiB band |
| c2 | REV:91 | correct-current-state | accurate checker-constant description |
| c2 | REV:116 | correct-current-state | accurate hook-hardcoding description |
| c2 | REV:160 | correct-current-state | accurate control-analysis text |
| c2 | REV:163 | correct-current-state | accurate historical-analysis text |
| c2 | REV:345 | live-fixed | presented the warn-band change as an open option; now points at the approved plan |
| c2 | REV:442 | correct-current-state | accurate current-band retention statement |
| c2 | REV:448 | live-fixed | pending-proposal framing; rewritten as resolved/superseded |
| c2 | REV:518 | live-fixed | calendar-primary rationale; rewritten size-primary with worst-case math |
| c2 | REV:531 | live-fixed | Q14(a) still proposed the warn-band change; rewritten as resolved |
| c2 | REV:555 | live-fixed | R3 row still framed as pending owner decision; rewritten as superseded |
| c3 | REV:455 | live-fixed | inside the rewritten Q4 pending-decision block |
| c3 | REV:465 | correct-current-state | Q5/R4 remains a genuinely pending owner decision |
| c3 | REV:555 | live-fixed | R3 row (same rewrite as c2 REV:555) |
| c3 | REV:556 | correct-current-state | R4 remains pending |
| c3 | REV:557 | correct-current-state | R5 remains pending |
| c3 | REV:571 | live-fixed | pending list included R3; now R4–R5 with R3 recorded as resolved |
| c4 | PLAN:151 | quoted | Phase 0 instruction quoting the wrong ref |
| c4 | PLAN:177 | quoted | the c4 command itself |
| c4 | docs/REVIEW_FORM_MULTISELECT_BUILD_PLAN.md:700 | correct-current-state | unrelated file; cites a different source file's real lines |
| c4 | REV:117 | live-fixed | off-by-one hook line ref, corrected to 285-286 |
| c4 | REV:451 | live-fixed | off-by-one hook line ref, corrected within the rewritten Q4 block |
| c4 | REV:555 | live-fixed | off-by-one hook line ref in the R3 row, corrected in its rewrite |
| c5 | REV:40 | live-fixed | crossing-date restatement in the executive conclusion, corrected to 2026-08-13 |
| c5 | REV:58 | correct-current-state | list of prior audit dates (the 08-15 audit exists) |
| c5 | REV:154 | correct-current-state | trend-table row for the 08-15 audit |
| c5 | REV:349 | quoted | quotation of a router status line |
| c5 | REV:418 | correct-current-state | newest-audit-before-this-review statement |

## Completion manifest (after corrections + this artifact; raw counts: c1=13, c2=9, c3=4, c4=4, c5=4)

Baseline `live-fixed` rows above all disappeared from the rerun output
(that is what `live-fixed` asserts). Current hits:

| Cmd | Locator | Classification | Rationale |
|---|---|---|---|
| c1 | docs/OPERATIONAL_OBSERVABILITY_HANDOFF_2026-08-19.md:75 | historical | unchanged baseline row |
| c1 | PLAN:47 | quoted | unchanged baseline row |
| c1 | PLAN:132 | quoted | unchanged baseline row |
| c1 | PLAN:137 | quoted | unchanged baseline row |
| c1 | PLAN:158 | quoted | unchanged baseline row |
| c1 | PLAN:159 | quoted | unchanged baseline row |
| c1 | PLAN:174 | quoted | unchanged baseline row |
| c1 | docs/audits/fable-task-ledger-2026-08-14.md:14 | historical | unchanged baseline row |
| c1 | docs/audits/session-364-adversarial-review-2026-07-17.md:99 | historical | unchanged baseline row |
| c1 | docs/audits/claude-auth-side-effect-security-audit-2026-08-15.md:14 | historical | unchanged baseline row |
| c1 | docs/audits/documentation-memory-hygiene-sweep-2026-07-27.md:72 | historical | unchanged baseline row |
| c1 | docs/audits/documentation-memory-hygiene-sweep-2026-07-27.md:513 | historical | unchanged baseline row |
| c1 | docs/audits/memory-early-warning-phase0-sweep-2026-08-21.md:32 | quoted | this artifact's own c1 command line |
| c2 | REV:40 | correct-current-state | corrected crossing sentence now spans this line |
| c2 | REV:94 | correct-current-state | baseline row REV:91, shifted by edits |
| c2 | REV:119 | correct-current-state | baseline row REV:116, shifted |
| c2 | REV:163 | correct-current-state | baseline row REV:160, shifted |
| c2 | REV:166 | correct-current-state | baseline row REV:163, shifted |
| c2 | REV:450 | correct-current-state | baseline row REV:442, shifted |
| c2 | REV:463 | correct-current-state | supersession record (the resolution itself) |
| c2 | REV:464 | correct-current-state | supersession record (the resolution itself) |
| c2 | REV:567 | correct-current-state | rewritten R3 row recording the resolution |
| c3 | REV:473 | correct-current-state | baseline row REV:465 (R4 pending), shifted |
| c3 | REV:568 | correct-current-state | R4 pending (baseline REV:556, shifted) |
| c3 | REV:569 | correct-current-state | R5 pending (baseline REV:557, shifted) |
| c3 | REV:583 | correct-current-state | rewritten pending list (R4–R5 only) |
| c4 | docs/REVIEW_FORM_MULTISELECT_BUILD_PLAN.md:700 | correct-current-state | unchanged baseline row |
| c4 | PLAN:151 | quoted | unchanged baseline row |
| c4 | PLAN:177 | quoted | unchanged baseline row |
| c4 | docs/audits/memory-early-warning-phase0-sweep-2026-08-21.md:38 | quoted | this artifact's own c4 command line |
| c5 | REV:59 | correct-current-state | baseline row REV:58, shifted |
| c5 | REV:157 | correct-current-state | baseline row REV:154, shifted |
| c5 | REV:356 | quoted | baseline row REV:349, shifted |
| c5 | REV:426 | correct-current-state | baseline row REV:418, shifted |

## Completion check

Normalized `command-id|file:line` diff between the final rerun output (34
locators, artifact included) and the completion-manifest locators, both
LC_ALL=C-sorted: **zero differences; 0 duplicate locators; 0 current
`live-fixed` rows** — recorded 2026-08-21 in this pass. Artifact tracked:
`git ls-files --error-unmatch docs/audits/memory-early-warning-phase0-sweep-2026-08-21.md`
exits 0 after the Phase 0 commit.
