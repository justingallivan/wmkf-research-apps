---
name: project_no_banking_pii_in_dataverse
description: Firm management constraint — banking / payment-routing PII must NOT live in Dataverse; outsource to bill.com
metadata:
  type: project
  status: active
  scope: bill
  last_verified: S158 via memory-content (not re-probed 2026-06-04)
---

## Recall Rule

Read this when: making any Dataverse schema decision that could touch payee/vendor banking, routing, or remittance PII (Reviewer Manager → Dataverse, honorarium onboarding, etc.).

Do:
- Store only (a) bill.com onboarding status/confirmation and (b) a minimal join pointer (`wmkf_paymentnetworkidpni` / bill.com vendor id).
- Treat bill.com as the system-of-record for remittance/tax PII; when unsure if a field is PII-that-belongs-at-bill.com, keep it out of Dataverse and confirm with the user.

Do not:
- Model new schema on the legacy `wmkf_billcom*` address fields (read as an abandoned early-adopter local-collection approach, working assumption — not a sync-back).
- Land bank account / routing / remittance detail in any Dataverse entity — firm management constraint, not a preference.

Ground truth: user constraint S158; related [[reviewer-identity-fragmentation]], [[project-reviewer-address-collection-provisional]].

WMKF management does **not** want PII like banking / payment-routing data stored in Dataverse (user, S158). This is a firm design constraint, not a preference: any schema decision that would land bank account / routing / remittance PII in a Dataverse entity is out of bounds. The system-of-record for vendor/payee remittance is **bill.com**; WMKF outsources collection and custody of that data to bill.com deliberately.

**Why:** Reduces WMKF's PII custody/compliance surface — bill.com already collects and maintains payee remittance + tax data as the payment processor, so duplicating it into Dataverse adds risk for no benefit. Surfaced while resolving the Research Reviewer honorarium cohort ([[reviewer-identity-fragmentation]]): the local `wmkf_billcom*` address fields populated on only ~7 real reviewers are now read as an **abandoned early-adopter local-collection approach** ("juice wasn't worth the squeeze"), not a sync-back and not test rows — *working assumption, still to be run to ground*.

**How to apply:** For Reviewer Manager → Dataverse and any other Dataverse schema work: store only (a) bill.com onboarding **status/confirmation** (did the payee complete bill.com vendor registration), and (b) a minimal **join pointer** (`wmkf_paymentnetworkidpni` / bill.com vendor id) — never the remittance/banking detail itself. Do not model new schema on the legacy `wmkf_billcom*` address fields. When in doubt about whether a field is PII that belongs at bill.com, treat it as out of Dataverse and confirm with the user.
