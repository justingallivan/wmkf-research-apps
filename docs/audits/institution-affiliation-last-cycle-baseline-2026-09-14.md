---
title: June–August 2026 Institution-Affiliation Review Baseline
domain: reviewer-identity
kind: audit
status: complete
summary: "Read-only retained-roster census and non-authoritative ROR text-pair probe; historical staff-action baseline remains unmeasured."
canonical: false
cataloged: 2026-09-14
last_verified: 2026-09-14
owner: product-engineering
related:
  - docs/INSTITUTION_PAIR_CONSISTENCY_RESOLUTION_PLAN.md
  - docs/atlas/postgres-reviewer-find-roster.md
  - scripts/audit-institution-affiliation-retrospective.js
  - scripts/replay-institution-affiliation-retrospective.js
---

# June–August 2026 institution-affiliation review baseline

## Decision-relevant result

**[VERIFIED via read-only Production Postgres roster census, 2026-09-14]** The
owner identified June–August 2026 as the last-cycle cohort. Among 953 retained
Find-roster rows first seen in that interval across 47 requests, 106 currently
carry `candidate.institutionMismatch === true`: 89 active, 14 saved, and three
excluded. This is the size of a *retained mismatch-flag inventory*, not the
number of staff reviews, institution-only holds, wrong-person cases, or clicks
that Stage 3 could avoid. Saved and excluded are current row statuses; their
causes cannot be attributed to affiliation from this snapshot.

**[VERIFIED via roster projection and source contract]** Only 71 of the 106
flagged rows retain both `candidate.affiliation` and
`candidate.suggestedInstitution`; those fields are not guaranteed to be the
actual verifier-evidence and recorded-institution pair used at the enrichment
decision point. Eleven retain a verifier-affiliation marker, two retain typed
identity anchor *types*, three retain a Stage 2 presentation kind, and none
retains the full typed assessment. A publication reference is present in 65,
but that alone does not bind its author-specific affiliation, observation date,
or independent person-identity result to the mismatch. Ten rows have a staff
identity-confirmation marker, which is not an affiliation-action event.

**[VERIFIED via read-only local ROR text-pair probe, 2026-09-14]** An exploratory
replay of the stored text fields skipped 66/106 cases: 35 lacked an operand,
19 contained slash-joined affiliations that the typed parser does not segment,
and 12 held non-institution decision text. Of the remaining 40, the typed
relationship resolver proposed five `same`, four `distinct`, and 31
`unresolved`; one replayed row recorded provider failure. These are **not
adjudicated organization labels or consumer-action predictions**. In
particular, even a proposed `same` cannot be scored as an automatic clear
without the source assertion, author attribution, identity proof, and extra
affiliation COI screen. The probe deliberately supplies unknown source time
and author specificity, and never calls the selection or write policy.

The probe exposed a narrow safety issue: the production typed parser previously
passed a slash-joined field as one organization span, allowing a resolver to
match one member and hide another. A subsequent branch change makes such text
explicitly unresolved until its segments are source-adjudicated. This changes
Stage 2 explanation only; incumbent selection and writes remain authoritative.

## Method and limits

The census used `scripts/audit-institution-affiliation-retrospective.js` with
`--from=2026-06-01 --to=2026-09-01`. Its only database statement is a `SELECT`
from `reviewer_find_roster`; calendar filtering and aggregation happen locally.
The default output contains counts only. The optional local `--cases` packet
replaces request/candidate identifiers with pseudonymous hashes, omits person
names, emails, publication titles, and raw identity anchors, and redacts email
addresses embedded in stored institution text. Case-level packet and replay
outputs live under gitignored `outputs/` and are not part of this audit.

The roster is a current operational JSONB projection, not a historical action
ledger [VERIFIED via `docs/atlas/postgres-reviewer-find-roster.md` and
`lib/services/reviewer-roster-store.js`]. The incumbent producer folds
institution contradiction into `identityNeedsReview` before field projection;
the card applies `isCandidateSelectable`, while `save-candidates-service.js`
independently verifies identity/contact authority and recomputes institution
COI. Therefore a current `institutionMismatch` flag does not by itself reveal
which gate actually stopped selection or how many staff actions were taken.

The separate `reviewer_identity_shadow_log` observes a legacy-versus-works
person-identity resolver comparison, not this institution-policy decision or
staff action. It cannot fill the missing action trail [VERIFIED via
`docs/atlas/postgres-reviewer-identity-shadow-log.md`].

## Consequence for Stage 3

**[ASSUMED until prospectively measured]** Some departmental and
multi-affiliation holds may be avoidable, consistent with the owner's last-cycle
experience. This census cannot quantify the number or claim a reduction.

The next measurement must bind a server-owned candidate/input version to:
the exact source/time/author-specific affiliation assertions; the incumbent
producer, card, and save outcomes; a separately proven non-affiliation identity
result; extra-affiliation COI screening; and bounded staff actions with reason
codes. A held-out blind label must separate institution-only clearance from
person identity and final selectability. Until those fields exist, a missing
input is `not_evaluable`, never a successful shadow auto-clear. Keep the
incumbent selection and write gates authoritative while collecting the
comparison.
