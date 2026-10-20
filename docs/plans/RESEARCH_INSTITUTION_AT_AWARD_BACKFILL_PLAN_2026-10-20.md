# Research PI/co-PI Institution at Award backfill — plan

Date: 2026-10-20. Status: **Stage A (PIs) applied to production 2026-10-20; Stage B (co-PIs) not built.** Owner: Justin Gallivan.

## 1. Goal and decisions

Fill `wmkf_apprequestperson.wmkf_InstitutionAtAward` (lookup → `account`) for the PIs and co-PIs on recent Research awards, so the owner can study who Keck funded, with whom, and from where. The column was added in schema wave 34 and is empty on every existing row (see `docs/atlas/dataverse-wmkf-apprequestperson.md`).

Decisions (owner, 2026-10-20):

- **Column, not a Note.** Connor agreed in writing to a lookup on the junction, and the GoApply submission flow will fill it for new submissions. The owner expects that flow to link each co-PI contact to an account [ASSUMED; Connor to confirm].
- **Scope:** awarded (`Approved`/`Active`/`Closed`) Research requests — the Medical Research and Science & Engineering programs, chosen as in `scripts/export-research-orcid-backfill-pool.mjs` (program name contains "research", not "reviewer") — with `wmkf_meetingdate` on or after 2017-01-01. Both PI and co-PI rows. This is the same set of awards as the co-PI extraction and the ORCID backfill, except Dec 2016.
- **Scale:** roughly 200 PI rows and 360 co-PI rows (308 extracted for 2017–2023 plus 52 recorded from 2024). [ASSUMED from the 2026-10-19 extraction and probe counts; resolve reports exact numbers.]
- **Meaning of the value:** the institution named on the request when it was decided. For PIs that is `akoya_applicantid`. GoApply writes it at submission; if the applicant institution changes before the decision, the flow (or a later check) should bring it into line. [PROPOSED to Connor 2026-10-20.]
- **Special grants stay in scope** (owner, 2026-10-20): the program + status scope includes 24 non-Program awards with a PI, 19 of them UCLA Keck Court Biomedical Initiative grants. Stage A covered them; Stage B includes their co-PIs where the documents name any. Facts and filter guidance: `docs/atlas/dataverse-akoya-request.md` → Open questions / gotchas.
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
- On `write` rows, `contact_account` compares the PI contact's current parent account with the applicant: `same`, `elsewhere`, `empty` or `not-account`. `elsewhere` rows are still written (the applicant is the award-time institution) but listed so the owner can see who moved or is mislinked.

**Built 2026-10-20:** `scripts/backfill-research-pi-institution-at-award.mjs` with `--resolve`, `--apply`, `--verify` and `--rollback`; decision rules in `scripts/lib/research-iaa-backfill.mjs`, tested by `tests/unit/research-iaa-backfill.test.js`. Apply needs `--confirm=<resolve hash>` and `--approver`. Before each write it re-reads the request and its PI rows and skips any drift from the resolve snapshot (status, program, meeting date, applicant, project leader, PI row count/identity). Contact targets also re-collect the contact's in-scope awards, re-run the latest-award selection, and re-run the duplicate search. It then re-reads the target and writes only an empty value with `If-Match`, taking the rollback ETag from the PATCH response itself (`Prefer: return=representation`), so no separate read can attribute another writer's version to this run. `--contact-accounts` adds the second group: contacts with no account and no duplicate, using the applicant of the contact's latest in-scope award whether or not that award's Institution at Award is already set; a same-date tie between different applicants is not written. Rollback clears only attributed writes whose ETag and value are unchanged; failed rollback attempts stay retryable and under verify, and cleared targets are never re-applied. Codex adversarial review (gpt-6-astra, 2026-10-20, base `639304ca9`) returned needs-attention with four findings: source drift not re-checked, post-write ETag attribution, contact latest-award selection limited to write rows, and non-retryable rollback. All four are fixed with regression tests (the rollback test fails under a mutation that blocks retries). A re-review on the same base found two remaining gaps: the WhoAmI-based attribution could not tell this run from other writers using the same app credentials, and apply did not re-check the meeting date or re-run the contact's latest-award selection. Both are fixed as described above, with tests. A third review confirmed those closed and found one narrower gap: apply rebuilt the program scope from the resolved awards, which would drop a Research program that had no awards at resolve time. Every resolve line now carries the full selected program list (`scopeProgramIds`, covered by the hash), and apply uses it; a regression test covers the empty-program case. [VERIFIED via sandbox rehearsals 2026-10-20 with two temporary PI rows: wrong-hash refusal, `--first=1`, contact group, idempotent rerun, verify 3/3, each PATCH response carried the ETag that rollback then matched, rollback cleared 3, a second rollback reported already cleared, no re-apply after rollback; temporary rows deleted and contacts restored. Sandbox mechanics: stale `If-Match` returns 412, and a null `@odata.bind` clears both lookups.] The production resolve hash `ac49828f` predates these fields, so resolve must be re-run before apply. [RECHECKED after scripts/backfill-research-pi-institution-at-award.mjs change: rewritten against the third-review fix version and its fourth sandbox rehearsal]

