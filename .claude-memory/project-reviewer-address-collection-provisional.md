---
name: project-reviewer-address-collection-provisional
description: Reviewer payment-address(+phone) collection on Stage 2a accept — RESOLVED FOR THIS CYCLE (2026-06-09 BILL deferral → manual payment → address+phone definitely needed, now server-side enforced). Next-cycle redundancy-vs-BILL-self-registration question still open.
metadata:
  type: project
  status: active
  scope: bill
  last_verified: 2026-06-10 — re-grounded after BILL deferral + server-side presence enforcement (was S200 provisional)
---

## Recall Rule

Read this when: touching the Stage 2a accept form's payment-address collection (chunk 5) or honorarium BILL onboarding address handling.

Do:
- **THIS CYCLE: treat address+phone as REQUIRED, server-enforced.** The 2026-06-09 BILL deferral (manual payment) settled the "do we need it?" question affirmatively — there is no BILL self-registration this cycle, so staff need the captured address+phone to pay. A non-opted-out FRESH accept that omits the required set (line1/city/postalCode/country/phone) gets `422 payment_contact_required` (`respond.js` `missingRequiredAddressFields`). Opt-out reviewers skip it.
- Keep removal CHEAP if next cycle makes it redundant: if BILL.com self-registration captures the remittance address, dropping it is still small — remove the form fields, the server presence guard, and stop alerting on missing. No structural rework. (`validateAddress` already stays shape/length-only, lenient on emptiness.)

Do not:
- Re-open the THIS-CYCLE need: it's decided (deferral → manual → required). The remaining open question is NEXT-cycle redundancy only.
- Add address detail to Dataverse beyond what's needed — brushes against [[project-no-banking-pii-in-dataverse]]'s "only onboarding-status + pointer" constraint.

Ground truth: Stage 2a accept form chunk 5 (`address`+phone → `contact.address1_*`/`address1_telephone1` → BILL vendor payload next cycle); related [[project-bill-honorarium-integration]], [[project-no-banking-pii-in-dataverse]].

The Stage 2a accept form (chunk 5) collects the reviewer's payment mailing address + phone (`address` → `contact.address1_*`, `phone` → `address1_telephone1`). **S200 history:** Justin flagged this might be a relic of the old manual BILL onboarding and was checking whether reviewer self-registration in BILL.com captures the address on BILL's side, making our collection redundant. **2026-06-09 update:** leadership deferred automated BILL onboarding to next cycle and payment is MANUAL this cycle, so the address+phone are unambiguously needed now — the provisional flag is resolved FOR THIS CYCLE. **2026-06-10:** Justin chose to enforce presence server-side (Codex post-impl catch: client-only enforcement let a direct POST create a no-contact honorarium); hardening is justified by manual payment + the public-token surface.

**Why:** the original redundancy concern was "if BILL registration already captures remittance address, our form is duplicate entry." That only bites NEXT cycle when BILL is back on. This cycle there is no BILL path, so the address+phone is the ONLY contact info staff have for manual payment — collecting AND requiring it is correct, not provisional.

**Still open — NEXT cycle MAY RELAX the hard requirement (Justin, 2026-06-10):** the required-address+phone gate is a THIS-CYCLE decision driven by manual payment. When BILL is re-enabled next cycle, re-evaluate: if BILL self-registration captures the remittance address, our collection may become redundant and the server-side `payment_contact_required` gate (plus the client `REQUIRED_ADDRESS_FIELDS` entry for phone) should be relaxed back toward optional. Removal stays small (form fields + the presence guard + alerting). Do NOT treat the required gate as permanent. Until next-cycle re-evaluation, keep it required. See [[project-bill-honorarium-integration]].
