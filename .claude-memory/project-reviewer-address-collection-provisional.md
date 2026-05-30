---
name: project-reviewer-address-collection-provisional
description: Reviewer payment-address collection on Stage 2a accept is PROVISIONAL — may be a relic of manual BILL onboarding; pending office confirmation
metadata:
  type: project
---

The Stage 2a accept form (chunk 5) collects the reviewer's payment mailing address (`address` → `contact.address1_*` → BILL vendor payload). **Justin flagged S200 that this may be a relic of the old manual BILL onboarding** and is checking in the office whether we actually need it or whether the reviewer self-registering in BILL.com captures the address on BILL's side, making our collection redundant.

**Why:** if BILL.com registration already captures remittance address, collecting it on our form is duplicate data entry (and address detail in Dataverse brushes against [[project-no-banking-pii-in-dataverse]]'s "only onboarding-status + pointer, never detail" constraint).

**How to apply:** built as **required-when-taking-honorarium, hidden-when-opted-out** for now (the "easy choice"). The server already treats `address` as OPTIONAL (honorarium `akoya_request` + provenance create without it; BILL onboarding only *alerts* staff on missing). So if the office says BILL registration suffices, removal is small: drop the form fields + stop alerting on missing address — no structural rework. Don't harden/expand address collection until that office answer lands. See [[project-bill-honorarium-integration]].
