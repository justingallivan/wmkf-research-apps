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

Read this when: touching the Stage 2a accept form's payment-address collection (chunk 5) or honorarium BILL onboarding address handling.

Do:
- **THIS CYCLE: treat address+phone as REQUIRED, server-enforced.** The 2026-06-09 BILL deferral (manual payment) settled the "do we need it?" question affirmatively — there is no BILL self-registration this cycle, so staff need the captured address+phone to pay. A non-opted-out FRESH accept that omits the required set (line1/city/postalCode/country/phone) gets `422 payment_contact_required` (`respond.js` `missingRequiredAddressFields`). Opt-out reviewers skip it.
- Treat the collected address as load-bearing going forward: with BILL tabled (2026-07-12), it feeds the owner's planned address-based onboarding via existing foundation systems. (If BILL were ever un-tabled, removal would still be small — form fields + server presence guard + alerting; `validateAddress` stays shape/length-only.)

Do not:
- Re-open the need question: decided (BILL tabled → manual/address-based path → required). Only a future BILL un-tabling re-opens it.
- Add address detail to Dataverse beyond what's needed — brushes against [[project-no-banking-pii-in-dataverse]]'s "only onboarding-status + pointer" constraint.

Ground truth: Stage 2a accept form chunk 5 (`address`+phone → `contact.address1_*`/`address1_telephone1` → BILL vendor payload next cycle); related [[project-bill-honorarium-integration]], [[project-no-banking-pii-in-dataverse]].

The Stage 2a accept form (chunk 5) collects the reviewer's payment mailing address + phone (`address` → `contact.address1_*`, `phone` → `address1_telephone1`). **S200 history:** Justin flagged this might be a relic of the old manual BILL onboarding and was checking whether reviewer self-registration in BILL.com captures the address on BILL's side, making our collection redundant. **2026-06-09 update:** leadership deferred automated BILL onboarding to next cycle and payment is MANUAL this cycle, so the address+phone are unambiguously needed now — the provisional flag is resolved FOR THIS CYCLE. **2026-06-10:** Justin chose to enforce presence server-side (Codex post-impl catch: client-only enforcement let a direct POST create a no-contact honorarium); hardening is justified by manual payment + the public-token surface.

**Why:** the original redundancy concern was "if BILL registration already captures remittance address, our form is duplicate entry." That only bites NEXT cycle when BILL is back on. This cycle there is no BILL path, so the address+phone is the ONLY contact info staff have for manual payment — collecting AND requiring it is correct, not provisional.

**CLOSED as MOOT (2026-07-12):** the earlier "NEXT cycle MAY RELAX the hard requirement" item (Justin, 2026-06-10) was premised on BILL self-registration capturing the remittance address when BILL came back. The owner has since TABLED the BILL API integration for several months, possibly permanently, and plans to onboard reviewers using their address + existing foundation systems — which makes our collected address+phone load-bearing, not redundant. Keep the requirement and the server-side `payment_contact_required` gate as-is; re-evaluate only if BILL is ever un-tabled. See [[project-bill-honorarium-integration]] and [[Reviewer honorarium onboarding/payment reality (current-state, reverse-engineered)]].
