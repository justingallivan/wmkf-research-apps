---
name: project-reviewer-verify-fail-dangerous
description: Active reviewer-identity guardrail: a full-forename contradiction must fail closed; initial-only evidence needs an independent affiliation/ORCID signal rather than automatic rejection or promotion.
metadata:
  node_type: memory
  type: project
  status: active
  scope: reviewer
  last_verified: 2026-07-22 via discovery verification, identity resolver/evidence source, and focused regression tests
---

## Recall Rule

Read before changing reviewer verification, name matching, ORCID/OpenAlex
promotion, or COI identity logic. Preserve both sides of the invariant: block a
full-forename contradiction, but do not treat an initial-only record as a
contradiction when independent evidence supports the person.

## Current invariant

The original S231 bug allowed a fabricated full forename to verify against a
real same-initial researcher. Both live verification paths now contain explicit
forename controls:

- **PubMed verification:** `lib/services/discovery/verification.js` requires
  `evaluateNameEvidence(...).hasFullForenameMatch`; the Alfred/Alain regression
  remains covered in `tests/unit/discovery-verification-status.test.js`.
- **Identity spine:** `lib/services/reviewer-identity-evidence.js` derives both
  `forenameAgrees` and `forenameContradicts`. Promotion branches in
  `lib/services/reviewer-identity-resolver.js` reject an explicit contradiction.
  Branches with only ORCID-employment evidence keep the stricter full-agreement
  requirement.

The distinction is load-bearing. OpenAlex may represent a real full-name person
as initials (for example `U. Keller`). The first S236 fix used
`forenameAgrees !== false` and incorrectly demoted those cases. Current branches
use `forenameContradicts !== true` only when affiliation/topic or comparable
independent evidence already exists; an explicit full-name mismatch still blocks.

## Do

- Treat a full-forename contradiction as identity-disqualifying unless a human
  explicitly corrects the identity.
- Require a second independent signal before promoting an initial-only match for
  a full-name candidate.
- Keep PubMed citations separate from person identity: paper-count thresholds do
  not disambiguate common surnames/initials.
- Add complement tests for contradiction, initial-only, missing evidence, and
  fully agreeing forenames whenever a promotion rule changes.

## Do not

- Reintroduce bare surname+initial verification.
- Convert `institutionMismatch` or topic overlap alone into proof of identity.
- Apply one forename predicate uniformly to branches with different independent
  evidence; preserve the resolver's branch-specific safety conditions.

## Historical evidence and design

The original Alfred/Alain reproduction and broader retrieval analysis are
preserved in git history and `docs/REVIEWER_FINDER_RETRIEVAL_REDESIGN_PLAN.md`.
Current field-aware rationale is in
`docs/REVIEWER_FIELD_AWARE_VERIFICATION_DESIGN.md`; live source and regression
tests remain authoritative.
