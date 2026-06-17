# Reviewer Contact / Identity / Invite Hardening — Features & Prod Validation Plan

Date: 2026-06-08
Sessions covered: **S234** (contact-enrichment anchoring) and **S235** (Slices E, G, F).
Scope: the reviewer-finder + review-manager pipeline, from candidate discovery → identity
resolution → contact enrichment → roster/save → invite send.

This document (1) describes every feature shipped across the two sessions and (2) proposes
concrete tests to validate each one **in production**. All features below are merged to `main`
and deployed.

> **How to read the test plan.** Each test gives a *precondition*, *steps*, *expected result*,
> and *where to verify*. Most are manual UI walkthroughs in the Workbench plus a Dataverse
> field check (via the Dynamics Explorer or an OData probe). Known live examples come from
> request **1002794** (attosecond physics), the request used to root-cause S234 — its
> candidates (Smirnova, Chen, Keller, Travers) are the documented real cases. Use a current
> throwaway/test request where a test would otherwise send a real email.

---

## 0. The throughline

All of this work descends from one S234 bug: a reviewer's **identity** resolved correctly,
but **contact/bibliometric enrichment** attached the *wrong* email/website/metrics via
namesake collapse (Smirnova got an ITMO namesake's email; Chen got a *pianist's* gmail +
Van Cliburn page). The governing principle adopted across both sessions:

> **Identity-confirmed ≠ contact-validated. Anchor every contact detail to the resolved
> identity, or abstain. Unresolved is acceptable; wrong-and-confident is not.**

The sessions then extended that principle outward along the pipeline:

| Stage | Risk | Session | Feature |
|---|---|---|---|
| Enrichment | wrong email/site/metrics persisted | S234 | Anchor-or-abstain (Fixes A–D) + Scholar-verified-domain check |
| Selection / save | unresolved candidate saved as "vetted" | S235 | Slice E — identity-review gating |
| Invite send | staff emails a wrong/unverified address | S235 | Slice G — invite-confidence + manual-confirm gate |
| Missing email | confirmed reviewer has no address to invite | S235 | Slice F — faculty-page link (zero-SSRF) |

---

## 1. S234 — Contact-enrichment anchoring

**Where:** `lib/services/contact-enrichment-service.js`,
`pages/api/reviewer-finder/save-candidates.js`, `shared/components/reviewers/reviewer-search-logic.js`.
**Commits:** `6e7dcfb` (A–D), `f14ad11`, `da2451e`, `440bce9` (Scholar-verified-domain),
merged `9396658`.

### 1.1 Features

- **Fix A — anchor the search.** The ORCID-resolved / work-grounded institution is threaded
  into the Tier-3 (Claude), Tier-4 (Serp), and Scholar contact lookups via a *search-only*
  candidate clone, so the query is `"<name>" <institution> email` instead of a bare-name
  search. The input candidate is never mutated (preserves the S224 resolve-on-original
  invariant). This is what actually fixes the namesake: Smirnova → `olga.smirnova@mbi-berlin.de`,
  not the ITMO namesake.
- **Fix B — abstain when unanchored.** No institution anchor **and** no ORCID → skip the
  bare-name paid lookup entirely; emit no contact; set `contactStatus:'unresolved'`. Identity
  and relevance are preserved; only the unsafe contact fetch is skipped.
- **Fix C — per-field persist flags.** `emailPersistAllowed` / `websitePersistAllowed` /
  `affiliationPersistAllowed` are computed at enrichment time and enforced in **both** save
  paths (`save-candidates` and `saveToDatabase`), surviving `pruneCandidateForRoster` so the
  gate still holds after a roster reload. A low-confidence email is never written to
  `wmkf_emailaddress`.
- **Fix D — identity-note clarity.** `buildIdentityNote` surfaces `authorship_grounded`
  (previously read as a topic-only "confirmed").
