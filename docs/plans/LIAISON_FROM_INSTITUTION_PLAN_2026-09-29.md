# Research Liaison read from the applicant institution

Status: **DRAFT, revision 6 (2026-09-29, Session 549; round 4: one high and three medium; round 5: one medium; all answered below). Codex plan reviews: round 1 needs-attention (five high, two medium); round 2 needs-attention (four high, two medium); round 3 on revision 3 needs-attention (five high, one medium), five of the six on re-addressing queued reminders. Revision 4 splits the work (owner, S549): this plan covers the readers and new reminders; re-addressing queued reminders moves to `docs/plans/SCHEDULED_EMAIL_READDRESS_PLAN_2026-09-29.md`. One more review before the build. Nothing built.** Branch `claude/liaison-from-institution`.

## Decision (owner with the AkoyaGO platform owner, 2026-09-29)

For the Research program, the **Liaison of record belongs to the applicant institution**: the account's Primary Contact (`account.primarycontactid`), reached through the Request's `_akoya_applicantid_value`. App code stops reading the Request's copy (`akoya_request.akoya_primarycontactid`) as the Liaison for Research Requests.

Why: the Liaison flows up only (Request → institution, *WMKF_Update Org Primary Contact from Request*); nothing copies an institution's Primary Contact down to its existing Requests, so the Request copy goes stale when an institution changes its Liaison [VERIFIED: S548 workflow definitions, cast plan *Facts*; owner's check on 1003220].

Owner rules (S549):

1. **No Primary Contact on the institution → show no Liaison and send nothing to one.** No fallback to the Request copy. An email that has a PI still goes to the PI, with no Liaison Cc.
2. **Always the current Liaison**, including on old and closed Requests (historical liaisons have often left the role or the institution). Queued or saved recipients are re-resolved before they are sent.
3. **Research only.** Research = `akoya_programid` in `RESEARCH_PROGRAM_IDS` [VERIFIED via `shared/config/researchPrograms.js:6-9`: Science and Engineering Research, Medical Research]. SoCal (and any other or blank program) keeps today's behavior.
4. `akoya_request.wmkf_liaison` (a separate, unread "Liaison" lookup) is ignored.

Owner answers (S549, after round 2):

5. **Reporting:** the Dataverse export is relabelled as the Request's copy; Dynamics Explorer resolves Research Liaison relationships through the institution (reader 7).
6. **Invitation:** one editable Cc field, with a server-side check of the Liaison's contact **and** email at send (reader 1).
7. **Measure first:** an owner-run read-only probe counts how the rule changes recipients before the build (*Measurement*).
8. **Duplicate contact rows** for one person may change the address used: accepted.
9. ~~**Both phases are built**~~ **Split (owner, S549, after round 3):** this plan builds the reader switch and gives new reminders the current Liaison. Re-addressing reminders already queued (and the engine hardening it needs) is a separate plan, `docs/plans/SCHEDULED_EMAIL_READDRESS_PLAN_2026-09-29.md`. Until that lands, a reminder queued before a Liaison change still goes to the Liaison it was queued with: the one known gap in rule 2.

## The rule, precisely

One helper, `lib/services/contacts/request-liaison.js` [PLANNED; name open], decides the Liaison for a Request row carrying `_akoya_programid_value`, `_akoya_applicantid_value` and `_akoya_primarycontactid_value`. It returns a **discriminated result**, never a bare null:

