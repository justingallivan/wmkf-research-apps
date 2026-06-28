---
name: Grant request vs honorarium request nomenclature
description: Both grant proposals AND reviewer honoraria are stored as akoya_request rows in Dataverse — easy to confuse. Use precise terms; honorarium rows have a shipped reviewer-suggestion provenance link.
metadata:
  type: project
  status: active
  scope: bill
  last_verified: 2026-06-27 — re-probed live (#1002764 person vs #1002794/#1002238 institutions)
---

## Recall Rule

Read this when: writing or discussing anything involving `akoya_request` rows where grant proposals and reviewer honoraria could be confused (design docs, tickets, emails, query filters).

Do:
- Say "grant request" or "honorarium request" — never "request" alone.
- When filtering `akoya_request`, state which type and use the program-lookup discriminator (`akoya_program`/`wmkf_grantprogram`/`wmkf_type`/`wmkf_request_type`), not heuristics like the $250 amount.
- Prefer the shipped reviewer-suggestion provenance link for portal-created honoraria; for older/backfilled honoraria without that link, reconstruct via the reviewer's contact (`_akoya_primarycontactid_value`) + matching grant cycle (`wmkf_meetingdate`).

Do not:
- Assume an honorarium row has a parent-grant lookup — there is none by default.

Ground truth: live discriminators as of 2026-05-25 in body; [[project-bill-honorarium-integration]]; [[akoya-payment-field-semantics]]. Grant↔reviewer assignment denormalized on the grant request (`wmkf_potentialreviewer1..5`, `wmkf_reviewer1`).

**The trap.** Two very different concepts share the `akoya_request` entity. Saying "request" alone is ambiguous and has caused confusion in design conversations (S188).

**Discriminators (re-probed live 2026-06-27, #1002764 person vs #1002794/#1002238 institutions):**

| Term | What it is | Discriminator |
|---|---|---|
| **Grant request** | A proposal from a university asking for funding | `akoya_program ≠ "Research Reviewer"` (e.g., "Medical Research", "Science and Engineering Research") |
| **Honorarium request** | A payment record for an individual who reviewed a grant request | `akoya_program = "Research Reviewer"` AND `wmkf_grantprogram = "Honorarium"` AND `wmkf_type = "Individual"` AND `wmkf_request_type = "Individual"` |

Concrete example: Utah State submitted **grant request** #1002238. Amy Gladfelter agreed to review it and was issued **honorarium request** #1002764 for $250.

**Two single-field discriminators that say person-vs-institution directly (re-probed 2026-06-27):**
- **`akoya_requesttype`** (option-set on the request itself, no lookup hop) — **`Scholarship` (100000001) = individual/honorarium**, **`Grant` (100000000) = institution**. Verified: Amy #1002764 = Scholarship; #1002794 + #1002238 = Grant.
- **Applicant-account presence** — institution/grant requests have `_akoya_applicantid_value` → an `account` (Wayne State University #1002794, Utah State University #1002238) that **IS the payee**; honorarium/individual requests have `_akoya_applicantid_value = null`, and the payee is the person on `_akoya_primarycontactid_value` (a `contact`). The structural "who gets paid" tell: **applicant `account` present = institution; contact-only, no applicant account = individual.** (Both kinds still have a primary contact, so primary-contact presence alone does NOT discriminate.)

This payee-type split is the crux for any "mimic the grant→BILL payment flow for honoraria" work — the vendor record and BILL id live on the `account` for orgs, not the contact: see [[akoya-payment-field-semantics]].

**Critical: old/backfilled rows may have no data link between them.** Honorarium request #1002764 had ZERO lookup fields pointing back to grant request #1002238. For those rows, reconstruct "this honorarium was paid for reviewing which grant?" via:
- Honorarium row's `_akoya_primarycontactid_value` → the reviewer's contact (Amy)
- Find grant requests where any of `wmkf_potentialreviewer1..5` slot-lookups point to that contact, in the same cycle (`wmkf_meetingdate`)
- Probably one match per cycle

The grant↔reviewer assignment is denormalized on the grant request itself: 5 nomination slots (`wmkf_potentialreviewer1..5` lookups, over-invite buffer) plus `wmkf_reviewer1` (confirmed). The standalone `wmkf_potentialreviewers` entity is a thin record with only `wmkf_contact` outbound.

**Why:** Last cycle (2026-06-04 meeting) was the first time honoraria were tracked in Akoya. Of 85 reviewer-honoraria for that meeting, 77 were paid via Excel and Steph is back-filling for bookkeeping; only 8 have any BILL fields populated.

**How to apply:**
- In design docs, tickets, emails, conversation: use "grant request" or "honorarium request" — never "request" alone.
- When filtering/querying `akoya_request`, ALWAYS state which type the filter is for, and prefer the program-lookup discriminator over heuristics (e.g., $250 amount).
- Don't assume an honorarium has a parent-grant pointer — there isn't one in the data. Reverse-lookup via contact + cycle is the reconstruction.
- See [[project-bill-honorarium-integration]] for the integration that now populates provenance via `wmkf_HonorariumRequest` on `wmkf_appreviewersuggestion` (bind `wmkf_HonorariumRequest@odata.bind`, read `_wmkf_honorariumrequest_value`), not the abandoned proposed `wmkf_honorariumforrequest` name.
- See [[akoya-payment-field-semantics]] for related field-gating audit findings.
