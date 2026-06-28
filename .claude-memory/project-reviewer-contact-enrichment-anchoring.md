---
name: project-reviewer-contact-enrichment-anchoring
description: "Reviewer namesake-collapse locus = CONTACT/bibliometric enrichment, not identity resolution. Fix = anchor contact to the resolved identity (ORCID/work-grounded institution) or abstain; identity-confirmed ≠ contact-validated. Fixes A–D merged to main (S234); Fix E (deferred-candidate selectability gate, incl. roster-marker persistence E1b + server 422) shipped S235."
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

## What shipped (branch `reviewer-contact-anchor-fixes`, S234 — merged to main)
- **A**: ORCID-resolved affiliation threaded into Tier-3 Claude, Tier-4 Serp, AND Scholar via a
  search-only candidate clone (never mutates the input candidate → preserves the S224
  resolveIdentity-on-original-affiliation invariant); same effective institution feeds the contradiction guard.
- **B (abstain-only)**: no institution anchor + no ORCID → skip bare-name paid contact/Scholar lookup.
- **C**: per-field persist flags (`emailPersistAllowed`/`websitePersistAllowed`/`affiliationPersistAllowed`)
  enforced in BOTH save paths and surviving `pruneCandidateForRoster` (same pattern as the existing
  identity/scholar persist flags — [[project-reviewer-find-roster]]).
- **D**: `buildIdentityNote` surfaces `authorship_grounded` (was reading as topic-only "confirmed").
- **Fix E (deferred-candidate selectability gate) SHIPPED S235.** Deferred Track-B candidates (beyond the
  top-25 `TRACK_B_IDENTITY_RESOLUTION_LIMIT`) are now stamped `identityStatus:'unresolved'`/
  `needsIdentification:true` at discovery (E1), routing them to the non-selectable `needs_identity_review`
  provenance group. The Workbench renders that group read-only + excludes it from select-all/save (E2);
  `save-candidates.js` hard-rejects unresolved rows per-row (422 if the whole batch is rejected) — the
  load-bearing defense for the standalone `reviewer-finder.js` page, which has no client identity grouping
  (E3). **E1b (pre-flight catch):** `pruneCandidateForRoster` now persists the three identity markers so the
  gate survives a Find-roster reload — without it a deferred row re-surfaced as selectable. Regression test
  asserts the round-trip in `tests/unit/reviewer-search-logic.test.js`. No legitimate "pursue anyway" flow
  exists, so the 422 is safe. **Codex post-impl review folded in:** the standalone `reviewer-finder.js`
  page now also gates select/save + surfaces `rejectedUnresolved` (was silent-success); and
  `provenanceGroupOf`'s barred/unknown-kind FALLBACK no longer gates a positively-resolved row
  (confirmed/probable/verified) — a BARRED Track-A row upgraded by a shared-ORCID Track-B match is a
  legitimate selectable reviewer on both clients. The server save gate stays on the EXPLICIT unresolved
  triple (NOT full `provenanceGroupOf`): a BARRED-no-top-level-identity row with a resolver verdict is
  legitimately saved with field-level gating (`reviewer-route-identity-gate` tests would break otherwise),
  so the client select list is INTENTIONALLY stricter than the server save gate.

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
emails; else staff "confirm contact before sending"). Slice G (invite-confidence + manual-confirm gate)
is IMPLEMENTED S235 (branch `reviewer-slice-g-invite-confidence`, design+impl in
`docs/REVIEWER_INVITE_CONFIDENCE_DESIGN.md`) — `emailConfidence(person)` helper in `lib/utils/reviewer-invite.js`;
`send-emails` server-enforces (refuse LOW unless the recipient's id is in `confirmedLowConfidenceIds`, scoped to `templateType==='invitation'`);
`render-emails` stamps per-draft confidence; `InviteEmailModal` warning + one-click confirm; manual email edits
stamp `emailSource='manual'`. No schema change. Slice F (faculty-page email recovery) SHIPPED S235 via the
ZERO-SSRF path — the automated server-side fetch was Codex-reviewed (READY WITH NAMED CHANGES: undici
IP-pinning dispatcher, scholarVerifiedEmail-only allowlist, IPv6 private-IP blocklist) but NOT built; instead
`my-candidates` surfaces the persisted `facultyPageUrl` and `ReviewerInvitePanel` shows a "find on faculty page →"
link on no-email candidates → staff enter the address via the existing Edit (→ `emailSource='manual'` →
Slice-G confirm). Design+decision: `docs/REVIEWER_FACULTY_PAGE_RECOVERY_DESIGN.md`.

## Declined email-recovery source: arXiv author emails (S235 — don't re-propose as an automated fetch)
arXiv DOES expose an email behind a `[view email]` link to logged-in registered users, but harvesting it for
reviewer coverage is a no-go: (1) it's the **submitter's** email (often a grad student/corresponding author,
NOT the senior reviewer our discovery picks as last/PI author); (2) it's behind auth, NOT in the Atom API
(`arxiv-service.js` parses author NAMES only); (3) arXiv **irrevocably blocks an account that views many
emails in a short window** — our exact use pattern — and has a dedicated "Email protection" policy (metadata
is CC0, the email explicitly is not). A safe manual deep-link (staff click `[view email]` on the anchored
paper themselves) was also declined: physics PDs already have arXiv accounts and self-serve, so the link
saves ~one search. Verified via arXiv help pages (email-protection / registerhelp / api/tou). Don't build an
automated arXiv-email fetcher.

## Design docs
`docs/archive/REVIEWER_IDENTITY_CONTACT_FIX_PLAN.md` (+ `_REVIEW`, `_REVIEW_2` Codex passes),
`docs/REVIEWER_IDENTITY_STRATEGY_EVALUATION.md`, `docs/archive/REVIEWER_IDENTITY_VERIFICATION_FINDINGS.md`.
