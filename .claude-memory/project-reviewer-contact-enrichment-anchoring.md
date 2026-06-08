---
name: project-reviewer-contact-enrichment-anchoring
description: "Reviewer namesake-collapse locus = CONTACT/bibliometric enrichment, not identity resolution. Fix = anchor contact to the resolved identity (ORCID/work-grounded institution) or abstain; identity-confirmed ≠ contact-validated. Fixes A–D shipped on branch reviewer-contact-anchor-fixes (S234), Fix E deferred."
metadata:
  node_type: memory
  type: project
  status: active
  scope: reviewer
  last_verified: 2026-06-08
---

## Recall Rule
Read before touching reviewer contact enrichment, the Serp/Scholar/Claude contact tiers, the
identity→enrichment handoff, or `save-candidates`/`saveToDatabase` field persistence. Pairs with
[[project-reviewer-identity-resolution]] and [[project-reviewer-verify-fail-dangerous]].

## The diagnosis (verified live on request 1002794, attosecond physics)
Smirnova surfaced with an ITMO-namesake email; Chen surfaced with a *pianist's* email/website
(`cliburn.org`) and a wrong h-index — **despite both having correct identity resolution** (Chen was
`confirmed` via an `authorship_grounded` anchor; Smirnova ORCID-anchored to Max-Born-Institute).

Root cause: **identity resolution works; CONTACT/bibliometric enrichment was the failure locus.** It
ran bare-name Google/Scholar searches that ignored the resolved anchors. When discovery affiliation was
empty (true for arXiv-discovered authors), the query had no institution → namesake collapse. The wrong
fields then *persisted* (email/website/affiliation were written unconditionally; the old gate only nulled
ORCID/Scholar/bibliometrics, and only when a resolver verdict existed).

## The governing principle (extends "unresolved is acceptable; wrong-and-confident is not")
**Identity-confirmed ≠ contact-validated.** A `confirmed` person must NOT auto-license unvalidated
contact details. Anchor contact to the resolved identity (ORCID-resolved institution, or the work-grounded
OpenAlex author institution already carried onto `candidate.affiliation` by `mapTrackBIdentityResult`), or
**abstain** — emit no sendable email/website/bibliometrics and mark `contactStatus:'unresolved'`. Reuse
anchors already fetched; do NOT add per-candidate round-trips (latency is the binding constraint, see
[[project-serpapi-budget-latency]]).

## What shipped (branch `reviewer-contact-anchor-fixes`, S234 — committed, NOT merged at write time)
- **A**: ORCID-resolved affiliation threaded into Tier-3 Claude, Tier-4 Serp, AND Scholar via a
  search-only candidate clone (never mutates the input candidate → preserves the S224
  resolveIdentity-on-original-affiliation invariant); same effective institution feeds the contradiction guard.
- **B (abstain-only)**: no institution anchor + no ORCID → skip bare-name paid contact/Scholar lookup.
- **C**: per-field persist flags (`emailPersistAllowed`/`websitePersistAllowed`/`affiliationPersistAllowed`)
  enforced in BOTH save paths and surviving `pruneCandidateForRoster` (same pattern as the existing
  identity/scholar persist flags — [[project-reviewer-find-roster]]).
- **D**: `buildIdentityNote` surfaces `authorship_grounded` (was reading as topic-only "confirmed").
- **Fix E (deferred-candidate selectability) NOT done** — deferred Track-B candidates (beyond the top-25
  `TRACK_B_IDENTITY_RESOLUTION_LIMIT`) still render selectable; A–D null their contact on save so it's a
  data-safety-OK / UX-gap, not a correctness hole. Outstanding follow-up.

## Hazard that bit us (don't repeat)
The email-domain contradiction guard (backstop for a Serp result with no institution field) is a
heuristic that CANNOT cleanly separate legit abbreviation/portmanteau domains (ethz.ch, caltech.edu,
gatech.edu — all real reviewers' homes) from a true wrong-namesake domain (metalab.ifmo.ru). The first
cut hard-rejected on "domain has a 4+ char token not lexically in the institution name" and would have
*suppressed correct emails for Keller & Travers on 1002794*. Made it abbreviation-aware + keep-biased
(relate on word-prefix containment / initialism). Lesson: a domain heuristic must be keep-biased — prefer
a false negative (wrong email shown) over suppressing a correct contact.

## Design docs
`docs/REVIEWER_IDENTITY_CONTACT_FIX_PLAN.md` (+ `_REVIEW`, `_REVIEW_2` Codex passes),
`docs/REVIEWER_IDENTITY_STRATEGY_EVALUATION.md`, `docs/REVIEWER_IDENTITY_VERIFICATION_FINDINGS.md`.
