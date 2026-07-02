---
title: "Reviewer ↔ Contact linker & consistency — design notes (v0, not built)"
domain: reviewer-workbench
kind: spec
status: active
summary: "1. wmkf_potentialreviewers ↔ wmkf_potentialreviewers — duplicate reviewer rows (the misspelled-duplicate bug). Being fixed now..."
canonical: false
cataloged: 2026-07-02
owner: product-engineering
related:
  - docs/REVIEWER_MERGE_DESIGN.md
  - docs/CONNOR_CONTACT_MERGE_AND_REVIEWER_LINKING.md
  - scripts/probe-pr-contact-email-overlap.js
  - scripts/probe-contact-dedup.js
---

# Reviewer ↔ Contact linker & consistency — design notes (v0, not built)

status: PLANNED (not built) — design capture 2026-06-25 (S289)
owner: reviewer-finder

> Forward-looking. Nothing here is built. Sibling docs:
> `docs/REVIEWER_MERGE_DESIGN.md` (reviewer↔reviewer merge, being built S289) and
> `docs/CONNOR_CONTACT_MERGE_AND_REVIEWER_LINKING.md` (contact↔contact dedup +
> the open questions to Connor). This doc is the **reviewer↔contact** half.

## Why this exists (the three problems, restated)

1. `wmkf_potentialreviewers` ↔ `wmkf_potentialreviewers` — duplicate reviewer rows
   (the misspelled-duplicate bug). Being fixed now (`REVIEWER_MERGE_DESIGN.md`).
2. **`wmkf_potentialreviewers` ↔ `contacts`** — linking a reviewer to its CRM
   contact and keeping identity consistent. **This doc.**
3. `contacts` ↔ `contacts` — duplicate contacts. Connor (native Dynamics merge).

The CRM contact is the **payment identity** (BILL vendor, mailing address); an
accepted reviewer must become a contact to be paid. The "decades of data" reviewer
corpus effectively lives in the **~16,995 CRM contacts**, not in the reviewer-finder
table.

## Evidence gathered today (read-only prod probes, 2026-06-25 — point-in-time)

- `scripts/probe-pr-contact-email-overlap.js`: of 4,298 active reviewers with an
  email, **458 match a CRM contact by email but only 3 carry the
  `_wmkf_contact_value` link → 455 already exist as a contact, unlinked.**
