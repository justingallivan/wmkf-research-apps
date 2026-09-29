# Research Liaison read from the applicant institution

Status: **DRAFT, revision 2 (2026-09-29, Session 549). Codex plan review round 1 (gpt-5.6-sol high): needs-attention, five high and two medium; each is answered under *Round 1 findings and responses*. A second review is required before any build (owner, S549). Nothing built.** Branch `claude/liaison-from-institution`.

## Decision (owner with the AkoyaGO platform owner, 2026-09-29)

For the Research program, the **Liaison of record belongs to the applicant institution**: the account's Primary Contact (`account.primarycontactid`), reached through the Request's `_akoya_applicantid_value`. App code stops reading the Request's copy (`akoya_request.akoya_primarycontactid`) as the Liaison for Research Requests.

Why: the Liaison flows up only (Request → institution, *WMKF_Update Org Primary Contact from Request*); nothing copies an institution's Primary Contact down to its existing Requests, so the Request copy goes stale when an institution changes its Liaison [VERIFIED: S548 workflow definitions, cast plan *Facts*; owner's check on 1003220].

Owner rules (S549):

1. **No Primary Contact on the institution → show no Liaison and send nothing to one.** No fallback to the Request copy. An email that has a PI still goes to the PI, with no Liaison Cc.
2. **Always the current Liaison**, including on old and closed Requests (historical liaisons have often left the role or the institution). Queued or saved recipients are re-resolved before they are sent.
3. **Research only.** Research = `akoya_programid` in `RESEARCH_PROGRAM_IDS` [VERIFIED via `shared/config/researchPrograms.js:6-9`: Science and Engineering Research, Medical Research]. SoCal (and any other or blank program) keeps today's behavior.
4. `akoya_request.wmkf_liaison` (a separate, unread "Liaison" lookup) is ignored.

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

## Readers and changes

### 1. Awardee invitation — recipients and send

- Today:
  - Recipients come from `recipients-service.js` (select `_akoya_primarycontactid_value`).
  - The Awardee tab prefills an editable Cc. It **swallows a recipients load failure** and leaves the fields blank for staff to type [VERIFIED via `shared/components/workbench/AwardeeTab.js:266-275`].
  - The send route accepts any Cc the client submits [VERIFIED via `pages/api/workbench/grantee-deliverables/send-invite.js:53-84`].
- Change (answers finding 1):
  - The recipients response gains `liaison.contactId` as resolved by the helper (null for `none`).
  - The client echoes it on send as `liaisonSeenContactId`. The send service re-resolves the Liaison server-side immediately before sending:
    - A different current Liaison → 409 `liaison_changed` ("The Liaison changed; reload before sending"), nothing sent.
    - A resolution failure → 503, nothing sent.
    - A match → the Cc is sent as submitted. Staff edits, including removing the Liaison or adding an assistant, stay deliberate.
  - The Awardee tab shows a recipients load failure with Retry and disables Send until recipients load, instead of swallowing it.
- A failed contact read is a 503 (see *The rule*).

### 2. Grantee reminders — creation, rebuild and send

- Today:
  - The daily cron (`0 8 * * *`, `vercel.json`) runs three passes in order [VERIFIED via `lib/services/cron/grantee-deliverable-reminders-service.js:173-209`]:
    1. It processes each Invited deliverable: resolve recipients, then `createOrGetScheduledEmail`.
    2. It sends the digests.
    3. It delivers due messages through `deliverScheduledEmail`.
  - A row is created with `ccRecipients: [liaison email]` and `recipientContactIds: [pi, liaison]`, and `approval_required` is computed from the PD's review-all override and VIP flags [VERIFIED via `:268-330`].
  - A missing Liaison email skips the row (`:277-280`).
  - An existing row is rebuilt in place only on a PD handoff, through `reassignScheduledEmail` [VERIFIED via `:332-351`].
  - That store operation is atomic and fenced [VERIFIED via `lib/services/scheduled-email-store.js:344-377`]:
    - It writes new recipients, contact ids, body and approval posture, sets `status = 'scheduled'`, bumps `version`, and clears `reviewed_at`/`approved_at`/`edited_at`.
    - It applies only while `status IN ('scheduled','failed')`, `dynamics_email_id IS NULL`, `send_requested_at IS NULL` and no live lease.