- **Verified-domain validation** (`_validateEmailAgainstVerifiedDomain`, runs in
  `_finalize`): a candidate email is checked against the **verified institutional domain**
  (`verifiedInstitutionDomain`, e.g. `mbi-berlin.de`) via a **boundary-anchored** domain match
  (hyphen-insensitive, subdomain-aware). A clear contradiction drops a *search-sourced*
  namesake email; ORCID/PubMed (trusted-source) emails are never dropped; with no verified
  domain, the scoped search is trusted. This replaced a brittle lexical institution-**name**
  guard that had wrongly rejected Smirnova's real address. (Slice 1b re-sourced the domain from
  the OpenAlex author's institution homepage; it was the Google-Scholar self-reported domain.)

### 1.2 Prod validation

**T1.1 — Anchored recovery (the canonical case).**
Run the live smoke against the known request: `npm run smoke:reviewer-contact`.
*Expected:* Smirnova recovers `@mbi-berlin.de`; Chen **abstains** (no email persisted);
Keller (`phys.ethz.ch`) and Travers (`hw.ac.uk`) are kept. All live invariants pass (~24 per
the S234 record; re-confirm the count when you run it with creds).
*Caveat (known):* the smoke only exercises 1002794's 4 candidates, one field; it is the
fastest prod signal but not full coverage.

**T1.2 — Abstain leaves no sendable contact.**
*Precondition:* an arXiv-discovered candidate with no institution affiliation and no ORCID.
*Steps:* run discovery + enrichment for that candidate; open the candidate card.
*Expected:* `contactStatus:'unresolved'`; no email/website shown; identity + relevance intact.
*Verify:* card shows no email; in Dataverse the person row has empty `wmkf_emailaddress`.

**T1.3 — Wrong-domain email is dropped, right one kept.**
*Steps:* pick a candidate with an OpenAlex-resolved `verifiedInstitutionDomain` (post-S251 this
replaces the retired Scholar "Verified email at `<domain>`" hint) and whose search snippet also
surfaces a different-domain namesake address.
*Expected:* the address whose domain matches the verified institution domain is persisted; the
contradicting namesake address is not. A trusted ORCID/PubMed email is kept even on a mismatch.
*Verify:* `wmkf_emailaddress` holds the domain-matched address; `wmkf_emailsource` reflects the
real source.

**T1.4 — Persist-flag survives a roster reload.**
*Steps:* surface a low-confidence candidate (email blocked by Fix C), reload the Find tab
(re-fetch the durable roster), then save the candidate.
*Expected:* no email is written on save even after reload (the persist flags rode through
`pruneCandidateForRoster`).

---

## 2. S235 Slice E — identity-review gating

A candidate the system **could not identity-resolve** is now visible but **not
selectable/savable** as a vetted reviewer, at both the UI and the persistence boundary.
**Commits:** `59c945e`, `bac7bb8` (Codex post-impl), merged `39e82b9`.

### 2.1 Features

- **E1 — stamp deferred candidates.** Track-B literature candidates beyond the top-25
  `TRACK_B_IDENTITY_RESOLUTION_LIMIT` were merged into results carrying **no** identity verdict,
  so they landed in the *selectable* group. They are now stamped
  `identityStatus:'unresolved'` / `needsIdentification:true` in `discovery-service.js`, routing
  them to the non-selectable `needs_identity_review` provenance group. Stamped only when not
  already confirmed/probable, so a real verdict is never overwritten.
- **E1b — survive a roster reload (the reload-leak fix).** `pruneCandidateForRoster` now
  persists `identityStatus`/`needsIdentification`/`verificationStatus`. Without this, a deferred
  candidate recorded to the durable Find-roster lost its marker on reload and became selectable
  again. (Found in pre-flight; not in the original plan.)
- **E2 — UI gate (Workbench).** `ReviewerSearchSection` renders the `needs_identity_review`
  section **read-only** (no checkbox) with an explanatory note, and excludes it from
  "select all" and from the save set.
- **E3 — server hard-reject.** `save-candidates` rejects any row whose identity is explicitly
  unresolved (`needsIdentification || identityStatus==='unresolved' || verificationStatus==='unresolved'`):
  per-row skip (write neither the person nor the suggestion), recorded with code
  `identity_unresolved`; HTTP **422** when the whole batch is rejected. This is the load-bearing
  defense for the **standalone Reviewer Finder**, which has no client-side identity grouping.
