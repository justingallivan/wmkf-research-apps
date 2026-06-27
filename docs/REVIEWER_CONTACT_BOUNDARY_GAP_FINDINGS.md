# Reviewer ↔ CRM-Contact Boundary Gap — Findings & Design Stub

Status: **FINDINGS / DESIGN STUB. One increment SHIPPED (2026-06-26): the
duplicate-contact-on-corrected-email fix — `ensureContact` ORCID fallback (see §Status /
Next Step). Owner policy decisions RESOLVED 2026-06-27 (see §Policy Decisions). Increment 1
(origination-time contact match + honorarium split-contact ORCID cross-check) SHIPPED
2026-06-27 (commit 35693cf2). Reviewer→CRM-contact field sync remains deferred to a
later policy-gated increment.**
Drafted: 2026-06-25 (S290)
Owner: reviewer-finder
Scope: the `wmkf_potentialreviewers` ↔ CRM `contacts` boundary (reviewer origination,
correction propagation, promote-on-accept). Distinct from the shipped reviewer-record
merge (`docs/REVIEWER_MERGE_DESIGN.md`), which operates on the potentialreviewer ↔
potentialreviewer boundary.

> **Provenance.** This note records a Codex-led source trace (S290) commissioned to
> verify a hypothesis Claude raised. The file:line citations are Codex's, independently
> verified against live source. Codex **corrected two** of Claude's initial trace points
> (marked `[CORRECTED]` below). Treat the citations as the evidence; re-confirm live
> before acting, per the durable-docs rule.

---

## Problem Statement

Program Directors can save or work with a reviewer who already exists in CRM, but the
reviewer pipeline does not reliably connect that reviewer candidate to the existing CRM
contact early enough. Later, when the reviewer or PD corrects identity/contact
information, those corrections usually stay on reviewer-pipeline records instead of
updating the CRM contact. This can leave duplicate or stale CRM contact data even though
staff and reviewers supplied better information.

**Technical addendum:** the gap is specifically the `wmkf_potentialreviewers` ↔ CRM
`contacts` boundary. It is separate from the shipped reviewer-record merge, which merges
duplicate `wmkf_potentialreviewers` rows and explicitly blocks when a losing row is
already linked to a CRM contact.

---

## Current-State Map

1. **[VERIFIED — `pages/api/reviewer-finder/save-candidates.js:271`, `pages/api/reviewer-finder/discover.js:191`, `lib/services/deduplication-service.js:239`, `lib/dataverse/adapters/potential-reviewer.js:238`]**
   `save-candidates` writes through `potentialReviewerAdapter.upsertByEmail`,
   `researcherAdapter.upsertByPotentialReviewer`, and `reviewerSuggestionAdapter.upsert`,
   with no CRM `contacts` lookup in the save flow. `discover` produces/ranks transient
   candidates and uses `DeduplicationService`; it does not query `contacts`.
   `DeduplicationService` dedupes candidates against each other and proposal authors, and
   explicitly notes discovery does not save researchers. A `wmkf_potentialreviewers` row
   can therefore be created for someone who already exists as a CRM contact, with no link
   established.

2. **[CORRECTED — `pages/api/external/review/[token]/respond.js:299`, `lib/dataverse/adapters/reviewer-suggestion.js:977`, `lib/services/capture-self-reported-orcid.js:76`, `:83`, `pages/api/reviewer-finder/save-candidates.js:127`, `:190`, `:271`, `:280`]**
   Reviewer `contactEdits` are mapped by `applyStage2aResponse` to
   `wmkf_reviewerfirstname`, `wmkf_reviewerlastname`, `wmkf_reviewernickname`,
   `wmkf_reviewertitle`, `wmkf_revieweraffiliation`, `wmkf_revieweremail`, and
   `wmkf_reviewerorcid` on the suggestion row. Self-reported ORCID is sticky on
   `wmkf_potentialreviewers` and **can** fill contact `wmkf_orcid` — but only if a contact
   link/contact id is already present. PD identity-contact correction is written through
   the save-candidates potentialreviewer/researcher path, not CRM contact. The core claim
   holds — corrections don't write to CRM contact — but the ORCID capture is richer than
   Claude's initial trace: it does propagate to an *already-linked* contact.