**Production resolve, 2026-10-20** [VERIFIED via owner-run resolve, hash `ac49828f`; output kept outside the repo]: 238 in-scope awards. 231 `write`, 1 `pi-mismatch` (1000954), 6 `other` (no project leader and no PI row: 992648, 993756, 994466, 994472, 996546, 997259), 0 for every other class. Of the 231 `write` rows, `contact_account` is `same` 183, `elsewhere` 3, `empty` 45, `not-account` 0. Every award from 2017 on has a PI junction row when it has a project leader.

**PI contacts with no account (the 45 `empty`)** [VERIFIED via owner-run `scripts/probe-research-pi-contacts-without-account.mjs`, 2026-10-20]:

- 39 have no other matching contact (by email or by first + last name). All 39 were created by the `# BCO akoyaGO Integration` user: 4 in Nov 2023, the migration month (migrated contacts in this set are dated 2023-11-30), and 35 afterwards, in batches matching proposal cycles (Apr–May 2024: 9, Aug–Nov 2024: 6, Apr–May 2025: 11, Oct–Nov 2025: 9). Intake therefore still creates PI contacts without linking an account, although the applicant account is on the request.
- 6 have another contact for the same person, and in every case that other contact holds the applicant account. In 4 (1001530, 1001618, 1002341, 1002353), the integration created a new contact in 2025 although a migrated contact already existed; 3 of those 4 share the exact email. 992966 is the reverse (the award points at the older contact; a Dec 2025 contact has the account). 994465 is a staff-created 2025 contact whose email differs from the older one; it is one of the four duplicate-contact cases held back from the ORCID backfill.
- Not measured: how many of the 183 `same` contacts were created by the integration and linked to an account afterwards by staff. That rate would need a further read.

Proposed handling [PROPOSED; owner to approve]: write Institution at Award for all 231. As a separately approved group, set the contact's account to the applicant only for the 39 with no duplicate, and only while empty. Leave the 6 duplicates for staff to merge in Dynamics, then confirm each award's PI junction row follows the surviving contact.

**Stage A applied, 2026-10-20** [VERIFIED via owner-run apply and `--verify`, resolve hash `7e5cdcf7`, approver Justin Gallivan; logs kept outside the repo]: a first batch of 5 (`--first=5`, verify 5/5), then the rest with `--contact-accounts`. 231 Institution at Award values and 39 contact accounts written, 0 skipped or failed, every write rollback-eligible with its ETag from the PATCH response; `--verify` 270/270. Not written: the 6 awards with no PI are institutional Special Grants/Projects with no PI by design [VERIFIED via owner-authorized production read, `_wmkf_type_value`, 2026-10-20]. Still open: 1000954 (`pi-mismatch`), the 3 `elsewhere` contacts (left as they are), and the 6 duplicate contacts (for staff to merge).

### 3.2 Stage B resolve — co-PIs, read-only