- Change at creation: the Liaison comes from the helper. `none` → the row is created To the PI with no Cc. A failure → the row is skipped as retryable (`summary` failure), never created PI-only.
- **Change at rebuild (answers findings 2 and 3 without a migration):**
  - Generalize the rebuild trigger from "PD changed" to "PD changed **or** the recipients the cron just resolved differ from the row's stored `to_recipients`, `cc_recipients` or `recipient_contact_ids`".
  - The store operation gains a matching WHERE clause: the current PD-inequality test becomes "PD differs, or any of the three recipient columns differs from the input", and the transport and lease conditions stay unchanged.
  - Because the rebuild recomputes `approval_required` from the new recipients and clears any earlier approval, a newly substituted VIP Liaison needs review, and a PD approval given for the old recipients does not carry over.
  - The rebuild runs in the same cron invocation, minutes before the delivery pass, so recipients are current as of the send.
  - The Liaison is identifiable without a new column: `cc_recipients` holds only the Liaison's address today (`:326-328`); the PD edit action changes only subject and body (`pages/api/scheduled-emails/[id].js:60-67`).
  - **Cost:** the rebuild rewrites `subject`, `body_text` and `signature_text` from the defaults and clears `edited_at` (`scheduled-email-store.js:354-362`), so a PD's edited text is lost when the Liaison changes, exactly as on a PD handoff today. Alternative: a recipients-only rebuild variant that keeps an edited body. Owner question 5.
- **Change at send (answers finding 2 for rows the cron did not rebuild):**
  - `deliverScheduledEmail` gains a pre-activity drift check beside `sourceStillEligible` [VERIFIED via `lib/services/scheduled-email-service.js:309-313`]. It covers rows a capped cron pass deferred and a PD's send-now.
  - The check re-resolves the Liaison (Research Requests; other programs keep the stored Cc) and compares its email with the stored `cc_recipients`:
    - On drift it sends nothing and leaves the row for the next cron pass to rebuild, with `last_error_code = 'liaison_changed'`. The row must end in a state the rebuild WHERE admits (`scheduled` or `failed`, no lease, no transport state) [ASSUMED: an existing release path for a claimed row gives that; the build verifies it or adds one].
    - A read failure throws, and the send stays retryable, as `sourceStillEligible` does for non-404 errors (`:140-154`).
  - Send-now passes `expectedVersion` and returns 409 when the claim is lost [VERIFIED via `pages/api/scheduled-emails/[id].js:82-91`], so a PD acting on a stale preview after a rebuild cannot send it.