3. **[CORRECTED — `pages/api/review-manager/send-emails.js:455`, `:481`, `lib/bill/honorarium-onboard-orchestrator.js:78`, `:92`, `:217`, `pages/api/workbench/enrich-recommended.js:445`, `pages/api/workbench/manual-reviewer.js:263`, `lib/services/backprop-reviewer-orcid.js:5`, `lib/services/capture-self-reported-orcid.js:83`]**
   Honorarium onboarding is **not** the only reviewer→contact promotion path (Claude's
   initial trace undercounted). `send-emails` and `workbench/enrich-recommended` also
   promote/link. ORCID back-prop runs in send-emails, honorarium onboarding, and workbench
   enrich-recommended. Honorarium additionally patches mailing address/phone to contact.
   These are all targeted flows, **not** a general sync of reviewer-corrected
   name/email/affiliation back to CRM contact.

4. **[VERIFIED — `lib/bill/honorarium-onboard-orchestrator.js:195`, `lib/dataverse/adapters/contact.js:56`, `:75`, `:107`, `:123`]**
   `ensureContact` uses `body.contactEdits.email || reviewer.wmkf_emailaddress`, then calls
   `contacts.findOrCreateByEmail`. `findByEmail` matches only `contacts.emailaddress1`, and
   `findOrCreateByEmail` creates a new contact on miss. If the reviewer-corrected email
   differs from an existing contact's `emailaddress1`, this path misses that contact and
   creates a **duplicate**. The adapter already has ORCID candidate lookup
   (`findByOrcidCandidates`) and name-ranking helpers, but `ensureContact` does not use them.

5. **[VERIFIED — `lib/services/reviewer-merge.js:133`, `docs/REVIEWER_MERGE_DESIGN.md:138`, `:313`]**
   The shipped merge service blocks with `loser_has_contact` when the losing row has
   `_wmkf_contact_value`. The design doc states there is no contact step because a loser
   with a contact is blocked, and lists two-contact merge plus save-candidates entry points
   as explicitly out of scope.

**Additional finding (Codex):** the manual reviewer add
(`lib/services/reviewer-identity-lookup.js:196`, `:233`, `:242`) already has a better
identity-lookup pattern — ORCID across potentialreviewers and contacts, then email, then
name candidates. This is a closer precedent than `contact-bridge-service` for staff-facing
reviewer identity matching.

---

## Distinct Failure Modes

- **No-match-at-origination** — Claude/PD-saved candidates are upserted by potentialreviewer
  email and not checked against existing CRM contacts. [`save-candidates.js:271`,
  `potential-reviewer.js:220`]
- **Corrections-stranded** — reviewer-supplied name/email/title/affiliation corrections stay
  on the suggestion row; PD override corrections stay on potentialreviewer/researcher rows.
  Neither writes to CRM contact. [`reviewer-suggestion.js:977`, `save-candidates.js:190`]
- **Email-only-match-spawns-duplicate** — honorarium fallback contact creation uses
  corrected/current email only, so an existing contact filed under another email is missed
  and a new contact is created. [`honorarium-onboard-orchestrator.js:195`, `contact.js:75`]
- **ORCID/affiliation sync gap** — affiliation is never propagated to CRM contact by any
  correction path. ORCID propagates only when a contact link already exists or a later
  promotion fires — it remains stranded on the potentialreviewer until then.
  [`capture-self-reported-orcid.js:76`, `:83`]

---

## Blast Radius

The origination gap affects only candidates staff actually save (discovery is transient and
does not persist). The risk is broadest for reviewers already in CRM from prior cycles or
non-reviewer workflows, because save-candidates keys against `wmkf_potentialreviewers` email
only.

The correction-stranding gap surfaces whenever reviewers use external-portal correction
fields or PDs use the identity-confirm override. It is most visible downstream when CRM
contact data is used for outreach, relationship history, honorarium, or cross-cycle
recognition.

The duplicate-contact-on-corrected-email bug is narrower but higher impact. It requires: an
accept/honorarium path, the potentialreviewer lacking an existing contact link, and the
corrected email not matching the CRM contact's `emailaddress1`. Send-emails normally promotes
earlier; but that promotion is non-fatal and can be skipped or fail, so honorarium is a real
fallback where this bug can fire.

---

## Relationship to the Shipped Merge Feature

The merge feature collapses duplicate `wmkf_potentialreviewers` rows when the loser is
pre-engagement. It explicitly does **not** handle CRM-contact dedup or contact-side
reconciliation: a loser with `_wmkf_contact_value` is blocked as `loser_has_contact`, and the
design doc lists two-contact merge and save-candidates entry points as out of scope. This
potentialreviewer ↔ CRM-contact boundary gap is therefore unowned by that feature and belongs
to a separate increment.

