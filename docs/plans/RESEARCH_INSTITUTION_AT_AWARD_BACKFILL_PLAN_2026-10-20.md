# Research PI/co-PI Institution at Award backfill — plan

Date: 2026-10-20. Status: **DRAFT — not built, no production writes.** Owner: Justin Gallivan.

## 1. Goal and decisions

Fill `wmkf_apprequestperson.wmkf_InstitutionAtAward` (lookup → `account`) for the PIs and co-PIs on recent Research awards, so the owner can study who Keck funded, with whom, and from where. The column was added in schema wave 34 and is empty on every existing row (see `docs/atlas/dataverse-wmkf-apprequestperson.md`).

Decisions (owner, 2026-10-20):

- **Column, not a Note.** Connor agreed in writing to a lookup on the junction, and the GoApply submission flow will fill it for new submissions. The owner expects that flow to link each co-PI contact to an account [ASSUMED; Connor to confirm].
- **Scope:** awarded (`Approved`/`Active`/`Closed`) Research requests — the Medical Research and Science & Engineering programs, chosen as in `scripts/export-research-orcid-backfill-pool.mjs` (program name contains "research", not "reviewer") — with `wmkf_meetingdate` on or after 2017-01-01. Both PI and co-PI rows. This is the same set of awards as the co-PI extraction and the ORCID backfill, except Dec 2016.
- **Scale:** roughly 200 PI rows and 360 co-PI rows (308 extracted for 2017–2023 plus 52 recorded from 2024). [ASSUMED from the 2026-10-19 extraction and probe counts; resolve reports exact numbers.]
- **Meaning of the value:** the institution named on the request when it was decided. For PIs that is `akoya_applicantid`. GoApply writes it at submission; if the applicant institution changes before the decision, the flow (or a later check) should bring it into line. [PROPOSED to Connor 2026-10-20.]
- **Earlier years are deferred, not ruled out.** Extend only if this cohort turns out to be useful. Earlier work is likely harder: Dec 2016 proposals are mostly scans and pre-2016 documents were not inventoried. §6 records what to change.
- **2024 onward is in scope here,** using the best available evidence, so that Connor's flow only handles new submissions. [PROPOSED to Connor 2026-10-20; confirm so both do not write the same rows.]

## 2. Sources of institution evidence

| Person | Source | Strength |
|---|---|---|
| PI | Request's applicant account `akoya_applicantid` (the award goes to the institution) | Strong. Filled on ≥97% of requests per `docs/atlas/dataverse-akoya-request.md`; recheck the coverage for this cohort in resolve. |
| Co-PI, 2017–2023 | Haiku extraction from proposal documents (`scripts/extract-research-copi-candidates.mjs`; 308 people on 154 grants; institution from email domain 242, stated 64, assumed 2) | Good for email/stated; `assumed` rows need owner review. CSV is in the restricted SharePoint folder, never in git. |
| Co-PI, 2024 on | Junction rows already exist (52 co-PIs on 27 awards, owner-run probe 2026-10-19); institution only from the contact's **current** account | Weak as a snapshot: right unless the person has moved since. Flag as `current-account` provenance. |

The institution named in the evidence must be resolved to an existing `account` row. Never create an account in this backfill without explicit owner approval per row; unresolved institutions go to the review list.

## 3. Phases (owner-run, modeled on `scripts/apply-research-pi-orcid-backfill.mjs`)

Stage A (PIs) is simpler and runs first; Stage B (co-PIs) reuses the same resolve/apply/verify script shape.

### 3.1 Stage A resolve — PIs, read-only

For each in-scope award: read `_wmkf_projectleader_value`, `_akoya_applicantid_value`, and the junction rows with role PI. Classify:

- `write` — exactly one PI junction row, its contact equals the project leader, applicant account present, column empty.
- `already-set` — column already holds a value (never overwrite).
- `no-junction-row` — the project leader has no PI junction row. The junction backfill (`scripts/backfill-request-person-junction.js`) predates later requests, and Connor's dual-write flows have not shipped (Atlas), so these are expected for newer awards. Creating the row is a separate owner decision; report the count.
- `pi-mismatch` — junction PI contact differs from the project leader. Review.
- `no-applicant` — no applicant account. Review.
- `multiple-pi-rows` — more than one PI junction row on the request (the alternate key allows it when the contacts differ). Review.
- `other` — any state the classes above miss; never written.
- `contact-elsewhere` — the PI contact's current parent account differs from the applicant. Still `write` (the applicant is the award-time institution), but listed so the owner can see who moved or is mislinked.

### 3.2 Stage B resolve — co-PIs, read-only

Match each extracted person to a contact: email first, then exact name plus institution. Then to the request's Co-PI junction row (or legacy `wmkf_copi1..5` slot). Resolve the institution to one account. Classes: `write`, `already-set`, `new-contact-needed`, `new-junction-row-needed`, `ambiguous-contact`, `no-account-match`, `assumed-institution` (owner review). Creating contacts or junction rows is part of this stage only after owner approval of those rows. A contact's current account (`parentcustomerid`) is filled only when it is empty, using that person's most recent award evidence. An existing current account is never overwritten: award-era evidence can be older than what the contact already holds.

### 3.3 Apply

Writes only owner-approved `write` rows: a single PATCH of `wmkf_InstitutionAtAward@odata.bind` with an ETag `If-Match`, skipping rows changed since resolve. Requires same-day `DATAVERSE_PROD_WRITE_ACK`. Logs every outcome to a CSV outside the repo.

### 3.4 Verify and rollback

Verify re-reads every applied row and reports counts. Rollback clears only rows that the apply log shows this run wrote and that still hold the written value.

## 4. Before any apply

- Codex adversarial review of the script and this plan (same as the ORCID backfill).
- Owner reviews the resolve workbook, including `contact-elsewhere` and every non-`write` class.
- Connor confirms the 2024+ split (§1).

## 5. Non-goals

No overwriting a contact's existing current account, no new contacts/accounts/junction rows without per-row owner approval, no pre-2017 rows, no app code that reads the column yet.

## 6. Extending to earlier years

Change the meeting-date floor in resolve. PIs extend cheaply (applicant account exists on migrated requests). Co-PIs need a new document inventory and extraction for the added years (`scripts/probe-research-proposal-file-inventory.mjs`, then the extraction script, which is paid and needs owner approval); expect scanned documents before mid-2017 and more missing biosketches.
