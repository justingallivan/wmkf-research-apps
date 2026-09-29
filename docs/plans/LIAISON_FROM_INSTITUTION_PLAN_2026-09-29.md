# Research Liaison read from the applicant institution

Status: **DRAFT, revision 7 (2026-09-29, Session 549; round 4: one high and three medium; round 5: one medium; round 6: one high and six medium; all answered below). Codex plan reviews: round 1 needs-attention (five high, two medium); round 2 needs-attention (four high, two medium); round 3 on revision 3 needs-attention (five high, one medium), five of the six on re-addressing queued reminders. Revision 4 splits the work (owner, S549): this plan covers the readers and new reminders; re-addressing queued reminders moves to `docs/plans/SCHEDULED_EMAIL_READDRESS_PLAN_2026-09-29.md`. Revision 7 is ready to build after the round-6 fixes. The implementation described here remains `[PLANNED]`.** Branch `claude/liaison-from-institution`.

## Decision (owner with the AkoyaGO platform owner, 2026-09-29)

For the Research program, the **Liaison of record belongs to the applicant institution**: the account's Primary Contact (`account.primarycontactid`), reached through the Request's `_akoya_applicantid_value`. App code stops reading the Request's copy (`akoya_request.akoya_primarycontactid`) as the Liaison for Research Requests.

Why: the Liaison flows up only (Request → institution, *WMKF_Update Org Primary Contact from Request*); nothing copies an institution's Primary Contact down to its existing Requests, so the Request copy goes stale when an institution changes its Liaison [VERIFIED via `docs/plans/TEST_REQUEST_FACTORY_CAST_AND_STATUS_PLAN_2026-09-28.md:39-41`].

Owner rules (S549):

1. **No Primary Contact on the institution → show no Liaison and send nothing to one.** No fallback to the Request copy. An email that has a PI still goes to the PI, with no Liaison Cc.
2. **Always the current Liaison**, including on old and closed Requests (historical liaisons have often left the role or the institution). Queued or saved recipients are re-resolved before they are sent.
3. **Research only.** Research = `akoya_programid` in `RESEARCH_PROGRAM_IDS` [VERIFIED via `shared/config/researchPrograms.js:6-9`] (Science and Engineering Research, Medical Research). SoCal (and any other or blank program) keeps today's behavior.
4. `akoya_request.wmkf_liaison` (a separate, unread "Liaison" lookup) is ignored.

Owner answers (S549, after round 2):

5. **Reporting:** the Dataverse export is relabelled as the Request's copy; Dynamics Explorer resolves Research Liaison relationships through the institution (reader 7).
6. **Invitation:** one editable Cc field, with a server-side check of the Liaison's contact **and** email at send (reader 1).
7. **Measure first:** an owner-run read-only probe counts how the rule changes recipients before the build (*Measurement*).
8. **Duplicate contact rows** for one person may change the address used: accepted.
9. ~~**Both phases are built**~~ **Split (owner, S549, after round 3):** this plan builds the reader switch and gives new reminders the current Liaison. Re-addressing reminders already queued (and the engine hardening it needs) is a separate plan, `docs/plans/SCHEDULED_EMAIL_READDRESS_PLAN_2026-09-29.md`. Until that lands, a reminder queued before a Liaison change still goes to the Liaison it was queued with: the one known gap in rule 2.

## The rule, precisely

One helper, `lib/services/contacts/request-liaison.js` [PLANNED; name open], decides the Liaison for a Request row carrying `_akoya_programid_value`, `_akoya_applicantid_value`, `_akoya_primarycontactid_value`, and any available formatted lookup annotations. It returns a **discriminated result**, never a bare null:

