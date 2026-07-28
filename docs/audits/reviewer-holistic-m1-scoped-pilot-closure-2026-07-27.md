---
title: Reviewer Holistic M1 Scoped Pilot Closure — 2026-07-27
domain: reviewer-identity
kind: audit
status: complete
summary: "Privacy-safe method, aggregate findings, limitations, and owner disposition for the completed reviewer-holistic M1 scoped pilot."
canonical: false
cataloged: 2026-07-27
last_verified: 2026-07-27
owner: product-engineering
related:
  - docs/REVIEWER_HOLISTIC_REVIEW_IMPLEMENTATION_PLAN.md
  - docs/audits/reviewer-holistic-proposal-evaluation-v1.json
  - docs/audits/reviewer-holistic-proposal-cohort-proposal-v1.json
  - docs/audits/reviewer-holistic-evaluation-manifest-v2.json
  - docs/audits/local-operational-data-retention-audit-2026-07-27.md
---

# Reviewer Holistic M1 Scoped Pilot Closure — 2026-07-27

## Closure decision

**[VERIFIED via owner confirmation, 2026-07-27]** The reviewer-holistic M1
comparison study is complete. It will not be kept active or rerun merely to
preserve reproducibility. The broader reviewer identity and finding roadmap
remains active; this closure applies only to the July M1 proposal-level
comparison and its scoped scoring pilot.

The owner asked to retain the study's useful design and findings. This audit,
the linked public receipts, and the implementation plan now provide that
privacy-safe durable record. The private raw inputs, exact seed, execution
checkpoints, scoring rows, and unblinding map remain controlled evidence
pending a separate disposal approval; they are no longer operational recovery
state and do not require manifest repinning.

## Study design

The comparison was frozen before execution:

- ten held-out proposals selected by a mechanical stratification: five
  thin-signal and five full-signal cases across two program areas;
- two arms—the incumbent baseline and an evaluation-only
  applicant-neighborhood redesign;
- three replicates per proposal and arm, for 60 paid generation runs;
- identical documents, prompt/model configuration, candidate count,
  applicant/institution exclusions, and runtime snapshot across arms;
- union and exact-name deduplication before arm-neutral blind identifiers;
- owner scoring without arm visibility, followed by a separately stored
  unblinding map; and
- a scoped pilot of ten workbook candidates per proposal rather than scoring
  the full 345-candidate package.

The scored pilot contained 100 unique workbook rows. Because a deduplicated
candidate could occur in both arms, the unblinded comparison contained 148
arm-linked observations: 74 baseline and 74 redesign.

The scoring dimensions were correct person, topical fit,
independence/eligibility, shortlist selection, eligible shortlist, and whether
the row was marked panel-ready without another search. The public repository
contains aggregate method and gate receipts only; production-derived proposal,
document, person, and record identifiers remain outside it.

## Aggregate findings

| Scored dimension | Baseline | Redesign | Difference |
|---|---:|---:|---:|
| Arm-linked observations | 74 | 74 | 0 |
| Correct person | 73 | 68 | -5 |
| On topic | 67 | 64 | -3 |
| Independent/eligible | 66 | 62 | -4 |
| Shortlisted | 61 | 61 | 0 |
| Eligible shortlist | 61 | 61 | 0 |
| Marked panel-ready without another search | 62 | 61 | -1 |

The private failure analysis found six wrong-person observations in the
redesign arm versus one in baseline. One wrong-person candidate was shared by
both arms; five were redesign-only. None of those wrong-person rows was
shortlisted, on-topic, independent/eligible, or marked panel-ready. The
analysis also identified six redesign-linked quality-loss rows where the
person was correctly identified but not independent/eligible; four were
off-topic and two remained on-topic. One eligibility loss was explicitly a
retirement/emeritus staffing exclusion and should not be interpreted as an
identity or retrieval failure.

**Finding:** the redesign did not improve eligible-shortlist yield and
introduced five redesign-only wrong-person observations. It was therefore not
promotion-ready. The evidence supported keeping legacy-default production
routing unchanged and adding fail-closed identity containment, proposal-
specific topicality, and independent-eligibility checks before any separately
versioned future experiment.

Legacy-default is a conservative hold, not proof that the baseline is fully
safe: the shared wrong-person observation also occurred in baseline. The
result does not require abandoning the redesign; it requires fixing and
reevaluating it before any cutover claim.

This result does not establish that applicant-neighborhood seeding itself
caused every failure. Several failures were consistent with missing final-
output containment, and the study was not designed to isolate every pipeline
component.

## Limits on interpretation

- This was a bounded descriptive pilot, not a powered population estimate.
- One owner scored the blinded workbook; there was no second scorer,
  adjudication, or inter-rater claim.
- Only the scoped 100-row workbook was scored. The original 345-candidate
  package remained unscored.
- The study measured offline candidate quality, not invitation acceptance,
  completed reviews, staff rescue work, or time-to-panel-ready in production.
- Counts are exact for this frozen pilot and should not be generalized to all
  proposals, fields, cycles, or later pipeline versions.

## Durable-fact sweep

**Changed fact:** the July M1 comparison is complete and its reproducibility
window is closed; the broader reviewer roadmap remains active.

The sweep covered `reviewer-holistic`, `M1.2`, `60-slot`, `100-candidate`,
`reproducibility`, `repin`, `randomization seed`, `scoring`, and `unblinding`
across live documentation, routed memory, `SESSION_PROMPT.md`, and the
development log.

- **AGREE:** the implementation plan and routed memory already say the 60-run
  execution and 100-row scoped scoring/unblinding are complete while the
  original 345-candidate package remains unscored.
- **INCOMPLETE, FIXED:** the tracked receipts preserved methodology and gates,
  but no tracked document retained the substantive aggregate pilot result.
  This closure audit supplies that missing privacy-safe record.
- **STALE, FIXED:** the local-retention audit left manifest repinning and the
  study's preservation window conditional on a future owner decision. It now
  records the owner's closure decision and treats the raw chain as a
  controlled disposal candidate.
- **HISTORICAL:** the 2026-07-09 comparison synthesis predates this experiment
  and remains planning input; it is not evidence of the later pilot outcome.

No live restatement now requires a rerun or manifest repin. References to the
overall holistic implementation plan remaining active are not conflicts: they
refer to identity containment, policy migration, possible future experiments,
and owner-gated production work outside this completed study.

## Retention consequence

The study's privacy-safe method, aggregate findings, limitations, and decision
are now durable in tracked documentation. The reproducibility window is
closed, so the exact seed and raw experiment chain no longer need indefinite
retention for a future rerun. Any deletion still requires a private exact-path
review, explicit owner approval, and an aggregate deletion receipt; this audit
does not authorize deletion by itself.