| Result | Meaning |
|---|---|
| `{ status: 'found', contactId, source }` | a Liaison contact id; `source` is `institution` (Research) or `request_copy` (other programs) |
| `{ status: 'none', source }` | a successful read confirmed there is no Liaison (Research: applicant blank, or the account's Primary Contact blank; other programs: the Request copy blank) |
| throws | any read failure, or an account read that does not return the requested row |

| Request | Result |
|---|---|
| Research program, applicant set | the account's `_primarycontactid_value` → `found`, or `none` if blank |
| Research program, applicant blank | `none` (no Request-copy fallback) |
| Any other program, or program blank | the reader's current behavior, through `source: 'request_copy'` |

Program ids and applicant ids compare case-insensitively. The batched form, `resolveRequestLiaisons(rows)`, reads the distinct applicant accounts in chunks through the account adapter [VERIFIED via `lib/dataverse/adapters/account.js:21,31,40`: `getById`, `queryAccounts`, `queryAllAccounts`] and **throws if any requested account is missing from the response**; a missing row is not evidence of a blank Primary Contact.

**Contact reads after the id (invariant).** Each reader resolves the contact id to name and email with its own contact read. A failed contact read is also a failure, never `none`. Two readers degrade that today and change:
- `recipients-service.js` returns the id with null PII on a contact read error [VERIFIED via `lib/services/workbench/grantee-deliverables/recipients-service.js:21-29`] → it throws a 503 instead.
- The reminder cron's `readContact` returns null on any error [VERIFIED via `lib/services/cron/grantee-deliverable-reminders-service.js:84-91`] → a read error skips the row as a retryable failure; only `none` produces a PI-only reminder.

## Measurement (owner answer 7)

Before the build, the owner runs a read-only production probe (session scratch script `probe-research-liaison-coverage.js`; counts only, no names, emails or ids). It covers active Research awardees and Research Requests with a meeting date today or later, both excluding test Requests. For each population it reports how many Request copies match the institution's Primary Contact, differ from it, would gain a Liaison, or would lose the Liaison Cc under rule 1. The result is recorded here; the probe is committed as a script in the build if kept.

**Result (owner-requested run, production, 2026-09-29, read-only, complete) [DERIVED-FROM: probe output; contact GUIDs compared, not people]:**

| | A. Active Research awardees | B. Research Requests, meeting date ≥ 2026-09-29 |
|---|---|---|
| Requests | 108 | 213 |
| Distinct institutions (no Primary Contact) | 64 (1) | 133 (0) |
| Request copy = institution Primary Contact | 23 | 168 |
| Request copy differs (the Liaison changes) | 84 | 44 |
| Request copy blank, institution set (Liaison gained) | 0 | 1 |
| Liaison Cc dropped under rule 1 | 1 | 0 |

Rule 1 costs almost nothing: one awardee loses its Liaison Cc. The switch itself changes the Liaison contact on most active awardees (84 of 108) and on about a fifth of upcoming Requests. Some of those differences may be duplicate contact rows for one person rather than a different person, so the address may or may not change (earlier SoCal probes found GUID divergence overstates person divergence; owner answer 8 accepts this).

**Email comparison of the differing pairs (owner-requested run, production, 2026-09-29, read-only, complete) [DERIVED-FROM: probe output; normalized `emailaddress1`]:**

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
  - Recipients come from `recipients-service.js` (select `_akoya_primarycontactid_value`).
  - The Awardee tab prefills an editable Cc and **swallows a recipients load failure**, leaving the fields blank for staff to type [VERIFIED via `shared/components/workbench/AwardeeTab.js:266-275`].
  - The send route accepts any Cc the client submits [VERIFIED via `pages/api/workbench/grantee-deliverables/send-invite.js:53-84`].
- Change:
  - The recipients response gains `liaison.contactId` and `liaison.email` as resolved by the helper and the contact read (both null for `none`).
  - The client echoes both on send as `liaisonSeen: { contactId, email }`. The send service re-resolves the Liaison server-side immediately before sending, and compares normalized contact id **and** normalized email with what the client saw:
    - Any difference, including a Liaison that appeared or disappeared → 409 `liaison_changed` ("The Liaison changed; reload before sending"), nothing sent.
    - A resolution failure → 503, nothing sent.
    - A match → the Cc is sent as submitted. Staff edits, including removing the Liaison or adding an assistant, stay deliberate (owner answer 6).
  - The Awardee tab shows a recipients load failure with Retry and disables Send until recipients load. Today the loader guards only a successful response, by request id [VERIFIED via `shared/components/workbench/AwardeeTab.js:266-275`]. The new version keeps a load sequence number: every success, failure and loading-state write checks that its sequence is still the latest and the request is unchanged, and switching Requests resets the state (round 4 finding 3).

### 2. Grantee reminders (new rows only)

- Today:
  - The daily cron (`0 8 * * *`, `vercel.json`) runs three passes in order [VERIFIED via `lib/services/cron/grantee-deliverable-reminders-service.js:173-209`]:
    1. It processes each Invited deliverable: resolve recipients, then `createOrGetScheduledEmail`.
    2. It sends the digests.
    3. It delivers due messages through `deliverScheduledEmail`.
  - A row is created with `ccRecipients: [liaison email]` and `recipientContactIds: [pi, liaison]`, and `approval_required` is computed once from the PD's review-all override and VIP flags [VERIFIED via `:268-330`]. A missing Liaison email skips the row (`:277-280`).
- Change at creation: the Liaison comes from the helper. `none` → the row is created To the PI with no Cc. A failure → the row is skipped as retryable, never created PI-only.
- **Queued rows are not re-addressed by this plan, with one existing exception.** `scheduled-email-service.js`, the store and the digest are untouched, and a queued row keeps its stored recipients, except on the existing **PD handoff**. When `createOrGetScheduledEmail` returns a row owned by another PD, the cron already passes its freshly resolved draft to `reassignScheduledEmail`, which rewrites the recipients [VERIFIED via `grantee-deliverable-reminders-service.js:332-351`; `scheduled-email-store.js:344-357`]. That branch keeps working as today, now with the helper's Liaison (or none), which is what rule 2 asks for. Its missing generation and version protections are a pre-existing hazard of every handoff, owned by the engine plan (round 4 finding 1; decision recorded here, not a new engine change). Re-addressing queued rows, and the engine hardening Codex rounds 2 and 3 showed it needs, is `docs/plans/SCHEDULED_EMAIL_READDRESS_PLAN_2026-09-29.md`. A reminder queued before a Liaison change therefore still goes to the Liaison it was queued with until that plan lands (owner answer 9).
- The `none` → PI-only change applies only to rows this cron newly creates. For them, the Cc is empty from creation, and no existing row changes shape.

### 3. Awardees panel — `awardees-service.js`

- Today: one list query over Research awardees (header `:10-11`; `GRANTEE_RESEARCH_PROGRAM_IDS` re-exports `RESEARCH_PROGRAM_IDS` [VERIFIED via `shared/config/granteeResearchPrograms.js:19`]); the Liaison name is the formatted value of `_akoya_primarycontactid_value` (`:166`); `AwardeesPanel.js:203` shows it or "—" [VERIFIED].
- Change: select `_akoya_applicantid_value`; one batched account read through the helper, taking `_primarycontactid_value` and its formatted name; no per-row contact reads. A failed or incomplete batch fails the panel request.

### 4. Site-visit materials — `collection-service.js`

- Today:
  - Recipients come from `resolveSiteVisitApplicantContacts`.
  - Template names come from a direct read of the Request copy (`:126`) [VERIFIED]. The two reads can disagree.
  - A Liaison is required: a 409 if either recipient is missing (`:257-265`), and a 409 if `{{liaisonFullName}}` can't be filled (`:373-380`).
  - Contacts are persisted as a snapshot (migration 042), refreshed on manual invite and remind by compare-and-swap [VERIFIED via `lib/services/site-visit-materials/collection-store.js:81-112`].
- Change:
  - Both reads use the helper, so recipients and names always agree.
  - `none` → the email goes to the PI only. **Only a helper `none` allows that** (round 4 finding 2). A `found` Liaison whose contact has no email still refuses with the existing 409 (`:257-265`), now naming the Liaison's missing email. The collection's saved `contacts` snapshot records which case applies (`liaison: null` with `liaisonStatus: 'none'`), so the invitation and both reminder paths make the same distinction. The saved-recipients card shows "No institution Liaison" for `none`, not a missing email.
  - A template using `{{liaisonFullName}}` still refuses without a Liaison, with a message naming the missing Institution Primary Contact.
  - A failure → 503.

### 5. Materials automatic reminder sweep

- Today:
  - The sweep prepares the email from the persisted `row.contacts`, then claims with `claimAutomaticReminder`. That claim neither compares nor updates contacts [VERIFIED via `lib/services/site-visit-materials/reminder-sweep.js:130-143`; `collection-store.js:137-151`].
  - A row without both emails is skipped (`:116`).
- Change:
  - Before preparing, re-resolve contacts through the same `currentContacts` path the manual remind uses, and prepare from the refreshed set.
  - `claimAutomaticReminder(id, now, expectedContacts, refreshedContacts)` gains the manual claim's shape: `AND contacts = expectedContacts` and `SET contacts = refreshedContacts`, in the same conditional UPDATE that consumes the reminder claim (mirrors `claimManualReminder`, `collection-store.js:99-112`).
  - Send only from the returned row. A lost compare-and-swap sends nothing, and the row stays eligible for the next run.
  - `none` → PI only. A read failure skips the row for this run.

### 6. Site-visit applicant contacts — `applicant-contacts.js`

- Today [VERIFIED via `lib/services/site-visit/applicant-contacts.js:14-38`]: Request copy first; account Primary Contact only when the copy is blank (`:26`). Consumers: collection-service and the logistics attendee suggestions.
- Change: Research → the helper (institution only); other programs unchanged, including their account fallback. The attendee prefill suggests the current institution Liaison for Research; saved visits are not rewritten.

### 7. Reporting surfaces (owner answer 5)

- **Dataverse export:** it reads `akoya_primarycontactid` and emits it under a foundation-Liaison caption (per rounds 1 and 2: `lib/services/dataverse-export/constants.js:361-363`, `disclosure.js:238-242,312-337`, `workbook.js:40-45`). Change: caption "Request Primary Contact (copy)" and its disclosure text; values unchanged.
- **Dynamics Explorer:**
  - Today, `handleContactRequests` finds a contact's Requests with one query across eleven Request role lookups, capped at `top: 100`. It labels a match on `_akoya_primarycontactid_value` as "Primary Contact" [VERIFIED via `lib/services/dynamics-explorer/tools/get-related.js:497-538`]. The prompt calls the Request field the Liaison (`shared/config/prompts/dynamics-explorer.js:73,539,623`, per round 1).
  - Change: that role is relabelled "Request Primary Contact (copy)", and Research Liaison relationships come from the institution. The merge (answers round 3 finding 6):
    1. **Accounts:** read **all** accounts whose `_primarycontactid_value` is the contact, paging to completion (`queryAllAccounts`, `lib/dataverse/adapters/account.js:40`); account discovery is never truncated (round 5).
    2. **Research Requests:** split the account ids into OR-chunks of at most 25. For each chunk, read the Requests with a Research program and the handler's existing date filter and test-Request select, ordered by `akoya_submitdate desc`, `top: 100`. Each chunk returns its own newest 100, so their union contains the overall newest 100.
    3. **Existing query:** unchanged apart from the label, now also selecting `akoya_requestid`.
    4. **Merge:** by lowercased `akoya_requestid`, with the roles of a Request in both results unioned (for example "PI, Liaison (institution)").
    5. **Order and cap:** sort by `akoya_submitdate` desc, then cap at 100.
    6. **Counts (round 4 finding 4):**
       - When no Request query hit its cap, `totalCount` is the exact merged count.
       - Otherwise `totalCount` is `null`, the result carries `returnedCount` and `hasMore: true`, and the tool text says the list is partial.
       - Both Request queries order by `akoya_submitdate desc` before capping, so the returned subset is the newest.
       - The prompt's truncation rule (`shared/config/prompts/dynamics-explorer.js:582`, per round 4) is updated so a null total is reported as "at least N".
  - A failed account or Request read fails the tool call, as the existing query's failure does.
  - The prompt names the institution's Primary Contact as the Liaison of record. Prompt edits run `check:prompt-injection-tagging` and its self-test.

### Not Liaison reads (unchanged)

`lib/bill/honorarium-onboard-orchestrator.js:163` [VERIFIED: writes the field on the honorarium Request, the payee]; `lib/services/reviewer-finder/remove-candidate-service.js:175` [VERIFIED: counts those honorarium Requests]; `lib/services/test-requests/*` (the Factory sets the Request copy so AkoyaGO copies it up); `scripts/probe-*`.

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
| Research (batch) | set ×3 | any | response omits one account | throws |
| SoCal | set | set | set, differs | `request_copy` |
| blank program | set | set | set, differs | `request_copy` |

Per reader:
- **Invitation:**
  - The Liaison contact changed after compose → 409, transport not invoked.
  - **The same contact's email changed after compose → 409, transport not invoked.**
  - A resolution failure → 503, not invoked.
  - The client saw none, and the current Liaison is set → 409.
  - The recipients load fails → Send disabled.
- **Reminder cron:**
  - The account returns a Liaison id but the contact read throws → row skipped, not created PI-only.
  - `none` → PI-only row (new rows only).
  - An existing row with a stored Cc and the same PD is left unchanged by the cron — the documented gap until the engine plan lands.
  - An existing unsent row owned by a former PD is rebuilt by the existing handoff with the helper's Liaison: institution contact, or no Cc for `none`.
- **Awardees:** a batch missing an account → request fails. A divergent Request copy never shown for Research.
- **Collection:** recipients and `{{liaisonFullName}}` from one source with divergent fixtures. `none` → PI-only send. **`found` with a blank email → 409, not PI-only.** A `{{liaisonFullName}}` template with `none` → refused.
- **Invitation load ordering:** switch Requests while a load is in flight (the slower old response lands last) → ignored; overlapping retries → only the latest result applies.
- **Reminder handoff:** an unsent row owned by a former PD, with the Request copy differing from the institution → rebuilt To the PI, Cc the institution Liaison; `none` → no Cc.
- **Sweep:**
  - A concurrent manual contacts update between prepare and claim → claim lost, nothing sent.
  - Refreshed contacts persisted with the claim.
  - `none` → PI only.
- **Applicant contacts:** SoCal keeps its account fallback. Research never uses the Request copy.
- **Export and Explorer:**
  - Divergent Request and account fixtures. The Explorer Liaison relationship returns the current institution contact's Research Requests and labels the former Request-copy match as the copy. The export shows the relabelled caption.
  - Explorer merge: a Request found by both queries appears once with both roles; a capped Request query gives `hasMore: true` and `totalCount: null` with `returnedCount`; a contact leading more than 25 accounts, with the newest Request in an account past the first 25, still returns that Request first; complete sources give the exact merged `totalCount`; a SoCal Request of an account the contact leads is not labelled Liaison (institution).

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

## Docs to reconcile in the build

Source headers (`recipients-service.js:9`, `applicant-contacts.js:2-4`, the reminder and sweep headers); `docs/API_ROUTE_SECURITY_MATRIX.md:156,336`; `docs/atlas/dataverse-wmkf-sitevisit.md:66`; `docs/atlas/postgres-infra-tables.md:673`; `docs/SERVICE_AND_UTILITY_CATALOG.md:83`; `docs/GRANTEE_PORTAL_SPEC.md:84`; `docs/GRANTEE_PORTAL_BUILD_PLAN.md:42,268`; `docs/APPLICANT_ADDITIONAL_MATERIALS_PLAN.md:507,771`; `docs/PC_MEETING_TRACKER_PLAN.md:151`; `docs/GRANTEE_DELIVERABLE_PACKAGE_MIGRATION_PLAN.md:109,192`; `docs/DYNAMICS_SCHEMA_ANNOTATION.md:106`; `.claude-memory/project-institution-foundation-liaison.md`; the cast plan *Facts*. Reconcile with `/sweep`; historical plans are classified, not rewritten.

## Release

Runtime change to email recipients: Tier 2 per `docs/CAMPAIGN_RELEASE_AND_DATAVERSE_TEST_STRATEGY.md`. Built on this branch and promoted deliberately after review. The engine plan is built and released separately.
