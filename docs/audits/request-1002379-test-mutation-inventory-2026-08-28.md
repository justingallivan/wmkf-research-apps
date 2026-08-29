---
title: Request 1002379 test-mutation inventory (2026-08-28)
domain: request-workbench
kind: audit
status: active
summary: Read-only production inventory of everything the writeup pipeline left on smoke-vehicle Request 1002379 since 2026-08-17, as the confirmable input to an owner-gated cleanup.
owner: product-engineering
related:
  - scripts/probe-request-1002379-test-inventory.js
  - docs/atlas/dataverse-wmkf-requestdocument.md
  - docs/PRE_SITE_VISIT_GENERATION_RESILIENCE_PLAN.md
---

# Request 1002379 test-mutation inventory (2026-08-28)

Request `1002379` (`54e2b88b-04b9-f011-bbd3-6045bd02b4cc`, St. Jude, "Quantum
Chimera…", Phase II, cycle J26) has been the only end-to-end production smoke
vehicle for the Pre-Site Visit writeup, guarded reopen, Site Visit handoff, and
frozen distribution since 2026-08-17. Owner: "We'll have to clean up our mess
when we're done testing." This is the read-only inventory (probe run
2026-08-29 00:57Z by `scripts/probe-request-1002379-test-inventory.js` plus
three ad-hoc read-only queries recorded below). **No deletes have been made.**
Cleanup is a separate owner-confirmed step.

Baseline before 2026-08-17 `[VERIFIED via Atlas 2026-08-17 inventory]`: the
registry held no Pre-Site rows for any request; `1002379` had no writeup
pointer, no app-created email, and no site-visit activity. Everything below is
therefore test residue unless marked otherwise.

## 1. `wmkf_requestdocument` rows — 7 (all since 2026-08-17)

| # | row | created (UTC) | op / lifecycle | prompt v | AI run | SharePoint file | note |
|---|---|---|---|---|---|---|---|
| 1 | `aeb223a2-849a-f111-b8db-70a8a59cded0` | 08-17 21:43 | Ready / Superseded | v3 | `ba0f42b9` | `…/Artifacts/Pre-Site Visit/1002379 Pre-Site Visit 33abef48-077dddbd.docx` | first production generation |
| 2 | `76a0d4b2-8b9a-f111-b8db-7ced8d3d15a6` | 08-17 22:33 | Ready / Superseded | v3 | `36b821c7` | `…/1002379 Pre-Site Visit 188d1a19-92ae8f30.docx` | Site Visit handoff milestone v1.0 recorded 08-22 |
| 3 | `888982b6-0a9f-f111-b8dc-7ced8d3d15a6` | 08-23 15:53 | Ready / Superseded | v3 | `36b821c7` | `…/1002379 Pre-Site Reopened 2c61275e602c.docx` | guarded reopen `accidental_handoff` of #2; milestone v1.0 08-24; source of all distributions |
| 4 | `0b1ac77f-d79f-f111-b8dc-6045bd018a07` | 08-24 16:18 | Ready / Board Ready | — | — | `…/Distribution Snapshots/PreSite_1002379_faa275f3b1b4722e.docx` | frozen DOCX snapshot of #3 |
| 5 | `e28d3283-d79f-f111-b8dc-70a8a59cded0` | 08-24 16:19 | Ready / Board Ready | — | — | `…/Distribution Snapshots/PreSite_1002379_faa275f3b1b4722e.pdf` | frozen PDF snapshot of #4 |
| 6 | `449b61cc-3da3-f111-b8de-6045bd018a07` | 08-29 00:08 | Ready / Superseded | v3 | `36b821c7` | `…/1002379 Pre-Site Reopened 4721f0eec715.docx` | guarded reopen `wrong_governed_inputs` ("Fixing the document") of #3 |
| 7 | `b69c1add-3da3-f111-b8dd-70a8a59cded0` | 08-29 00:09 | Ready / **Draft** | **v5** | `49d2afc8` | `…/1002379 Pre-Site Visit 7da3d446-57de9e82.docx` | **current pointer**; funding-history fill proven here; attempt count 2 (first attempt = run `f8bb1326` max_tokens failure) |

Source-row lookups: #3→#2, #4→#3, #5→#4, #6→#3. No row carries
orphan-cleanup JSON. All seven files live under
`akoya_request/1002379_54E2B88B04B9F011BBD36045BD02B4CC/Artifacts/Pre-Site Visit/`
on drive `b!GQ6TSC…`; item ids are in the probe output.

