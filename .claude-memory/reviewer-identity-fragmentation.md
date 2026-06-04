---
name: reviewer-identity-fragmentation
description: Sample-based flag (5/87 + architecture, not a census) — a peer reviewer appears to span ≥4 disjoint stores with no shared key. The Reviewer Manager→Dataverse engineering migration is DONE (W5/W6); only a gated table-drop + a deferred census remain.
metadata:
  type: project
  status: active
  scope: reviewer
  last_verified: S217 via memory-content (not re-probed 2026-06-04)
---

## Recall Rule

Read this when: designing reviewer identity resolution / de-duplication, cross-store reviewer joins, or ORCID-as-join-key work.

Do:
- Treat the Reviewer Manager→Dataverse engineering migration as DONE (W5/W6) — stop if told to "do" it.
- Cite this memory for the fragmentation finding (sample-based flag, 5/87, not a census); don't re-derive from scratch.
- Treat de-fragmentation as a FLOW problem — propagate ORCID forward (intake, applicant-suggested capture) rather than a one-shot collapse; reuse existing identity machinery.

Do not:
- Store remittance/banking PII in Dataverse — onboard reviewers at bill.com, keep only status + the join pointer.
- Join applicants on `akoya_primarycontactid` (=liaison); the PI is `wmkf_projectleader`.
- Run `--execute` table-drops autonomously; the W6 drop is gated destructive carryover.

Ground truth: `docs/atlas/postgres-researchers.md`, `docs/REVIEWER_ORCID_BACKPROPAGATION_DESIGN.md` (rev3); probe scripts (artifacts gitignored). Related: [[project-w6-table-drop-pending]], [[project-no-banking-pii-in-dataverse]], [[project-reviewer-identity-resolution-phase1]], [[project-institution-foundation-liaison]].

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

**ORCID-as-join-key measured S216 (read-only probes, prod Dataverse — scripts
`probe-orcid-cross-store-matches.js` / `probe-orcid-contact-direct-join.js` /
`probe-contact-orcid-provenance.js`, artifacts gitignored).** After the S215
backfill ([[project-reviewer-identity-resolution-phase1]]) ORCID's *direct*
cross-store power today is MODEST, because each join's far side is still
ORCID-sparse:
- **Pool**: 4,269 reviewers, 1,533 (35.9%) carry ORCID; only 2 promoted to a
  `contact`, 0 ORCID-bearing.
- **Within-pool dedup** (ORCID's strongest play): 24 ORCIDs sit on >1 row = 24
  fragmented humans / 48 rows; **23 of 24 email would MISS** (same person,
  different institutional emails). This is the clean win.
- **reviewer→contact**: email bridge reaches 183/1,533; direct ORCID↔ORCID
  shares only 18 (marginal +2 over email).
- **honorarium akoya_request**: 49/87 paid reviewers match the pool (ALL by
  email, 0 by contact-ptr); 18 ORCID-resolved.
- **`contact` HAS a native `wmkf_orcid` field** (falsifies "GOapply stores are
  email-only"), populated on 423 — but it's a DISJOINT population: 100% created
  by "# BCO akoyaGO Integration", `akoya_entitysource=GOapply`, 398 in 2026,
  **52% are PIs (`wmkf_projectleader`) on current-cycle requests** = grant
  APPLICANTS, not reviewers. So GOapply already captures applicant ORCID at
  intake. NB the PI is `wmkf_projectleader`, NOT `akoya_primarycontactid`
  (=liaison) — joining on primary-contact undercounts applicants ~200x
  ([[project-institution-foundation-liaison]]).
Design implication: de-fragmentation is a FLOW problem, not a one-shot collapse
— make ORCID propagate (back-propagate the 1,533 reviewer ORCIDs onto their
contacts; carry ORCID through the intake portal + applicant-suggested-reviewer
capture) so the shared key builds over time. `contact.wmkf_orcid` has no
`wmkf_orcidurl` sibling (our researcher adapter writes both) — a write-signature
tell. 14 contact ORCID values are malformed (direct-join data-quality snag).

**ORCID back-prop SHIPPED S217 (the flow now exists).** Design
`docs/REVIEWER_ORCID_BACKPROPAGATION_DESIGN.md` (rev3, 2 Codex passes) built as
PR1 (runtime forward-flow) + PR2 (one-shot backfill), both on `main` 2026-06-03,
Codex-reviewed (incl. an adversarial pass). Mechanics: `lib/utils/orcid-normalize.js`
(mod-11-2 checksum) → `contactAdapter.resolveForBackprop`/`setOrcidIfAbsent`
(fill-only, conditional If-Match, conflict-surfacing) → shared
`lib/services/backprop-reviewer-orcid.js` helper, wired into send-emails +
honorarium-onboard-orchestrator + workbench/enrich-recommended (each hydrates
`wmkf_orcid`/`wmkf_identitystatus`/`_wmkf_contact_value` first). Eligibility =
valid iD + `mayPersistIdentity` (confirmed/probable). Runs forward automatically
on every promotion now. **Historical backfill RAN + verified**
(`scripts/backfill-contact-orcid.js --resolve/--apply/--verify`): live counts
matched the projection exactly — **162 write / 0 conflict / 0 malformed / 7
ambiguous / 14 noop / 1 status_null / 1,349 nocontact** of 1,533; all 162
`contact.wmkf_orcid` fills confirmed by (contactId, reviewerId), 0 failures.
Provenance = native Dataverse audit on `contact.wmkf_orcid` (reversible, §7);
no `wmkf_orcidsource` field. **Still OPEN: PR3** — carry ORCID through the intake
portal applicant-suggested-reviewer capture (close the flow at intake).
