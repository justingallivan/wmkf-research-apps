---
name: Grant request vs honorarium request nomenclature
description: Both grant proposals AND reviewer honoraria are stored as akoya_request rows in Dataverse — easy to confuse. Use precise terms; the two are not data-linked by default.
metadata:
  type: project
---

**The trap.** Two very different concepts share the `akoya_request` entity. Saying "request" alone is ambiguous and has caused confusion in design conversations (S188).

**Discriminators (live as of 2026-05-25):**

| Term | What it is | Discriminator |
|---|---|---|
| **Grant request** | A proposal from a university asking for funding | `akoya_program ≠ "Research Reviewer"` (e.g., "Medical Research", "Science and Engineering Research") |
| **Honorarium request** | A payment record for an individual who reviewed a grant request | `akoya_program = "Research Reviewer"` AND `wmkf_grantprogram = "Honorarium"` AND `wmkf_type = "Individual"` |

Concrete example: Utah State submitted **grant request** #1002238. Amy Gladfelter agreed to review it and was issued **honorarium request** #1002764 for $250.

**Critical: no data link between them.** Honorarium request #1002764 has ZERO lookup fields pointing back to grant request #1002238. The only way to reconstruct "this honorarium was paid for reviewing which grant?":
- Honorarium row's `_akoya_primarycontactid_value` → the reviewer's contact (Amy)
- Find grant requests where any of `wmkf_potentialreviewer1..5` slot-lookups point to that contact, in the same cycle (`wmkf_meetingdate`)
- Probably one match per cycle

The grant↔reviewer assignment is denormalized on the grant request itself: 5 nomination slots (`wmkf_potentialreviewer1..5` lookups, over-invite buffer) plus `wmkf_reviewer1` (confirmed). The standalone `wmkf_potentialreviewers` entity is a thin record with only `wmkf_contact` outbound.

**Why:** Last cycle (2026-06-04 meeting) was the first time honoraria were tracked in Akoya. Of 85 reviewer-honoraria for that meeting, 77 were paid via Excel and Steph is back-filling for bookkeeping; only 8 have any BILL fields populated.

**How to apply:**
- In design docs, tickets, emails, conversation: use "grant request" or "honorarium request" — never "request" alone.
- When filtering/querying `akoya_request`, ALWAYS state which type the filter is for, and prefer the program-lookup discriminator over heuristics (e.g., $250 amount).
- Don't assume an honorarium has a parent-grant pointer — there isn't one in the data. Reverse-lookup via contact + cycle is the reconstruction.
- See [[project-bill-honorarium-integration]] for the integration that will optionally populate provenance going forward via a proposed `wmkf_honorariumforrequest` lookup.
- See [[akoya-payment-field-semantics]] for related field-gating audit findings.