---

## Policy Decisions — RESOLVED 2026-06-27 (owner: Justin)

All six open questions are answered. These decisions govern **Increment 1**
(origination-time contact match + honorarium split-contact cross-check). Field-sync
overwrite mechanics (Q3/Q4) remain **deferred** to a later, separately policy-gated
increment.

1. **Auto-link vs. surface-for-staff:** HYBRID. Auto-link on a *unique* exact
   identity-key hit; surface-for-staff confirmation on anything weaker or ambiguous.
2. **Safe auto-link keys:** unique exact ORCID **or** unique exact normalized email only.
   Name-plus-affiliation = staff-confirmation candidate only (never auto-link). Any split
   (email→contact A, ORCID→contact B) or multi-hit → no auto-link. Consistent with the
   shipped `ensureContact` posture.
3. **Conflict ownership:** field-by-field, *additive-not-overwrite* — and moot for
   Increment 1 (link-only). When field sync is built: CRM staff own the canonical contact;
   reviewer/PD corrections *propose*, they never silently overwrite history-bearing CRM
   fields.
4. **Sync direction:** NONE in Increment 1 (link only). Later: one-way reviewer→contact for
   safe *additive* fields only (e.g. ORCID when the contact has none); a review-task/alert
   for anything that would overwrite an existing CRM value. Never bidirectional.
5. **Ambiguous match handling:** save unlinked + durable `system_alerts` warning (reuse the
   `contact_duplicate_risk` surface). Do NOT block save or invite. Mirrors the honorarium
   create+flag-never-block posture and the recall-over-precision preference.
6. **Honorarium refuse-to-create on different-email contact:** NO — keep create+flag, never
   block. Someone who did the work must get paid; Bill.com address/payment correctness is
   the payee's responsibility. BUT close the split-contact gap: run the ORCID cross-check on
   email *hit* too — if email→contact A while a unique ORCID→contact B, flag via
   `system_alerts`, proceed with the email-matched contact, never block.
   - **Payment-email legitimacy (owner note):** a user-supplied payment email that differs
     from CRM `emailaddress1` is *often legitimate* (people use a personal/payment email vs.
     their institutional email of record). Do NOT treat the mismatch as a conflict to
     suppress, and do NOT overwrite the contact's `emailaddress1` with the supplied payment
     email — it is payment-routing context, not a correction to the CRM record of truth. Use
     ORCID to link to the right existing contact (avoiding a duplicate); the supplied email
     rides along to Bill.com without clobbering the contact of record.

---

## `contact-bridge-service` Assessment

`lib/services/contact-bridge-service.js` is a useful precedent for ordered contact resolution
and a conflict posture, but not directly reusable as-is. It resolves applicant-portal sessions
by OID first, then email-link only when `wmkf_portaloid` is empty, then create — and it returns
conflicts instead of silently taking over another identity. [`contact-bridge-service.js:11`,
`:204`, `:210`, `:245`] The reviewer origination case lacks `wmkf_portaloid`, but should copy
the same shape: ordered keys, explicit conflict branch, create only after match attempts, and
no silent identity capture. The closer code precedent for reviewer-side lookups is
`lib/services/reviewer-identity-lookup.js`, which already orchestrates ORCID/email/name across
both potentialreviewers and contacts in the manual-add path.

---

## Design Stub — Origination-Time Contact Match (NOT BUILT; scope only)

**Where to hook in:** `pages/api/reviewer-finder/save-candidates.js`, after the route has
computed gated identity/contact values (`candidateEmail`, `candidateAffiliation`,
`candidateOrcid`) and before `potentialReviewerAdapter.upsertByEmail`. At that point
identity/COI gates have been applied and the identifiers needed for lookup are available.
[`save-candidates.js:180`, `:193`, `:271`]

**Match keys and existing helpers:** exact ORCID first (when valid), then exact normalized
email, then name-plus-affiliation as a staff-confirmation candidate only (not auto-link).
`contact.findByOrcidCandidates`, `contact.findByEmailCandidates`, and `contact.searchByName`
already exist; `lookupReviewerIdentity` already orchestrates ORCID/email/name across both
stores and handles split conflicts. [`contact.js:95`, `:107`, `:141`,
`reviewer-identity-lookup.js:196`] Affiliation-aware ranking would need a small addition or
staff review, as the current contact select does not include affiliation fields.

