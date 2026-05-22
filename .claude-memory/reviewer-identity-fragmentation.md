---
name: reviewer-identity-fragmentation
description: Sample-based flag (5/87 + architecture, not a census) — a peer reviewer appears to span ≥4 disjoint stores with no shared key. The Reviewer Manager→Dataverse engineering migration is DONE (W5/W6); only a gated table-drop + a deferred census remain.
metadata:
  type: project
---

This is the referent of every `see memory project_reviewer_identity_fragmentation`
citation (`docs/DATAVERSE_POWER_TOOLS_DESIGN.md:344`, SESSION_PROMPT C–F list).

**The engineering migration is DONE — do not treat "Reviewer Manager→Dataverse"
as live build work.** Per `docs/atlas/postgres-researchers.md` (W6 update
2026-05-12, re-verified S164 2026-05-18): Review Manager + Reviewer Finder API
surfaces carry zero Postgres SQL — fully on `lib/dataverse/adapters/{reviewer-suggestion,potential-reviewer,contact,researcher}`
+ `grant-cycles-dataverse`. Postgres `researchers` / `reviewer_suggestions` /
`grant_cycles` are **drain-only since W5/W6**. External-reviewer token
hash/issue/expire/revoke live on the Dataverse `wmkf_appreviewersuggestion` row,
not Postgres. The only Postgres touch in the request path is the shared
cross-app auth gate (`requireAppAccess` → `user_profiles` + `dynamics_user_roles`),
deliberately excluded from Wave 1 by design. If a future session is told to "do
the Reviewer Manager→Dataverse migration," stop — it landed W5/W6.

**The fragmentation finding (sample-based forward-design FLAG, not a census).**
Discovered S158 by read-only probe (`scripts/probe-akoya-reviewer-linkage.js`,
evidence `docs/atlas/evidence/akoya-reviewer-linkage-2026-05-16.txt`) — inspected
only **5 of 87** Research Reviewer rows; the Postgres `researchers` pool was not
join-tested. WMKF pays peer reviewers a $250 honorarium tracked as `akoya_request`
rows (`wmkf_grantprogram=Honorarium`, `wmkf_type=Individual`,
`akoya_program=Research Reviewer`, source GOapply, ~87 rows all 2026). On the
sampled rows the reviewer *person* appeared in **≥4 disjoint representations with
no shared key**:

1. **Dataverse `contact`** — via `akoya_primarycontactid`; real people but
   auto-created by GOapply, uncurated (inconsistent Active/Inactive, junk
   jobtitles, no `parentcustomerid` org link; some staff test rows).
2. **GOapply contact object** — `akoya_goapplysubmitter` → `akoya_akoyaapplycontact`,
   a separate portal-layer person record (email-keyed).
3. **The honorarium `akoya_request` row itself** — reviewer activity/payment
   buried in the grants entity (polymorphic reuse).
4. **Postgres `researchers`** — the Reviewer Finder pool, drain-only, W6 drop
   pending ≥2026-07-01 (see [[project-w6-table-drop-pending]]).

Email is the only natural join and it is fragile. The design doc labels this
"forward design, NOT Power Tools scope."

**Reviewer-payment field cluster (S158 census, `scripts/probe-akoya-reviewer-payment-fields.js`):**
the honorarium `akoya_request` carries a full payment model — (A)
verification/status workflow 100%-present but all "No"/$0/Pending (pipeline
wired, no payments run yet); (B) bill.com remittance detail only ~9% (8/87)
populated — a real collection gap; (C) identity linkage 100%; (D) amount $250.

**How to apply.** Within any Reviewer Manager → Dataverse design: (a) canonical
reviewer entity = likely `contact`, but it needs de-dupe + curation, not
creation (the 87 already link via `akoya_primarycontactid`); (b) reuse existing
identity machinery ([[project-dynamics-identity-reconciliation]]), not a new
bridge; (c) **payment: do NOT store remittance/banking PII in Dataverse** (see
[[project-no-banking-pii-in-dataverse]]) — onboard reviewers at bill.com, store
only onboarding-confirmed status + the `wmkf_paymentnetworkidpni` join pointer.
What actually remains: a gated `DROP TABLE` (destructive carryover — grep live
callers, no autonomous `--execute`) and an explicitly-deferred 5/87→census
upgrade. Do not re-derive the finding from scratch — cite this memory.
Related: [[dataverse-export-floor-scoping]] (Power Tools / Track B scope boundary).
