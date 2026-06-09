---
name: project-applicant-exclusion-policy-pending
description: OPEN POLICY DECISION (needs foundation/stakeholder input — Justin can't decide alone) — how broadly may an applicant exclude reviewers, and on what basis? A PI can currently knock out the entire competent peer set with one soft "overlapping research programs" sentence, which also clobbers Claude's only proposal-named signal. Sub-question — should the PD SEE excluded-but-suggested peers?
metadata:
  type: project
  status: active
  scope: reviewer
  last_verified: 2026-06-09 via Justin (request 1002852)
---

## Recall Rule
Read this when: working on applicant-excluded reviewer handling, the Find-tab exclude filter (`partitionByExcluded` in `discover.js`), reviewer yield / under-delivery, or any reviewer-selection policy/UX. Pairs with [[project-excluded-reviewers-often-in-pool]] (the data-model side) and [[project-reviewer-finder-proposal-doc-context]] (the signal/document side).

## The open decision (PENDING — Justin cannot make it alone; needs the foundation)
How broadly should an applicant be allowed to exclude reviewers, and on what basis?
- Today an applicant's free-text `wmkf_excludedreviewers` is parsed and the Find tab honors it as a HARD soft-block (`partitionByExcluded` strips matches from Claude-verified / unverified / discovered). There is NO breadth limit and NO soft-vs-hard COI distinction.
- A PI can therefore exclude the entire competent peer set with one soft sentence ("overlapping research programs"), leaving little/no qualified pool — a program-integrity risk (applicants can knock out all the tough reviewers).
- Sub-decisions on the table:
  (a) **Visibility** — should the PD SEE excluded-but-Claude-suggested peers (currently silently clobbered) so they can judge each, rather than the matches vanishing?
  (b) **Basis** — should soft reasons ("overlapping programs") be weighed differently from hard COI (advisor/advisee, recent co-author, same institution)?
  (c) **Override** — may the PD keep a soft-excluded peer when the exclusion looks strategic rather than a real conflict?

## Concrete instance (request 1002852, Phase I, 2026-06-09)
The PI excluded the field's THREE leading PARP / ADP-ribosylation structural biologists — **Ivan Ahel (Oxford), John M. Pascal (Montréal), Karolin Luger (Colorado Boulder)** — citing "overlapping research programs." Per Justin, these were also the ~3 peer groups NAMED IN THE NARRATIVE = Claude's single strongest proposal-grounded signal; the exclude filter clobbered them. Combined with a thin Phase-I narrative, no bibliography, and no inline references, reviewer-finding was starved (~6 surfaced vs 12 requested). The reviewer-finder behaved CORRECTLY at every step — the issue is upstream policy, not a code bug.

## Why
Unchecked applicant exclusion + soft "overlapping programs" reasons can hollow out the reviewer pool for exactly the requests where qualified domain expertise is scarcest. This is a foundation policy / program-integrity question. Log it; do not "fix" it in code until the policy is decided.

Related: [[project-excluded-reviewers-often-in-pool]], [[project-reviewer-finder-proposal-doc-context]].