| Result | Meaning |
|---|---|
| `{ status: 'found', contactId, source, displayName }` | a Liaison contact id; `source` is `institution` (Research) or `request_copy` (other programs). `displayName` is the best-effort formatted lookup label or null; it is display-only and never email/send authority. |
| `{ status: 'none', source }` | a successful read confirmed there is no Liaison (Research: applicant blank, or the account's Primary Contact blank; other programs: the Request copy blank) |
| throws | any read failure, or an account read that does not return the requested row |

| Request | Result |
|---|---|
| Research program, applicant set | the account's `_primarycontactid_value` → `found`, or `none` if blank |
| Research program, applicant blank | `none` (no Request-copy fallback) |
| Any other program, or an explicitly null/blank program value | the reader's current behavior, through `source: 'request_copy'` |

Program ids, applicant ids and returned account ids compare case-insensitively. The helper first requires each row to own all three input keys; an omitted `_akoya_programid_value`, `_akoya_applicantid_value` or `_akoya_primarycontactid_value` throws instead of being treated as an explicit blank. Every caller's Request projection therefore adds all three fields. The batched form, `resolveRequestLiaisons(rows)`, returns one discriminated result per input row in input order. It reads distinct Research applicant accounts in OR-chunks of at most 25 through `queryAccounts` [VERIFIED via `lib/dataverse/adapters/account.js:31-32`], selecting `accountid,_primarycontactid_value` and its formatted annotation with `top` equal to the chunk size. It throws if a chunk reports `hasMore`, a larger `totalCount`, a malformed response, or omits any requested account; a missing row is not evidence of a blank Primary Contact. The formatted account lookup supplies `displayName` for the Awardees list without a second contact query.

**Contact reads after the id (invariant).** Every email-producing reader resolves a `found` contact id to current name/email with its own contact read; the helper's `displayName` is not sufficient. A failed contact read is also a failure, never `none`. The Awardees list is the only exception: it displays the account lookup's formatted `displayName`, requests no email, and has no send authority. Two email readers degrade failures today and change:
- `recipients-service.js` returns the id with null PII on a contact read error [VERIFIED via `lib/services/workbench/grantee-deliverables/recipients-service.js:21-29`] → it throws a 503 instead.
- The reminder cron's `readContact` returns null on any error [VERIFIED via `lib/services/cron/grantee-deliverable-reminders-service.js:85-91`] → a read error skips the row as a retryable failure; only `none` produces a PI-only reminder.

## Measurement (owner answer 7)

Before the build, the owner runs a read-only production probe (session scratch script `probe-research-liaison-coverage.js`; counts only, no names, emails or ids). It covers active Research awardees and Research Requests with a meeting date today or later, both excluding test Requests. For each population it reports how many Request copies match the institution's Primary Contact, differ from it, would gain a Liaison, or would lose the Liaison Cc under rule 1. The result is recorded here; the probe is committed as a script in the build if kept.

**Result (owner-requested run, production, 2026-09-29, read-only, complete) [DERIVED-FROM: the S549 session run of the scratch probe; its output is not committed] — contact GUIDs were compared, not people:**

| | A. Active Research awardees | B. Research Requests, meeting date ≥ 2026-09-29 |
|---|---|---|
| Requests | 108 | 213 |
| Distinct institutions (no Primary Contact) | 64 (1) | 133 (0) |
| Request copy = institution Primary Contact | 23 | 168 |
| Request copy differs (the Liaison changes) | 84 | 44 |
| Request copy blank, institution set (Liaison gained) | 0 | 1 |
| Liaison Cc dropped under rule 1 | 1 | 0 |

Rule 1 costs almost nothing: one awardee loses its Liaison Cc. The switch itself changes the Liaison contact on most active awardees (84 of 108) and on about a fifth of upcoming Requests. Some of those differences may be duplicate contact rows for one person rather than a different person, so the address may or may not change (earlier SoCal probes found GUID divergence overstates person divergence; owner answer 8 accepts this).

**Email comparison of the differing pairs (owner-requested run, production, 2026-09-29, read-only, complete) [DERIVED-FROM: the S549 session run of the comparison probe; its output is not committed] — `emailaddress1` was normalized:**

| | A. Active awardees | B. Upcoming Requests |
|---|---|---|
| Differing contact records | 84 | 44 |
| Same email (no recipient change) | 57 | 9 |
| Different email (the recipient changes) | 27 (same name: 1) | 35 (same name: 5) |
| One or both emails blank | 0 | 0 |
| Request-copy contact inactive | 1 | 1 |

So the switch changes the actual Liaison recipient on 27 active awards and 35 upcoming Requests. The awardee without an institution Primary Contact (one Request) is accepted as is (owner, S549).

## Readers and changes

### 1. Awardee invitation — recipients and send

- Today:
  - Recipients come from `recipients-service.js`, whose Request projection selects `_akoya_primarycontactid_value` [VERIFIED via `lib/services/workbench/grantee-deliverables/recipients-service.js:41-46`].
  - The Awardee tab prefills an editable Cc and **swallows a recipients load failure**, leaving the fields blank for staff to type [VERIFIED via `shared/components/workbench/AwardeeTab.js:266-275`].
  - The send route accepts any Cc the client submits [VERIFIED via `pages/api/workbench/grantee-deliverables/send-invite.js:53-84`].
- Change:
  - Add `_akoya_programid_value` and `_akoya_applicantid_value` to the recipients service's Request projection; its existing `_akoya_primarycontactid_value` completes the helper input. The recipients response gains `liaison.contactId` and `liaison.email` as resolved by the helper and the contact read (both null for `none`).
  - The client echoes both on send as `liaisonSeen: { contactId, email }`. The route requires that closed object: `contactId` is null or a GUID and `email` is null or a bounded string (trimmed/lowercased for comparison, but not treated as a recipient address). Missing, wrongly typed, overlong or extra fields produce 400 before the service or transport. Null is an explicit observation, not the default for an omitted field; actual `ccEmail` keeps the route's separate recipient-address validation.
  - The send service's Request read also selects all three helper input fields. After the existing request/status/test-request guards and before link mint, signature resolution or transport, it re-resolves the Liaison server-side and compares normalized contact id **and** normalized email with what the client saw:
    - Any difference, including a Liaison that appeared or disappeared → 409 `liaison_changed` ("The Liaison changed; reload before sending"), nothing sent.
    - A resolution failure → 503, nothing sent.
    - A match → the Cc is sent as submitted. Staff edits, including removing the Liaison or adding an assistant, stay deliberate (owner answer 6).
  - The Awardee tab shows a recipients load failure with Retry and disables Send until recipients load. Today the loader guards only a successful response, by request id [VERIFIED via `shared/components/workbench/AwardeeTab.js:266-275`]. The new version keeps a load sequence number: every success, failure and loading-state write checks that its sequence is still the latest and the request is unchanged, and switching Requests resets the state (round 4 finding 3).

### 2. Grantee reminders (new rows only)

- Today:
  - The daily cron is scheduled at `0 8 * * *` [VERIFIED via `vercel.json:39-42`] and runs three passes in order [VERIFIED via `lib/services/cron/grantee-deliverable-reminders-service.js:173-209`]:
    1. It processes each Invited deliverable: resolve recipients, then `createOrGetScheduledEmail`.
    2. It sends the digests.
    3. It delivers due messages through `deliverScheduledEmail`.
  - A row is created with `ccRecipients: [liaison email]` and `recipientContactIds: [pi, liaison]`, and `approval_required` is computed once from the PD's review-all override and VIP flags [VERIFIED via `lib/services/cron/grantee-deliverable-reminders-service.js:268-330`]. A missing Liaison email skips the row [VERIFIED via `lib/services/cron/grantee-deliverable-reminders-service.js:274-280`].
- Change at creation: add `_akoya_programid_value` and `_akoya_applicantid_value` to the Request projection, then resolve the Liaison through the helper. `none` → the row is created To the PI with no Cc. A helper/contact read failure → the row is skipped as retryable, never created PI-only. `found` with a blank email is also skipped and never weakened to PI-only.
- **Queued rows are not re-addressed by this plan, with one existing exception.** `scheduled-email-service.js`, the store and the digest are untouched, and a queued row keeps its stored recipients, except on the existing **PD handoff**. When `createOrGetScheduledEmail` returns a row owned by another PD, the cron already passes its freshly resolved draft to `reassignScheduledEmail`, which rewrites the recipients [VERIFIED via `lib/services/cron/grantee-deliverable-reminders-service.js:342-364`; `lib/services/scheduled-email-store.js:344-357`]. That branch keeps working as today, now with the helper's Liaison (or none), which is what rule 2 asks for. Its missing generation and version protections are a pre-existing hazard of every handoff, owned by the engine plan (round 4 finding 1; decision recorded here, not a new engine change). Re-addressing queued rows, and the engine hardening Codex rounds 2 and 3 showed it needs, is `docs/plans/SCHEDULED_EMAIL_READDRESS_PLAN_2026-09-29.md`. A reminder queued before a Liaison change therefore still goes to the Liaison it was queued with until that plan lands (owner answer 9).
- The `none` → PI-only change applies only to rows this cron newly creates. For them, the Cc is empty from creation, and no existing row changes shape.

### 3. Awardees panel — `awardees-service.js`

- Today, one list query loads Research awardees [VERIFIED via `lib/services/workbench/grantee-deliverables/awardees-service.js:116-142`]. `GRANTEE_RESEARCH_PROGRAM_IDS` re-exports `RESEARCH_PROGRAM_IDS` [VERIFIED via `shared/config/granteeResearchPrograms.js:19`]. The Liaison name is the formatted Request-copy lookup [VERIFIED via `lib/services/workbench/grantee-deliverables/awardees-service.js:159-166`], and the panel shows it or "—" [VERIFIED via `shared/components/workbench/AwardeesPanel.js:198-204`].
- Change: select `_akoya_applicantid_value`; one batched account read through the helper; use each `found.displayName` from the account Primary Contact annotation and no per-row contact reads. A failed, capped or incomplete batch fails the panel request; a missing formatted label may display "—" but does not change `found` to `none`.

### 4. Site-visit materials — `collection-service.js`

- Today [VERIFIED via `lib/services/site-visit-materials/collection-service.js:123-135,257-277,357-387`]:
  - Recipients come from `resolveSiteVisitApplicantContacts`.
  - Template names come from a direct read of the Request copy [VERIFIED via `lib/services/site-visit-materials/collection-service.js:123-135`]. The two reads can disagree.
  - A Liaison is required: a 409 if either recipient is missing [VERIFIED via `lib/services/site-visit-materials/collection-service.js:257-265`], and a 409 if `{{liaisonFullName}}` cannot be filled [VERIFIED via `lib/services/site-visit-materials/collection-service.js:371-385`].
  - Contacts are persisted as a snapshot by migration 042 [VERIFIED via `lib/db/migrations/042_site_visit_material_collections.sql:10-35`] and refreshed on manual invite and remind by compare-and-swap [VERIFIED via `lib/services/site-visit-materials/collection-store.js:81-112`].
- Change:
  - Add `_akoya_programid_value` to `collection-service.js`'s Request projection; both recipient and template-name reads use the helper, so they always agree.
  - `none` → the email goes to the PI only. **Only a helper `none` allows that** (round 4 finding 2). A `found` Liaison whose contact has no email still refuses with the existing 409 [VERIFIED via `lib/services/site-visit-materials/collection-service.js:257-265`], now naming the Liaison's missing email. The collection's saved `contacts` snapshot records both cases explicitly (`liaisonStatus: 'none', liaison: null` or `liaisonStatus: 'found', liaison: {...}`), so the invitation and both reminder paths make the same distinction without a migration. The saved-recipients card shows "No institution Liaison" only for explicit `liaisonStatus: 'none'`; a legacy snapshot with no status is "Liaison not verified" until a current resolution refreshes it.
  - A template using `{{liaisonFullName}}` still refuses without a Liaison, with a message naming the missing Institution Primary Contact.
  - A failure → 503.

### 5. Materials automatic reminder sweep

- Today [VERIFIED via `lib/services/site-visit-materials/reminder-sweep.js:110-143`; `lib/services/site-visit-materials/collection-store.js:137-151`]:
  - The sweep prepares the email from the persisted `row.contacts`, then claims with `claimAutomaticReminder`. That claim neither compares nor updates contacts [VERIFIED via `lib/services/site-visit-materials/reminder-sweep.js:130-143`; `lib/services/site-visit-materials/collection-store.js:137-151`].
  - A row without both emails is skipped [VERIFIED via `lib/services/site-visit-materials/reminder-sweep.js:116`].
- Change:
  - Add `_akoya_programid_value` to the sweep's Request projection. Before preparing, re-resolve contacts through the same `currentContacts` path the manual remind uses, and prepare from the refreshed set.
  - `claimAutomaticReminder(id, now, expectedContacts, refreshedContacts)` gains the manual claim's shape: `AND contacts = expectedContacts` and `SET contacts = refreshedContacts`, in the same conditional UPDATE that consumes the reminder claim (mirrors `claimManualReminder` [VERIFIED via `lib/services/site-visit-materials/collection-store.js:99-112`]).
  - Send only from the returned row. A lost compare-and-swap sends nothing. If only contacts changed, the row stays eligible for the next run; if another reminder won the claim, that winner consumes eligibility.
  - `none` → PI only. A read failure or `found` contact with a blank email skips before prepare/claim for this run; neither case is converted to PI-only.

### 6. Site-visit applicant contacts — `applicant-contacts.js`

- Today, the Request copy wins and the account Primary Contact is read only when the copy is blank [VERIFIED via `lib/services/site-visit/applicant-contacts.js:14-38`]. Consumers are materials collection and logistics attendee suggestions [VERIFIED via `lib/services/site-visit-materials/collection-service.js:25,89`; `lib/services/site-visit/logistics-service.js:21,67`].
- Change: add `_akoya_programid_value` to this service's Request projection. Research → the helper (institution only); other programs unchanged, including their account fallback. The attendee prefill suggests the current institution Liaison for Research; saved visits are not rewritten.

### 7. Reporting surfaces (owner answer 5)

- **Dataverse export:** it reads `akoya_primarycontactid` and emits it under a foundation-Liaison caption [VERIFIED via `lib/services/dataverse-export/constants.js:361-363`; `lib/services/dataverse-export/disclosure.js:238-242,312-337`; `lib/services/dataverse-export/workbook.js:40-45`]. Change: caption "Request Primary Contact (copy)" and its disclosure text; values unchanged.
- **Dynamics Explorer:**
  - Today, `handleContactRequests` finds a contact's Requests with one query across eleven Request role lookups, capped at `top: 100`. It labels a match on `_akoya_primarycontactid_value` as "Primary Contact" [VERIFIED via `lib/services/dynamics-explorer/tools/get-related.js:497-538`]. The prompt calls the Request field the Liaison [VERIFIED via `shared/config/prompts/dynamics-explorer.js:73`; `shared/config/prompts/dynamics-explorer.js:539`; `shared/config/prompts/dynamics-explorer.js:623`].
  - Change: that role is relabelled "Request Primary Contact (copy)", and Research Liaison relationships come from the institution. The merge (answers round 3 finding 6):
    1. **Accounts:** read accounts whose `_primarycontactid_value` is the contact with `queryAllAccounts` [VERIFIED via `lib/dataverse/adapters/account.js:40-41`]. That helper pages but hard-caps at 5,000 [VERIFIED via `lib/services/dynamics/read-ops.js:257-326`], so require an array, `capped !== true`, and `totalCount <= records.length`; a capped/malformed/incomplete account discovery fails the tool call instead of treating a partial account set as complete.
    2. **Research Requests:** split the account ids into OR-chunks of at most 25. For each chunk, read the Requests with parenthesized account-id and `RESEARCH_PROGRAM_IDS` predicates plus the handler's existing date filter and test-Request select, ordered by `akoya_submitdate desc,akoya_requestid asc`, `top: 100`. Each chunk returns its own newest 100, so their union contains the overall newest 100 (ties are deterministic).
    3. **Existing query:** unchanged apart from the label, now also selecting `akoya_requestid`.
    4. **Merge:** by lowercased `akoya_requestid`, with the roles of a Request in both results unioned (for example "PI, Liaison (institution)").
    5. **Order and cap:** sort by `akoya_submitdate` desc (null last), then `akoya_requestid` asc, then cap at 100. Keep `requestCount` equal to the returned merged rows.
    6. **Counts (round 4 finding 4):**
       - A Request query is complete only when `hasMore !== true` and `totalCount <= records.length`. When every Request query is complete, `totalCount` is the exact de-duplicated merged count and `hasMore: false`.
       - Otherwise `totalCount` is `null`, the result carries `returnedCount`, `requestCount: returnedCount` and `hasMore: true`, and the tool text says the list is partial.
       - Both Request queries order by `akoya_submitdate desc` before capping, so the returned subset is the newest.
       - The current prompt tells the model to show totals for truncated results [VERIFIED via `shared/config/prompts/dynamics-explorer.js:582`]; update it so a null total is reported as "at least N".
  - A failed account or Request read fails the tool call, as the existing query's failure does.
  - The prompt names the institution's Primary Contact as the Liaison of record. Prompt edits run `check:prompt-injection-tagging` and its self-test.

### Not Liaison reads (unchanged)

The honorarium onboarder writes this field as the individual payee [VERIFIED via `lib/bill/honorarium-onboard-orchestrator.js:154-164`], and reviewer removal counts those honorarium Request associations [VERIFIED via `lib/services/reviewer-finder/remove-candidate-service.js:166-187`]. Test Request Factory writers and probes also use the physical Request-copy field; they do not read it as the Research Liaison for an app workflow.

## Moved: re-addressing queued reminders

Revision 3's Phase 1 stop and Phase 2 design (recipient generation, recipient-only rebuild, send intent as a point of no return, the Needs attention section) moved verbatim to `docs/plans/SCHEDULED_EMAIL_READDRESS_PLAN_2026-09-29.md`, with Codex round 3's findings on them. None of it is part of this plan's build.

## Test matrix

Helper, unit, with case-varied GUIDs throughout:

| Program | Applicant | Request copy | Account Primary Contact | Expected |
|---|---|---|---|---|
| Research | set | differs from account | set | `found`, account contact |
| Research | set | set | blank | `none` (no fallback) |
| Research | blank | set | — | `none` (no fallback) |
| Research | set | any | account read throws | throws |
| omitted program/applicant/Request-copy key | any | any | — | throws (projection bug, not blank data) |
| Research (batch) | set ×3 | any | response omits one account | throws |
| Research (batch) | set ×26 | any | two complete account chunks with formatted names | aligned `found` results with `displayName` |
| Research (batch) | set | any | chunk reports `hasMore` or excess `totalCount` | throws |
| SoCal | set | set | set, differs | `request_copy` |
| blank program | set | set | set, differs | `request_copy` |

Per reader:
- **Invitation:**
  - Recipient and send-service Request projections include all three helper input fields; omitting the program field makes the test fail closed rather than use the Request copy.
  - Missing, malformed or extra-key `liaisonSeen` → 400, service and transport not invoked.
  - The Liaison contact changed after compose → 409, transport not invoked.
  - **The same contact's email changed after compose → 409, transport not invoked.**
  - A resolution failure → 503, not invoked.
  - The client saw none, and the current Liaison is set → 409.
  - The recipients load fails → Send disabled.
- **Reminder cron:**
  - The account returns a Liaison id but the contact read throws → row skipped, not created PI-only.
  - The account returns a Liaison id whose contact has no email → row skipped, not created PI-only.
  - `none` → PI-only row (new rows only).
  - An existing row with a stored Cc and the same PD is left unchanged by the cron — the documented gap until the engine plan lands.
  - An existing unsent row owned by a former PD is rebuilt by the existing handoff with the helper's Liaison: institution contact, or no Cc for `none`.
- **Awardees:** a batch missing an account → request fails. A divergent Request copy is never shown for Research. The formatted account Primary Contact name is returned without contact reads; a missing formatted label renders "—" while the result remains `found`.
- **Collection:** recipients and `{{liaisonFullName}}` from one source with divergent fixtures. `none` → PI-only send. **`found` with a blank email → 409, not PI-only.** A `{{liaisonFullName}}` template with `none` → refused. A legacy snapshot lacking `liaisonStatus` is not labelled "No institution Liaison."
- **Invitation load ordering:** switch Requests while a load is in flight (the slower old response lands last) → ignored; overlapping retries → only the latest result applies.
- **Reminder handoff:** an unsent row owned by a former PD, with the Request copy differing from the institution → rebuilt To the PI, Cc the institution Liaison; `none` → no Cc.
- **Sweep:**
  - A concurrent contacts-only update between prepare and claim, with `last_reminder_at` unchanged and every other eligibility predicate still true, → claim lost and nothing sent. Removing only the `contacts = expectedContacts` predicate makes this test fail.
  - Refreshed contacts persisted with the claim.
  - `none` → PI only.
  - `found` with a blank email → skipped before claim, not PI-only.
- **Applicant contacts:** SoCal keeps its account fallback. Research never uses the Request copy.
- **Export and Explorer:**
  - Divergent Request and account fixtures. The Explorer Liaison relationship returns the current institution contact's Research Requests and labels the former Request-copy match as the copy. The export shows the relabelled caption.
  - Explorer merge: a Request found by both queries appears once with both roles; a capped Request query gives `hasMore: true` and `totalCount: null` with `returnedCount`; a contact leading more than 25 accounts, with the newest Request in an account past the first 25, still returns that Request first; a `queryAllAccounts` result with `capped: true` fails the tool call; a chunk with more than 100 matching Requests plus a newer Request in another chunk proves the one global sort/cap; complete sources give the exact merged `totalCount`; a SoCal Request of an account the contact leads is not labelled Liaison (institution).

Every failure test asserts the transport or email-activity mock was not called, and every success test asserts the exact To and Cc sent. Each guard is mutation-checked, so the test fails when the guard is removed.

## Invariants

| Invariant | Where |
|---|---|
| Research Liaison = institution Primary Contact; Request copy never used for Research | helper; every reader |
| `none` only from a successful read; account, batch-cardinality and contact read failures fail closed | helper; readers 1–5 |
| Invitation and materials reminders go only to the Liaison current at send; new grantee reminders are created with the current Liaison | readers 1, 2, 5 |
| Queued grantee reminders unchanged except the existing PD-handoff rebuild (known gap; engine plan) | reader 2 |
| Non-Research and blank-program Requests unchanged | helper `request_copy` path |
| No new routes, tables or migrations; `scheduled-email-service.js`, its store and the digest untouched | `check:api-routes`, `check:atlas`, `check:migrations-manifest` |

## Review findings and responses

Round 1 (on revision 1):
1. (high) Client-supplied invitation Cc → server-side re-check at send (reader 1), strengthened in round 2.
2. (high) Email-activity recovery with a stale Liaison → Phase 1 stop before any activity; Phase 2 generation-specific correlation.
3. (high) VIP return to approval → Phase 2 recipient-only rebuild recomputes the posture and clears approval, version-fenced.
4. (high) Contact failures collapsing to "no Liaison" → discriminated helper result; contact read failures fail closed; batch cardinality check.
5. (high) Materials sweep refresh not atomic → compare-and-swap in `claimAutomaticReminder` (reader 5).
6. (medium) Export and Explorer → reader 7 (owner answer 5).
7. (medium) Test matrix gaps → *Test matrix*.

Round 2 (on revision 2):
1. (high) Rebuild could later adopt an older correlated draft → **recipient generation in the correlation key** (Phase 2); Phase 1 never rebuilds.
2. (high) `send_requested_at` does not stop a resend → **send intent is a point of no return** for Research reminders (Phase 2).
3. (high) The rebuild erased PD edits and had no expected version → **recipient-only, version-fenced `readdressScheduledEmail`**; PD handoff unchanged.
4. (high) Invitation check ignored an email change → compare contact id **and** email (reader 1).
5. (medium) Stopped rows invisible → **Needs attention** digest section and page error (Phase 1).
6. (medium) Explorer relabel left stale relationships → Explorer resolves Research Liaison relationships through the institution (reader 7).

Rounds 1–2 responses naming the Phase 1 stop, Phase 2, the recipient generation, `readdressScheduledEmail`, send intent or the Needs attention section now belong to the engine plan.

Round 3 (on revision 3):
1–5. (high) Phase 1 stops stranded by Phase 2; the source-cancel path not fenced; no crash-safe digest receipt; PD handoff outside the recipient generation; `send_unconfirmed` not a durable state → **moved with the design to `docs/plans/SCHEDULED_EMAIL_READDRESS_PLAN_2026-09-29.md`**; this plan no longer touches queued reminders or the email engine (owner answer 9).
6. (medium) Explorer merge contract incomplete → specified in reader 7 (bounded account discovery, merge by Request id with role union, one sort and cap, conservative `totalCount`/`hasMore`) and tested.

Round 4 (on revision 4; PI-only new rows confirmed compatible with the existing engine):
1. (high) PD handoff re-addresses queued rows despite the scope claim → claim corrected; the existing handoff keeps re-resolving recipients, now with the helper, as rule 2 wants; its generation hazard is pre-existing and in the engine plan (reader 2).
2. (medium) Site visits collapsed `none` with a Liaison lacking email → PI-only only for `none`; `found` without email stays a 409; the snapshot records the case (reader 4).
3. (medium) Awardee Retry had no stale-load guard → load sequence on every write (reader 1).
4. (medium) Explorer `totalCount` unprovable when capped → `null` plus `returnedCount` when any source is incomplete; queries ordered before capping (reader 7).

Round 5 (on revision 5): round-4 findings 1–3 closed. (medium) Explorer could not return the newest Requests after truncating accounts at 25 → account discovery reads all accounts; Request queries chunk the account ids, each ordered and capped, then one global sort and cap (reader 7).

Round 6 (Codex review and fix, on revision 6):
1. (high) The helper treats a blank program as non-Research, but most current reader projections omit `_akoya_programid_value`; passing those rows through would silently preserve the Request copy for Research. Evidence: `lib/services/workbench/grantee-deliverables/recipients-service.js:44-46`, `lib/services/workbench/grantee-deliverables/send-invite-service.js:59-63`, `lib/services/cron/grantee-deliverable-reminders-service.js:67-74`, `lib/services/site-visit-materials/collection-service.js:55-59`, `lib/services/site-visit-materials/reminder-sweep.js:47-50`, and `lib/services/site-visit/applicant-contacts.js:12-18`. Fix: omitted required keys throw, explicit null remains a valid blank value, every caller projection is enumerated, and projection tests fail closed.
2. (medium) The helper's `found` result exposed only id/source, but the Awardees design required a formatted name while forbidding contact reads. Evidence: revision-6 *The rule, precisely* versus reader 3; the current list obtains its label from a formatted Request lookup [VERIFIED via `lib/services/workbench/grantee-deliverables/awardees-service.js:159-166`]. Fix: `found.displayName` is a display-only formatted lookup value, the batch contract returns aligned results, and Awardees explicitly consumes it while send paths still require contact reads.
3. (medium) Round 5's "account discovery is never truncated" response was false: `queryAllAccounts` stops at 5,000 and returns `capped: true` [VERIFIED via `lib/services/dynamics/read-ops.js:257-326`]. Fix: Explorer fails the tool call on capped/malformed account discovery; Request-query completeness and exact/null count rules are now explicit, with deterministic global ordering and cap tests.
4. (medium) The invitation stale-Liaison interlock did not require or validate `liaisonSeen`, leaving an implementation path where omission could normalize to a legitimate null observation. Evidence: the current route accepts only the existing recipient/body fields [VERIFIED via `pages/api/workbench/grantee-deliverables/send-invite.js:47-85`]. Fix: a closed required object is route-validated, null is explicit, the check precedes mint/signature/transport, and negative tests prove neither service nor transport runs.
5. (medium) The site-visit distinction covered new snapshots but not legacy rows without `liaisonStatus`, and the automatic sweep lacked the `found`-without-email complement. Evidence: current snapshots carry only `pi`/`liaison` [VERIFIED via `lib/services/site-visit-materials/collection-service.js:268-277`] and the sweep currently collapses missing role emails [VERIFIED via `lib/services/site-visit-materials/reminder-sweep.js:116`]. Fix: both found/none states are explicit, missing legacy status stays unverified, and sweep tests prove a blank-email found contact skips before claim rather than becoming PI-only.
6. (medium) The proposed CAS regression could pass because a concurrent manual reminder also changes `last_reminder_at`, even if the contacts predicate were absent. Evidence: the manual claim stamps the reminder and contacts together [VERIFIED via `lib/services/site-visit-materials/collection-store.js:99-112`]. Fix: the test now performs a contacts-only concurrent update while every other claim predicate remains true and mutation-checks removal of only the contacts equality.
7. (medium) The build reconciliation list omitted active durable restatements of the old Request-copy semantics. Evidence: `docs/DATAVERSE_POWER_TOOLS_DESIGN.md:219`, `docs/DATAVERSE_POWER_TOOLS_TRACK_B_BUILD_PLAN.md:162-184`, `docs/DYNAMICS_EXPLORER_PATH_A_PLAN.md:92`, and `SESSION_PROMPT.md:716-720`. Fix: add them to the build sweep and require historical/current classification rather than silently leaving mixed guidance.

## Docs to reconcile in the build

Source headers (`lib/services/workbench/grantee-deliverables/recipients-service.js:9`, `lib/services/site-visit/applicant-contacts.js:2-4`, the reminder and sweep headers); `docs/API_ROUTE_SECURITY_MATRIX.md:156,336`; `docs/atlas/dataverse-wmkf-sitevisit.md:66`; `docs/atlas/postgres-infra-tables.md:673`; `docs/SERVICE_AND_UTILITY_CATALOG.md:83`; `docs/GRANTEE_PORTAL_SPEC.md:84`; `docs/GRANTEE_PORTAL_BUILD_PLAN.md:42,268`; `docs/APPLICANT_ADDITIONAL_MATERIALS_PLAN.md:507,771`; `docs/PC_MEETING_TRACKER_PLAN.md:151`; `docs/GRANTEE_DELIVERABLE_PACKAGE_MIGRATION_PLAN.md:109,192`; `docs/DYNAMICS_SCHEMA_ANNOTATION.md:106`; `docs/DATAVERSE_POWER_TOOLS_DESIGN.md:219`; `docs/DATAVERSE_POWER_TOOLS_TRACK_B_BUILD_PLAN.md:162-184`; `docs/DYNAMICS_EXPLORER_PATH_A_PLAN.md:92`; `SESSION_PROMPT.md:716-720`; `.claude-memory/project-institution-foundation-liaison.md`; `.claude-memory/reviewer-identity-fragmentation.md`; and the cast plan *Facts*. Reconcile with `/sweep`; classify historical evidence rather than rewriting it, and leave no active current-guidance statement that still calls the Research Request copy the institution Liaison.

## Release

Runtime change to email recipients: Tier 2 per `docs/CAMPAIGN_RELEASE_AND_DATAVERSE_TEST_STRATEGY.md`. Built on this branch and promoted deliberately after review. The engine plan is built and released separately.