- `scripts/probe-contact-dedup.js`: ~547 high-precision (name+email) contact-dup
  clusters / ~600 redundant rows (Connor's half). Only 3 reviewers are promoted at
  all (all test records).
- **Matching caveats (load-bearing):** email-only matching is unsafe — shared
  institutional inboxes (`president@…`, `recsec@mit.edu`, grants offices) put
  different people on one email; and a real name mismatch surfaced ("David
  Schweppe" reviewer vs. "Devin Schweppe" contact on a shared UW email). So any
  auto-link MUST corroborate with name and/or ORCID, never email alone.

## Current state (verified S289 — what exists vs. what doesn't)

- **Promotion (reviewer → contact) happens in 3 places, all via
  `contactAdapter.findOrCreateByEmail` → `potentialReviewerAdapter.setContactLink`:**
  first reviewer email send (`send-emails.js:467`), accept+honorarium
  (`honorarium-onboard-orchestrator.js:209`), manual add (`manual-reviewer.js:265`).
  So promotion is on first outreach, not at payment.
- **Cross-store "is this person already a contact?" check exists but is wired into
  ONE path only — manual add.** `lookupReviewerIdentity` (queries BOTH
  `wmkf_potentialreviewers` and `contacts` by ORCID→email→name) is called from
  `manual-reviewer.js:137` / `reviewer-lookup.js`. The **automated discovery /
  enrichment** services (`claude-reviewer-service`, `discovery-service`,
  `contact-enrichment-service`) **do not import the contact adapter at all** — they
  never check the CRM. So the common (auto-discovery) path never asks "seen before?"
- **Identity sync is one-way and ORCID-only.** `backprop-reviewer-orcid.js` pushes
  a reviewer's ORCID onto the linked contact ONLY if the contact's ORCID is empty
  (fill-only, conflict-safe). **Email / affiliation / address do NOT propagate**
  reviewer→contact, and there is **no reverse sync**. So a re-engaged reviewer who
  moved institutions drifts from their paid contact silently.

## Proposed capabilities (in rough priority)

### A. "Seen before?" — cross-check contacts at identification (cheap, high value)
Run the existing `lookupReviewerIdentity` during discovery/enrichment (not just
manual add) and surface the match to the PD: "this reviewer is already CRM contact
X (used on N requests / last paid …)". Reuses built machinery; the main work is
calling it in the auto path and displaying the result. Must use the
name/ORCID-corroborated match, not email-only (see caveats).

### B. Consistency diff (reviewer data vs. contact) (cheap once A runs)
When a match is found, diff email / affiliation / ORCID between the reviewer record
and the contact. Consistent → reassure. Divergent → surface the conflict. The
field-diff shape from the merge picker (`reviewer-merge.js` `planMerge.fields`) is
directly reusable.

### C. Guarded PD edit of an existing contact on divergence (the risky one)
On divergence, let the PD push the newer reviewer-side info onto the contact —
**guarded**:
- **Allowed** when the contact is NOT associated with an active award.
- **Blocked** (and the change is NOT written) when it is, with a message like
  "this change could disrupt active grant communications — contact an
  administrator."
- **"Associated with an active award" predicate (Connor, grounded S289):**
  the contact is linked to an `akoya_request` with **`akoya_requeststatus = 'Active'`**
  — already an established filter: `GRANTEE_AWARDED_STATUS = 'Active'`
  (`grantee-deliverables/awardees.js:80`, `cycle-export.js:73`;
  `akoya_requeststatus` is a discrete String field, `compiler.js:45`). The exact
  set of contact→request link fields that count (applicant `_akoya_applicantid_value`,
  primary contact `_akoya_primarycontactid_value`, honorarium payee, …) needs its
  own short probe and a fail-closed predicate, the same way the merge engagement
  predicate was built. **Build this guard fail-closed: unknown/unresolvable
  association ⇒ block, not allow.**
- **Honest scoping:** this is a guardrail on OUR path, not a system-wide lock.
  Policy already lets any PD edit any contact directly in Dynamics; our guard only
  prevents accidental breakage *through the reviewer UI*. Don't oversell it as a
  vault.

### D. The idempotent linker (the durable core)
For each reviewer, find its best contact match (email **plus** name/ORCID
corroboration) and ensure `wmkf_contact` points at it. Properties:
- **Idempotent + re-runnable** — running twice converges; safe to run before AND
  after Connor's contact dedup, so reviewers land on the surviving master
  regardless of the Dynamics merge cascade behavior (Connor Q1).
- Skip ambiguous matches (multiple plausible contacts) → leave for staff, don't
  guess. Mirrors `lookupReviewerIdentity`'s candidates/conflict outcomes.
- Respects the 1:1 `wmkf_contact_unique` key (one reviewer per contact); never
  links both members of a known dup pair.

## Dependencies & open questions

- **Connor Q1–Q4** (`CONNOR_CONTACT_MERGE_AND_REVIEWER_LINKING.md`): contact-merge
  reparent cascade on `wmkf_contact`; the 1:1 collision behavior; a loser→master
  GUID map (so we can reconcile our Postgres `bill_onboarding_state.reviewer_contact_id`);
  shared-inbox exclusions. The idempotent linker (D) is designed to be robust even
  if Q1 is unfavorable, but the answers shape ordering.
- **"Active award" link-field set** — needs a probe (which of applicant / primary
  contact / honorarium links count) before the guard predicate is final.
- **Sequencing vs. Connor's dedup** — run the linker AFTER his dedup wave so it
  targets surviving masters; the consistency/guarded-edit features (A–C) are
  independent and can land earlier.

## Reuse from the merge build (already written S289)

- Field-diff shape: `lib/services/reviewer-merge.js` `planMerge().fields`.
- Fail-closed predicate pattern (block on a comprehensive signal set, evaluated at
  execute time from live source): the merge block predicate is the template for the
  "active award" guard.
- GUID-validation + `requireAppAccess` route pattern:
  `pages/api/reviewer-finder/merge-candidates.js`.