**Evidence for co-PI status (owner decision 2026-10-20: option 3, then option 1).** The first extraction (308 co-PIs on 124 grants) found co-PIs two ways: rule c, named as co-PI/co-investigator in the documents (110 people, 56 grants), and rule a, every faculty-level non-PI with a biosketch when no one was named (198 people, 78 grants). Rule a is a guess: on the UCLA Keck Court grants, individual-investigator awards, all 13 first-pass co-PIs came from rule a. `scripts/verify-research-copi-roles.mjs` (paid, owner-run, Haiku 5.5, about $0.50, `--max-usd` cap) re-reads the 78 rule-a grants with budget, budget-justification and personnel files added, and asks for each non-PI person's stated role and budgeted effort with a quote and source file. `scripts/lib/research-copi-roles.mjs` (tests: `tests/unit/research-copi-roles.test.js`) decides, and accepts a quote only if it is really in the cited document: `co-PI` for a stated co-PI/co-investigator role, `budget-only` for faculty with budgeted effort and no stated role (owner decides), `not co-PI` otherwise. Stage B writes rule-c co-PIs and verified `co-PI` rows; `not co-PI` rows are not written, and stay in the CSVs for later.

**Role check results, 2026-10-20** [VERIFIED via owner-run `verify-research-copi-roles.mjs`, third full run, $0.29; earlier runs exposed and fixed: multi-PI wording, post-award budget files, exact-name matching, generic "the PIs" quotes, and a crash on unmatched names]: of 266 people on the 78 rule-a grants (198 first-pass co-PIs), 19 confirmed co-PIs on 13 grants (12 project PIs, 4 co-PIs, 3 co-investigators), 4 budget-only (all 992950, 10% academic-year effort each), 205 not co-PI, 38 unassessed (the model omitted them from its answer: 29 first-pass faculty co-PIs and 9 non-faculty, on 17 grants). Owner decision 2026-10-20: treat all 38 as unpaid collaborators, not co-PIs, and do not re-check (996163, for example, lists a single PI in its budget, and several others sent letters of support). No Keck Court rule-a person was confirmed. Owner reviewed all 19 quotes and approved all 19, confirming 992966's two as co-PIs. The owner also approved the 4 budget-only people on 992950 as co-PIs (2026-10-20). Approved for Stage B: 110 rule-c co-PIs plus 23 from the role check (19 confirmed, 4 budget-only), 133 in total for 2017–2023.

**2024 on** [VERIFIED via owner-run `scripts/probe-research-copi-accounts.mjs`, 2026-10-20]: 52 recorded co-PIs on 27 awards, all Program grants, none before 2024. 44 are recorded in both the junction and the legacy slots, 7 in the junction only, and 1 in a slot only (needs a junction row). Contact accounts: 37 empty, 13 the applicant, 2 elsewhere. 25 of the 37 empty share the PI's email domain, plus one subdomain case; about 11 are at other institutions. Institution at Award is set on none. Proposed rule: use the contact's account when it has one; else the applicant when the email domain (including subdomains) matches the PI's; else an account identified by the email domain from contacts staff already linked, with a clear winner; else owner review.

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

## 7. Held note to Connor (unsent)

Status: **drafted 2026-10-20, held by the owner** until an unrelated thread with Connor resolves; send as one message, not several in quick succession. Counts are from §3.1.

> Thanks for agreeing to the lookup. The column is live in production and the sandbox: **"Institution at Award"** (`wmkf_InstitutionAtAward`) on `wmkf_apprequestperson`, a lookup to Account. For new submissions, please set it to the applicant's Account on every PI and co-PI row. I'll fill in Research awards from 2017 on myself.
>
> While preparing that backfill, I looked at how PI contacts are being created, and found two patterns in the akoyaGO integration that are worth fixing before GoApply starts sending co-PIs:
>
> 1. **New contacts aren't linked to an Account.** Of the 238 Research awards since 2017, 45 have PI contacts with no Account, though the applicant institution is on the request. 39 of those contacts were created by the "# BCO akoyaGO Integration" user, 35 of them after the migration, in batches that match each proposal cycle. When the flow creates a contact, could it set the contact's Account to the applicant institution?
> 2. **It sometimes creates a duplicate of an existing person.** In 4 cases it created a new contact in 2025 even though the person was already in the system, with the right Account. In 3 of those the email address was exactly the same. Could the flow look for an existing contact by email before creating one?
>
> These matter more for co-PIs. Many won't be in our system yet, and some will be under a different email, so unlinked contacts and duplicates would pile up quickly. The order I'd suggest is: find the contact by email, create one only if there's no match, link it to its Account, then write the PI or co-PI row with Institution at Award.