## 2. `akoya_request` row

- `wmkf_currentpresitevisit` → #7 (`b69c1add…`). Initial-assessment and
  final-writeup pointers are empty.
- `modifiedon` 2026-08-29 00:51Z by the app service principal (the pointer
  update from the last generation).
- `wmkf_researchwriteuptype` = `Phase II` — legacy classification field, not
  written by any app path `[VERIFIED via grep: no writer in lib/]`; presumed
  original, not test residue.
- `RetrieveRecordChangeHistory` returned 37 details total and **0 since
  2026-08-17** despite the 08-29 `modifiedon` — so the audit read is
  **inconclusive** for pointer/lookup writes (likely not audited attributes),
  not evidence that nothing else changed. No other app write path targets
  `akoya_request` fields for this workflow `[VERIFIED via grep of
  lib/services/pre-site-visit/*]`.

## 3. `wmkf_ai_run` ledger rows — 12 bound to the request (6 since 2026-08-17)

Since 08-17: `aa3f53cb` (v1, Vercel Test), `5bd65180` (v2, Vercel Test),
`ba0f42b9` (v3 → #1), `36b821c7` (v3 → #2/#3/#6), `f8bb1326` (v5 **failed**,
max_tokens 16 384), `49d2afc8` (v5 → #7). Earlier: six 2026-05-05..07 rows
(sonnet-4-6 pilots and two `impersonation-resmoke` rows attributed to Justin
Gallivan / Connor Noda) — S271 impersonation smoke residue, unreferenced.

The ledger is append-only by design (Executor audit trail). Recommendation:
**keep** all AI-run rows; they are the only evidence of the failed run and of
prompt-version history. Owner may overrule for the two `impersonation-resmoke`
rows.

## 4. Distribution residue (2026-08-24/25)

- **Dynamics `email` activities regarding the request — 6:** three Sent by
  Justin Gallivan (`33ce6346` 08-24 16:24 "Pre-Site Visit materials — 1002379";
  `3f5e3616` 08-24 21:23 same; `5b5018bc` 08-25 15:50 "Test Pre-Site Visit
  materials — 1002379") and three Received by SYSTEM (`26bc7b59`, `80340d48`,
  `4ab30fd1`) — tracked replies/auto-responses to those sends. Attachments are
  the snapshot files (#4/#5).
- **Postgres `pre_site_distribution_attempts` — 10 rows** for the request:
  3 `sent` (matching the three Sent emails) and 7 `prepared` (never sent). All
  source #3; snapshot rows #4/#5.
- **`wmkf_sitevisit` activity — 1:** `11b41d73-02a0-f111-b8dc-6045bd018a07`
  "Test Site Visit", created 08-24 21:26 by Justin Gallivan, scheduled
  2026-08-28 14:15Z. The only site-visit activity on the request (all time).

## 5. Proposed cleanup list (owner confirms each line before any delete)

Order matters because of lookups: clear the pointer first, then delete
descendants before sources.

1. `akoya_request.wmkf_currentpresitevisit` → clear (currently #7).
2. Delete registry rows in this order: #7, #6, #5, #4, #3, #2, #1.
3. Delete the 7 SharePoint files (first-stage recycle bin, recoverable 93
   days) and, once empty, the `Artifacts/Pre-Site Visit/` folder (including
   `Distribution Snapshots/`).
4. Delete the 6 email activities (`33ce6346`, `26bc7b59`, `3f5e3616`,
   `80340d48`, `5b5018bc`, `4ab30fd1`).
5. Delete the `wmkf_sitevisit` activity `11b41d73…`.
6. Delete the 10 `pre_site_distribution_attempts` rows
   (`request_id = '54e2b88b-04b9-f011-bbd3-6045bd02b4cc'`).
7. AI-run rows: **keep** (recommended); owner decision on the two 2026-05
   `impersonation-resmoke` rows.

Not in scope: anything the app did not create (the request itself, its
applicant, Phase II classification, proposal files under `AI Materials/`).

Execution note: the app has no delete path for registry rows, activities, or
SharePoint artifacts; cleanup would be a one-off owner-run script under the
Dataverse target/write interlock, or manual deletion in AkoyaGO/SharePoint.
Whichever is chosen, re-run the probe afterwards for a zero-residue readback.