- **provenanceGroupOf correctness (Codex #3).** A positively-resolved row
  (confirmed/probable/verified) is **never** hidden by the barred/unknown-kind fallback — e.g.
  a barred Track-A row upgraded by a shared-ORCID Track-B match is a legitimate selectable
  reviewer. The server gate stays on the *explicit* unresolved triple (NOT the full
  `provenanceGroupOf`) so BARRED-but-resolver-verdict rows still save with field-level gating.

### 2.2 Prod validation

**T2.1 — Deferred candidate is non-selectable (Workbench).**
*Precondition:* a discovery run that surfaces >25 Track-B literature candidates (so some are
deferred).
*Steps:* open the Find tab; scroll to the "Needs identity review" section.
*Expected:* those candidates render read-only (no checkbox); "Select all" does not select them;
the Save button never counts them.

**T2.2 — Reload-leak is closed.**
*Steps:* after T2.1, reload the Workbench request page (forces a roster reload), and re-open
the Find tab.
*Expected:* the same candidates are **still** in "Needs identity review" and still
non-selectable. (Regression-tested at `tests/unit/reviewer-search-logic.test.js`.)

**T2.3 — Server refuses an unresolved save (standalone page / direct).**
*Steps:* in the standalone Reviewer Finder, attempt to select+save a discovered candidate that
is identity-unresolved. (Or POST one directly to `/api/reviewer-finder/save-candidates`.)
*Expected:* a mixed batch saves the resolved rows and reports the unresolved ones as skipped
(`identity_unresolved`); an all-unresolved batch returns **HTTP 422**. No person or suggestion
row is written for the unresolved candidate.
*Verify:* no new `wmkf_potentialreviewer` / `wmkf_appreviewersuggestion` row for that name.

**T2.4 — No false-positive gating of a resolved reviewer.**
*Steps:* save a confirmed/probable candidate (normal case).
*Expected:* it saves normally and appears in the Candidates tab — it is **not** caught by the
gate even if its provenance kind is unusual.

---

## 3. S235 Slice G — invite-confidence + manual-confirm gate

Staff can no longer **unknowingly** invite a reviewer at a wrong/unverified email. The send
step surfaces email-confidence and requires a conscious one-click confirmation for a
low-confidence address — enforced server-side.
**Commits:** `8ce1957`, `0b8c8ca` (Codex post-impl #6), merged `4b57472`. Design: `706f9c6`.

### 3.1 Features

- **`emailConfidence(person)` helper** (`lib/utils/reviewer-invite.js`, pure + unit-tested):
  - **HIGH** if `wmkf_emailsource ∈ {orcid, pubmed, institution_page}`, OR `∈ {serp_search,
    claude_search}` **and** `wmkf_identitystatus ∈ {confirmed, probable}`.
  - **LOW** otherwise: `manual`, `affiliation`, null/unknown source, or a search email on an
    unconfirmed identity.
- **Manual-source stamping** (`my-candidates.js`): when staff hand-enter/replace an email, the
  person row is stamped `emailSource='manual'` (via the researcher adapter), so a typed address
  reads LOW until confirmed. (Closes the pre-existing bypass where manual edits skipped the
  Fix-C gate.)
- **Per-recipient confidence in the preview** (`render-emails.js`): the render selects
  `wmkf_emailsource`+`wmkf_identitystatus` and returns a per-draft `emailConfidence` (server
  computes it — the modal recipient DTO is too thin to derive it client-side).
- **Modal warning + one-click confirm** (`InviteEmailModal.js`): a LOW recipient shows an amber
  "this address wasn't verified against the reviewer's identity" warning; the send button
  becomes amber **"Confirm & send"**; the confirm dialog **names** the unverified addresses.
- **Server-enforced gate** (`send-emails.js`, the real boundary): it **independently**
  re-computes confidence and **refuses** a LOW recipient unless that recipient's `suggestionId`
  is in the request's **`confirmedLowConfidenceIds`** allowlist (skip reason `email_unconfirmed`).
  The acknowledgement is **recipient-specific, not a batch boolean** (Codex post-impl #6 — a
  batch boolean would let a row that became LOW after preview ride on another row's
  confirmation). The computed confidence is also recorded on each `email_sent` outcome for audit.
- **Scope:** the gate fires only for `templateType==='invitation'` (first contact). Once a
  reviewer accepts via the magic link, the address is proven, so post-acceptance sends
  (materials/followup/thankyou) are not re-gated.

### 3.2 Prod validation

> Use a **test request and a throwaway recipient address you control** for any test that
> actually sends — these create real Dynamics email activities.

**T3.1 — HIGH-confidence invite is frictionless.**
*Precondition:* a candidate whose email is ORCID/PubMed-sourced (or scoped-search on a confirmed
identity).
*Steps:* Candidates tab → invite → preview.
*Expected:* no warning; the button reads "Send N invitations"; sends normally.
*Verify:* recipient receives the invite; the `email_sent` record carries
`emailConfidence.level: 'high'`.

**T3.2 — Manual edit downgrades to LOW + warns.**
*Steps:* on any candidate, Edit → change the email to a (throwaway) address → save. Then invite.
*Expected:* the preview shows the amber warning for that recipient; the button reads
"Confirm & send"; the confirm dialog names the address.
*Verify:* the person row's `wmkf_emailsource` = `manual` after the edit; sending without
acknowledging would be refused (see T3.4).

**T3.3 — One-click confirm sends.**
*Steps:* from T3.2, click "Confirm & send" and accept the dialog.
*Expected:* the invite sends; `email_sent` records `emailConfidence.level: 'low'` (confirmed).

**T3.4 — Server refuses an unconfirmed LOW (the real boundary).**
*Steps:* POST to `/api/review-manager/send-emails` with `templateType:'invitation'`, a draft for
a LOW recipient, and **omit** `confirmedLowConfidenceIds` (or send an empty array).
*Expected:* that recipient is skipped with reason `email_unconfirmed`; no email is sent.

**T3.5 — Recipient-specific allowlist (the #6 fix).**
*Steps:* a batch with two LOW recipients A and B; send `confirmedLowConfidenceIds:[A]` only.
*Expected:* A sends; **B is refused** (`email_unconfirmed`). A's confirmation does not authorize B.

**T3.6 — Post-acceptance is not re-gated.**
*Precondition:* a reviewer who has accepted (so `wmkf_accepted=true`) but whose stored address is
`manual`/LOW.
*Steps:* send a `materials` (or `followup`/`thankyou`) email from the Review Manager panel.
*Expected:* it sends with **no** confidence gate (gate is invitation-only).

---

## 4. S235 Slice F — faculty-page email recovery (zero-SSRF)

When a confirmed/anchored reviewer has **no** accepted email, staff get a one-click path to the
institution's own page to find and enter the address — with **no** server-side page fetch.
**Commits:** `f6b5bd4`, merged `c5a4a0a`.
**S265 update:** the automated fetch was subsequently built behind `REVIEWER_PAGE_EMAIL_TIER_ENABLED`
(**default OFF — this manual path is still the live default**); live design
`docs/RESOLVED_PAGE_EMAIL_TIER_DESIGN.md`, contract #7 in `docs/REVIEWER_FINDER_ENFORCEMENT_CONTRACTS.md`
(supersedes `docs/REVIEWER_FACULTY_PAGE_RECOVERY_DESIGN.md`).

### 4.1 Features

- **DTO carries the faculty page:** `my-candidates` GET now selects `wmkf_facultypageurl` and
  returns `facultyPageUrl` per candidate.
- **Actionable no-email state:** `CandidatesPanel`'s "no email — can't invite" state, when a
  `facultyPageUrl`/`website` exists, shows a **"find on faculty page →"** link (opens in a new
  tab).
- **Reuses the rest of the pipeline:** staff read the real address on that page, enter it via
  the existing Edit modal (`CandidateEditModal` → `my-candidates` PATCH), which stamps
  `emailSource='manual'` (Slice G 3a) → the invite then shows the Slice-G warning + one-click
  confirm.
- **Deliberately NOT built:** the automated server-side fetch (Codex-reviewed, READY WITH NAMED
  CHANGES) — to avoid a new SSRF surface, an `undici` IP-pinning dependency, and the latency
  cost. The verified SSRF mechanism is preserved in the design doc if it's ever revisited.

### 4.2 Prod validation

**T4.1 — Link appears only on a no-email candidate with a page.**
*Precondition:* a saved candidate with no `wmkf_emailaddress` but a non-null `wmkf_facultypageurl`
(or `wmkf_website`).
*Steps:* open the Candidates tab.
*Expected:* the row shows "no email — can't invite · **find on faculty page →**"; the link opens
the persisted faculty page in a new tab. A candidate **with** an email shows the address (no
recovery link); a no-email candidate with **no** page shows the plain "can't invite" text.

**T4.2 — Full recovery loop closes.**
*Steps:* from T4.1, open the faculty page, copy the real address, Edit the candidate → enter it
→ save → invite.
*Expected:* the address persists with `wmkf_emailsource='manual'`; the invite flow then shows
the Slice-G LOW warning + one-click confirm (T3.2/T3.3). End-to-end: *no email → right page →
enter address → confirmed-before-invite.*

---

## 5. Cross-cutting regression checks

**T5.1 — No regression to existing reviewer flows.** A normal end-to-end on a healthy request:
discover → save a confirmed candidate → invite (HIGH, frictionless) → accept → send materials.
Nothing in E/G/F should add friction to the all-green path.

**T5.2 — Counts/invariants intact.** Saved-candidate counts, excluded-set behavior, and the
durable Find-roster dedup behave as before (Slices E/F only *add* fields/links; they don't
change roster identity keys).

**T5.3 — Gate self-tests.** At session start the full `check:*` gate battery is green; re-run
after any follow-on change touching these surfaces (especially `check:agent-wiki` — the
reviewer-identity topic documents all three slices).

---

## 6. Existing automated coverage (for reference; runs in CI / locally, not prod)

| Surface | Tests |
|---|---|
| Contact anchoring (S234) | `npm run smoke:reviewer-contact` (11 offline deterministic checks verified this session; the live battery additionally runs ORCID/Serp/Scholar invariants — ~24 live per the S234 record, requires creds/network); `contact-enrichment-*.test.js`, `contact-parser-*.test.js` |
| Slice E | `reviewer-provenance.test.js`, `reviewer-search-logic.test.js` (reload-leak regression), `reviewer-route-identity-gate.test.js`, `discovery-*.test.js` |
| Slice G | `reviewer-invite.test.js` (7 `emailConfidence` cases; 15 tests in the file), `reviewer-route-identity-gate.test.js` |
| Slice F | none (DTO field + link; no pure logic) — covered by the manual T4.* checks |

Run the reviewer suites: `npx jest reviewer contact provenance discovery identity roster invite save --runInBand`.

---

## 7. Commit index

- **S234:** `6e7dcfb` (Fixes A–D) · `f14ad11` · `da2451e` · `440bce9` (Scholar-verified-domain) ·
  `9396658` (merge) · `2cae67c` (smoke battery) · `77799eb`/`6a4a5f0` (memory).
- **Slice E:** `59c945e` · `bac7bb8` (Codex post-impl) · `39e82b9` (merge).
- **Slice G:** `706f9c6` (design) · `8ce1957` · `0b8c8ca` (Codex post-impl #6) · `4b57472` (merge).
- **Slice F:** `f6b5bd4` · `c5a4a0a` (merge).

## 8. Related design docs
- `docs/REVIEWER_IDENTITY_CONTACT_FIX_PLAN.md` (+ `_REVIEW*`) — S234 design + Codex reviews.
- `docs/REVIEWER_CONTACT_INVITE_FOLLOWON_PLAN.md` — the E/G/F follow-on plan (all shipped).
- `docs/REVIEWER_INVITE_CONFIDENCE_DESIGN.md` — Slice G design + impl notes.
- `docs/REVIEWER_FACULTY_PAGE_RECOVERY_DESIGN.md` — Slice F decision + the unbuilt auto-fetch design.
- `docs/agent-wiki/topics/reviewer-identity.md` — the retrieval/hazard page covering all of the above.
