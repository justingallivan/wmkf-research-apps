---
name: project-reviewer-address-collection-provisional
description: Reviewer payment-address(+phone) collection on Stage 2a accept — RESOLVED, required and server-side enforced. The old next-cycle redundancy-vs-BILL-self-registration question is MOOT since the 2026-07-12 BILL tabling; the address is now central (owner plans address-based onboarding via existing systems).
metadata:
  type: project
  status: active
  scope: bill
  last_verified: 2026-07-12 — re-grounded after the owner tabled the BILL API integration (address-based onboarding instead); requirement now load-bearing
---

## Recall Rule

Read this when: touching the Stage 2a accept form's payment-address collection (chunk 5) or the owner's address-based reviewer onboarding plan.

Do:
- Keep Stage 2a address+phone REQUIRED and server-enforced. A non-opted-out fresh accept that omits line1/city/postalCode/country/phone gets `422 payment_contact_required` (`respond.js` `missingRequiredAddressFields`); opt-out reviewers skip the guard. The owner tabled the BILL API integration on 2026-07-12 and plans address-based onboarding through existing Foundation systems. No automatic BILL integration date or next-cycle handoff is committed.
- Treat the collected mailing address and phone as load-bearing for that owner-directed path. This does not authorize storing bank-account, routing, or remittance details in Dataverse.

Do not:
- Re-open the old redundancy question based only on the prospect of BILL self-registration. Revisit the collection requirement if the owner changes the address-based onboarding decision.
- Add more address detail or duplicate the existing Stage 2a contact fields without an owner decision. The no-banking-PII policy remains: do not store bank-account, routing, or remittance details in Dataverse.

Ground truth: Stage 2a accept form chunk 5 (`address`+phone → `contact.address1_*`/`address1_telephone1`); the owner plans address-based onboarding through existing Foundation systems and has tabled the BILL API integration (2026-07-12), with no next-cycle integration promise. Related [[project-bill-honorarium-integration]], [[project-no-banking-pii-in-dataverse]].

The Stage 2a accept form (chunk 5) collects the reviewer's payment mailing address + phone (`address` → `contact.address1_*`, `phone` → `address1_telephone1`). **S200 history:** Justin flagged this might be a relic of the old manual BILL onboarding and was checking whether reviewer self-registration in BILL.com captures the address on BILL's side, making our collection redundant. **2026-06-09/10 history:** automated BILL onboarding was deferred, payment was manual for that cycle, and address presence was made server-enforced after a direct POST could create a no-contact honorarium. The historical decision established the required-field guard; it does not set a future BILL integration date.

**Why:** the original redundancy concern assumed future BILL self-registration might capture an address. The owner's 2026-07-12 decision tabled the BILL API integration and instead plans address-based onboarding via existing Foundation systems. The required address+phone therefore remain part of the Stage 2a contract; this memory does not promise a BILL handoff in a later cycle.

**CLOSED as MOOT (2026-07-12):** the earlier possibility of relaxing the requirement when BILL self-registration returns was premised on an integration the owner has tabled for several months, possibly permanently. The owner plans address-based onboarding through existing Foundation systems instead. Keep the required fields and server-side `payment_contact_required` gate unless the owner changes that approach. No automatic BILL API handoff or cycle date is committed. See [[project-bill-honorarium-integration]] and [[Reviewer honorarium onboarding/payment reality (current-state, reverse-engineered)]].
