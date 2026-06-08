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

## How contact gets validated (final design — NOT lexical institution-name matching)
The actual namesake fix is **Fix A's institution-scoped search** — searching `"<name>" <institution>
email` returns the right person's email (Smirnova → `olga.smirnova@mbi-berlin.de`, not the ITMO
namesake). The email is then validated against the **Google Scholar VERIFIED institutional domain**
("Verified email at mbiberlin.de", already collected as `scholarVerifiedEmail`): a normalized domain
MATCH (hyphen-insensitive; subdomain-aware) confirms the contact for persistence; a clear CONTRADICTION
drops it as a likely namesake (ifmo.ru vs mbiberlin.de); with NO verified domain it trusts the scoped
search and leaves the email alone. Lives in `_validateEmailAgainstVerifiedDomain`, run in `_finalize`
after Scholar metrics.

## Hazard that bit us (don't repeat) — lexical domain matching is the WRONG tool
The first/second cuts tried a lexical "does the email DOMAIN appear in the institution NAME" contradiction
guard. It false-positived on abbreviation/portmanteau/city-coded domains and — caught only by a LIVE
smoke, not unit tests — **rejected the REAL target's own email**: `olga.smirnova@mbi-berlin.de` (MBI
acronym + Berlin city) is nowhere in "Max-Born-Institute for Nonlinear Optics and Short Pulse
Spectroscopy", so the guard suppressed her correct address (the whole point is to email her). Also hit
ethz.ch/caltech.edu/gatech.edu. **Removed it entirely.** Lessons: (1) an institution NAME string cannot
validate an email domain — use a positive, signal-grounded anchor (Scholar-verified domain / ORCID /
the institution's own faculty page) instead; (2) a contact heuristic must be keep-biased — prefer a
false negative (wrong email shown) over suppressing a correct one; (3) **smoke against live search
results** — the unit tests used a fabricated true-positive (metalab.ifmo.ru) and never exercised the real
mbi-berlin.de case.

## Still open for reliable invites (the email is needed to invite the reviewer)
When the scoped search returns no email / a contradicted one: (a) fetch the anchored institution's own
faculty page (we already surface it, e.g. `mbi-berlin.de/p/olgasmirnova`) and parse the email; (b) gate
the INVITE on contact confidence (auto-allow only ORCID / Scholar-domain-matched / institution-page
emails; else staff "confirm contact before sending"). NOT BUILT — next slice after Fix E.

## Design docs
`docs/REVIEWER_IDENTITY_CONTACT_FIX_PLAN.md` (+ `_REVIEW`, `_REVIEW_2` Codex passes),
`docs/REVIEWER_IDENTITY_STRATEGY_EVALUATION.md`, `docs/REVIEWER_IDENTITY_VERIFICATION_FINDINGS.md`.