**Fail-open/fail-closed posture:** fail-open for saving the reviewer candidate; fail-closed for
automatic linking. If contact lookup is unavailable, save the candidate unlinked and surface a
durable warning. If a unique, high-confidence contact match exists, link it with
`potentialReviewerAdapter.setContactLink`. If the match is ambiguous or split across
ORCID/email, do not auto-link — return a staff resolution item. [`potential-reviewer.js:314`]

**What to do on match:** link only in the first increment; do not auto-merge corrected
name/email/affiliation into CRM contact in the same step. The contact link alone prevents later
promotion from creating a duplicate contact and lets existing ORCID back-prop/address flows use
the established contact. Field sync should be a separate, policy-backed change.

**Duplicate-contact-on-corrected-email fix:** harden `ensureContact` to add an ORCID fallback
before creating a new contact. If `findOrCreateByEmail` misses, use reviewer/self-reported ORCID
with `contact.findByOrcidCandidates`; if exactly one contact matches and there is no split
conflict, use that contact and set the potentialreviewer link. If ORCID/email disagree or the
ORCID match is ambiguous, alert/return a conflict instead of creating a fresh duplicate by
default. [`honorarium-onboard-orchestrator.js:191`, `contact.js:75`, `:107`]

**Interaction with promote-on-accept / honorarium-onboard:** send-emails promotes only when the
person has no `_wmkf_contact_value`; honorarium `ensureContact` returns the existing link
immediately on match. So origination-time linking would make those later paths skip creation and
continue with ORCID back-prop and address capture as designed. [`send-emails.js:455`,
`honorarium-onboard-orchestrator.js:191`]

**Correctness / data-corruption / staff-stranding risks:**
- Wrong-contact auto-link is worse than a duplicate — name-only matching is unsafe without staff
  confirmation.
- A corrected email can be legitimate even when CRM has the old email; that should not trigger a
  conflict block.
- Silently overwriting CRM contact fields could corrupt donor/applicant history — do not
  auto-sync fields until policy is set.
- Saving unlinked on lookup failure can strand staff unless the warning is durable and visible in
  the workbench.

---

## Status / Next Step

**SHIPPED 2026-06-26 — duplicate-contact-on-corrected-email fix (`ensureContact` ORCID fallback).**
`lib/bill/honorarium-onboard-orchestrator.js` `ensureContact` now, on an email miss, falls back to
the reviewer's ORCID (`contacts.findByOrcidCandidates`) before creating: a unique match LINKS to the
existing contact; an ambiguous match creates new + logs a `contactDuplicateRisk` staff-review warning
AND writes a durable `system_alerts` row (`warning` severity, type `contact_duplicate_risk`, category
`reviewers`, deduped one-per-reviewer via `autoResolveKey`) that surfaces on the /admin alerts
dashboard (`pages/api/admin/alerts.js`) — best-effort, a notify failure never blocks the honorarium;
link-only, no field sync; fail-open throughout. A concurrency guard binds the honorarium to the reviewer's existing LIVE contact link if
one appeared since the reviewer row was read. Owner decisions: unique-ORCID→link; ambiguous→create+flag
(never block). Tests in `tests/unit/honorarium-onboard-orchestrator.test.js`. Codex-reviewed.

**SHIPPED 2026-06-26 — durable staff-visible surface for the `contactDuplicateRisk` flag.** The
ambiguous-ORCID case now writes a `system_alerts` row (see the SHIPPED note above) that staff see on
the /admin alerts dashboard, so the flag no longer lives only in server logs. An in-*workbench* (per
reviewer card) surface remains optional, not required.

**SHIPPED 2026-06-27 — Increment 1 (commit 35693cf2).** Origination-time contact match in
`save-candidates` (the "Design Stub" section) — `lookupReviewerIdentity` over both stores, then
`setContactLink` on a confident unique ORCID/email match; candidates/conflict → save unlinked +
durable `reviewer_contact_match_needs_review` system_alerts warning; pdConfirmed rows lookup
email-only; fail-open per candidate. AND the honorarium split-contact ORCID cross-check on email
*hit* in `ensureContact` — email→A vs unique ORCID→B raises a `contact_orcid_email_split` warning
and proceeds with the email-matched contact (never blocks, never overwrites `emailaddress1`).
Owner decisions per §Policy Decisions; no migration (alert_type is free-text VARCHAR(50)); +63
unit tests. Still **deferred** to a later, separately policy-gated increment: any
reviewer→CRM-contact field sync.