- **Existing Dynamics activity (finding 2):** once `dynamics_email_id` is set, the row cannot be rebuilt.
  - If recovery finds an unaccepted draft activity and no `send_requested_at`, the drift check runs first. On drift the row is stopped for staff attention (`last_error_code = 'liaison_changed_after_draft'`, not sent, surfaced in the PD digest's failure list) rather than sending the old parties.
  - With `send_requested_at` set or an accepted activity, recovery reconciles without mutation, as today.
  - Test Requests are stopped before the claim under isolation [VERIFIED via `scheduled-email-service.js:284-306`]; unchanged.

### 3. Awardees panel — `awardees-service.js`

- Today: one list query over research awardees (header `:10-11`; `GRANTEE_RESEARCH_PROGRAM_IDS` re-exports `RESEARCH_PROGRAM_IDS` [VERIFIED via `shared/config/granteeResearchPrograms.js:19`]); the Liaison name is the formatted value of `_akoya_primarycontactid_value` (`:166`); `AwardeesPanel.js:203` shows it or "—" [VERIFIED].
- Change: select `_akoya_applicantid_value`; one batched account read through the helper, taking `_primarycontactid_value` and its formatted name; no per-row contact reads. A failed or incomplete batch (finding 4) fails the panel request.

### 4. Site-visit materials — `collection-service.js`

- Today:
  - Recipients come from `resolveSiteVisitApplicantContacts`.
  - Template names come from a direct read of the Request copy (`:126`) [VERIFIED]. The two reads can disagree.
  - A Liaison is required: a 409 if either recipient is missing (`:257-265`), and a 409 if `{{liaisonFullName}}` can't be filled (`:373-380`).
  - Contacts are persisted as a snapshot (migration 042), refreshed on manual invite and remind by compare-and-swap [VERIFIED via `lib/services/site-visit-materials/collection-store.js:81-112`].
- Change:
  - Both reads use the helper, so recipients and names always agree.
  - `none` → the email goes to the PI only. The recipients 409 becomes PI-required.
  - A template using `{{liaisonFullName}}` still refuses without a Liaison, with a message naming the missing Institution Primary Contact.
  - A failure → 503.

### 5. Materials automatic reminder sweep (answers finding 5)

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
- Change: Research → the helper (institution only); other programs unchanged, including their account fallback. The attendee prefill therefore suggests the current institution Liaison for Research; saved visits are not rewritten.

### 7. Reporting surfaces (answers finding 6; owner choice)

- The Dataverse export reads `akoya_primarycontactid` and emits it under a foundation-Liaison caption (`lib/services/dataverse-export/constants.js:361-363`; `disclosure.js:238-242,312-337`; `workbook.js:40-45`, per round 1).
- Dynamics Explorer reverse-queries `_akoya_primarycontactid_value` and labels matches "Primary Contact" (`dynamics-explorer/tools/get-related.js:497-538`, per round 1). Its prompt also calls the Request field the Liaison (`shared/config/prompts/dynamics-explorer.js:73,539,623`).
- Options:
  - **(a) relabel:** these report the raw Request field, captioned "Request Primary Contact (copy)", and the Explorer prompt names the institution's Primary Contact as the Liaison of record.
  - **(b) resolve:** Research exports and relationship answers resolve the institution's contact.
- Recommendation: (a), since neither sends email.

### Not Liaison reads (unchanged)

`lib/bill/honorarium-onboard-orchestrator.js:163` [VERIFIED: writes the field on the honorarium Request, the payee]; `lib/services/reviewer-finder/remove-candidate-service.js:175` [VERIFIED: counts those honorarium Requests]; `lib/services/test-requests/*` (the Factory sets the Request copy so AkoyaGO copies it up); `scripts/probe-*`.

## Test matrix (answers finding 7)

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

Per reader, in addition:
- **Invitation:**
  - The Liaison changed after compose → 409, transport not invoked.
  - A resolution failure → 503, not invoked.
  - The client saw none, and the current Liaison is set → 409.
  - The recipients load fails → Send disabled.
- **Reminder cron:**
  - The account returns a Liaison id but the contact read throws → row skipped, not created PI-only.
  - Stored Cc X, current Y, unsent → rebuilt to Y, approval reset. A new VIP → `approval_required`.
  - Drift on a row with `dynamics_email_id` and no `send_requested_at` → stopped, not sent.
  - Drift at send-now on a row the cron did not rebuild → not sent.
  - `none` → PI-only row.
- **Awardees:** a batch missing an account → request fails. A divergent Request copy never shown for Research.
- **Collection:** recipients and `{{liaisonFullName}}` from one source with divergent fixtures. `none` → PI-only send. A template with `{{liaisonFullName}}` and `none` → refused.
- **Sweep:**
  - A concurrent manual contacts update between prepare and claim → claim lost, nothing sent.
  - Refreshed contacts persisted with the claim.
  - `none` → PI-only.
- **Applicant contacts:** SoCal keeps its account fallback. Research never uses the Request copy.
- **Assertions:** every failure test asserts the transport or email-activity mock was not called, and every success test asserts the exact To and Cc sent. Each guard is mutation-checked, so the test fails when the guard is removed.

## Invariants

| Invariant | Where |
|---|---|
| Research Liaison = institution Primary Contact; Request copy never used for Research | helper; every reader |
| `none` only from a successful read; account, batch-cardinality and contact read failures fail closed | helper; readers 1–5 |
| No send to a Liaison other than the current one: invitation re-resolves at send; reminders rebuild before delivery and re-check at send; materials sweep compares and swaps with the claim | readers 1, 2, 5 |
| A changed Liaison re-runs the PD review posture | reader 2 rebuild |
| Non-Research and blank-program Requests unchanged | helper `request_copy` path |
| No new routes, tables or migrations | `check:api-routes`, `check:atlas`, `check:migrations-manifest` |

## Round 1 findings and responses

1. (high) Client-supplied invitation Cc → **server-side re-resolution at send with `liaisonSeenContactId`**; load failure no longer swallowed (reader 1). Deviation from the recommendation: the Cc field is not split into Liaison and extras; a matching Liaison keeps the staff-edited Cc as submitted.
2. (high) Email-activity recovery with a stale Liaison → **rebuild before activity creation; drift check at send; a drifted row with a draft activity is stopped, not sent** (reader 2).
3. (high) VIP return to approval without a durable design → **reuse the fenced `reassignScheduledEmail` rebuild** (it resets approval, bumps `version`, and is transport- and lease-fenced), triggered by recipient drift; **no migration**, since `cc_recipients` holds only the Liaison.
4. (high) Contact failures collapsing to "no Liaison" → discriminated helper result; contact read failures fail closed in the two readers that degrade today; batch cardinality check.
5. (high) Materials sweep refresh not atomic → **compare-and-swap in `claimAutomaticReminder`**, mirroring `claimManualReminder`.
6. (medium) Export and Explorer present the Request field as the Liaison → reader 7, owner choice (recommend relabel).
7. (medium) Test matrix gaps → *Test matrix*.

## Docs to reconcile in the build

Source headers (`recipients-service.js:9`, `applicant-contacts.js:2-4`, the reminder and sweep headers); `docs/API_ROUTE_SECURITY_MATRIX.md:156,336`; `docs/atlas/dataverse-wmkf-sitevisit.md:66`; `docs/atlas/postgres-infra-tables.md:673`; `docs/SERVICE_AND_UTILITY_CATALOG.md:83`; `docs/GRANTEE_PORTAL_SPEC.md:84`; `docs/GRANTEE_PORTAL_BUILD_PLAN.md:42,268`; `docs/APPLICANT_ADDITIONAL_MATERIALS_PLAN.md:507,771`; `docs/PC_MEETING_TRACKER_PLAN.md:151`; `docs/GRANTEE_DELIVERABLE_PACKAGE_MIGRATION_PLAN.md:109,192`; `docs/DYNAMICS_SCHEMA_ANNOTATION.md:106`; `.claude-memory/project-institution-foundation-liaison.md`; the cast plan *Facts*. Reconcile with `/sweep`; historical plans are classified, not rewritten.

## Open questions for the owner

1. Reporting surfaces (reader 7): relabel (recommended) or resolve?
2. Invitation: keep the single editable Cc with a server-side Liaison check (recommended), or split it into a fixed Liaison line plus extra Ccs?
3. How common a blank institution Primary Contact is among active Research awardees is unmeasured [ASSUMED]. An owner-run read-only probe before the build would show whether rule 1 drops Liaison Ccs broadly.
4. Duplicate contact rows (one person, two contacts) may change the address used for the same person. Accepted for Research [owner, S549].
5. Reminder rebuild on a Liaison change: accept losing a PD's edited text, as the PD handoff does (simplest), or keep an edited body and replace only recipients and review posture?

## Release

Runtime change to email recipients: Tier 2 per `docs/CAMPAIGN_RELEASE_AND_DATAVERSE_TEST_STRATEGY.md`, built on this branch, promoted deliberately after review.
