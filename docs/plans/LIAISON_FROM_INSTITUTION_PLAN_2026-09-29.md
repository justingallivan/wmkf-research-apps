# Research Liaison read from the applicant institution

Status: **DRAFT, revision 1 (2026-09-29, Session 549). Not reviewed; a Codex plan review is required before any build (owner, S549). Nothing built.** Branch `claude/liaison-from-institution`.

## Decision (owner with the AkoyaGO platform owner, 2026-09-29)

For the Research program, the **Liaison of record belongs to the applicant institution**: the account's Primary Contact (`account.primarycontactid`), reached through the Request's `_akoya_applicantid_value`. App code stops reading the Request's copy (`akoya_request.akoya_primarycontactid`) as the Liaison for Research Requests.

Why: the Liaison flows up only (Request → institution, *WMKF_Update Org Primary Contact from Request*); nothing copies an institution's Primary Contact down to its existing Requests, so the Request copy goes stale when an institution changes its Liaison [VERIFIED: S548 workflow definitions, cast plan *Facts*; owner's check on 1003220].

Owner rules (S549):

1. **No Primary Contact on the institution → show no Liaison and send nothing to one.** No fallback to the Request copy. An email that has a PI still goes to the PI, with no Liaison Cc.
2. **Always the current Liaison**, including on old and closed Requests (historical liaisons have often left the role or the institution). Queued or saved recipients are re-resolved at send time.
3. **Research only.** Research = `akoya_programid` in `RESEARCH_PROGRAM_IDS` [VERIFIED via `shared/config/researchPrograms.js:6-9`: Science and Engineering Research, Medical Research]. SoCal (and any other or unknown program) keeps today's behavior unchanged.
4. `akoya_request.wmkf_liaison` (a separate, unread "Liaison" lookup) is ignored.

## The rule, precisely

One helper decides the Liaison contact id for a Request row carrying `_akoya_programid_value`, `_akoya_applicantid_value` and `_akoya_primarycontactid_value`:

| Request | Liaison contact id |
|---|---|
| Research program, applicant set | the account's `_primarycontactid_value`, or **none** if blank |
| Research program, applicant blank | **none** |
| Any other program, or program blank | today's behavior for that reader, unchanged |

Failure semantics (invariant): an **account read error is not "no Liaison"**. It fails the operation the same way that reader treats a Dataverse read failure today (503 for interactive routes, retryable skip for crons). Only a successful read that returns a blank Primary Contact means "none". Otherwise a transient error would silently drop the Liaison from a real email. Note that `recipients-service.js` today degrades a *contact* read error to an id with null PII (:26-28, per the trace); the account read added in front of it must not inherit that degradation.

Proposed home: `lib/services/contacts/request-liaison.js` [PLANNED; name open], exporting `resolveRequestLiaisonContactId(requestRow, deps)` and a batched `resolveRequestLiaisonContactIds(requestRows, deps)` for list reads. It uses the existing account adapter [VERIFIED via `lib/dataverse/adapters/account.js:21,31,40`: `getById`, `queryAccounts`, `queryAllAccounts`; raw select strings, no select helpers]. It returns only an id (or null) plus a `source` tag (`institution` / `request_copy`); each reader keeps its own contact resolution and output shape.

## Readers and changes

Line evidence below comes from a read-only trace of the worktree at `272fa669b` (S549) unless marked otherwise; Codex should re-verify it.

### 1. Awardee invitation recipients — `lib/services/workbench/grantee-deliverables/recipients-service.js`

- Today: select `_akoya_primarycontactid_value` (:45), `resolveContact` (:57) → `{contactId,name,email,hasEmail}`; route `pages/api/workbench/grantee-deliverables/recipients.js` [VERIFIED: `reviewers` app access, GUID check, `withDalContext`, `ServiceHttpError` mapping, else 500]; `AwardeeTab.js:274` prefills the editable Cc [VERIFIED via `shared/components/workbench/AwardeeTab.js:273-274,1219`].
- Change: add `_akoya_programid_value`, `_akoya_applicantid_value` to the select; get the id from the helper. No-liaison already works (empty Cc is valid, `send-invite.js:39`).
- Send path: `send-invite.js:34-60` sends the Cc the staff member submitted (prefilled, editable). **Kept as is**: the staff member sees the current Liaison at compose time and may edit it; re-resolving server-side would override a deliberate edit. [Owner to confirm in review.]
- Header doc :9 updated.

### 2. Grantee reminder cron — `lib/services/cron/grantee-deliverable-reminders-service.js` and the send path `lib/services/scheduled-email-service.js`

- Today: `REQUEST_SELECT` (:72), `readContact` (:84-90, :270), Cc = `liaison.emailaddress1` (:276); **row skipped when there is no Liaison email** (:277-280); `recipientContactIds` includes the Liaison (:295) for the VIP check (`approval_required`); Cc is **persisted** in `scheduled_email_messages.cc_recipients` (:328) and sent from the stored row [VERIFIED via `lib/services/scheduled-email-service.js:345` `cc: parseRecipients(message.cc_recipients)`]; an existing row is kept by `createOrGetScheduledEmail` (:342-363).
- Change at creation: Liaison id from the helper; **no Liaison → create the reminder to the PI with no Cc** (the PI name/email requirement stays).
- Change at send (rule 2): in `deliverScheduledEmail`, beside `sourceStillEligible` [VERIFIED via `scheduled-email-service.js:140-154,309-313`: a 404 stops the row; any other read error propagates so the send stays retryable], re-resolve the Request's current Liaison for a Research Request and update the stored Cc before building the activity. **VIP interaction (must not fail open):** if the re-resolved Liaison differs from the one the row was approved or scheduled with and the new contact is VIP-flagged, the send must not proceed silently; it returns the row to approval, following whatever the cron does at creation for a VIP recipient. A read failure keeps the send retryable (same posture as `sourceStillEligible`). This needs the row to record the Liaison contact id it was built with [ASSUMED: the stored shape of recipient contact ids is unverified].
- Recovery (`resolveEmailActivity`, `recoverByCorrelation`, `scheduled-email-service.js:108-138,315-317`): a row with an existing email activity is never re-addressed.
- Test Requests are stopped before the claim under isolation [VERIFIED via `scheduled-email-service.js:284-306`]; unchanged.
- Program scope: deliverables come from the research-filtered Awardees flow (`awardees-service.js:60-62`), but the cron has no program clause (:120-122), so the helper's program check applies here too.

### 3. Awardees panel — `lib/services/workbench/grantee-deliverables/awardees-service.js`

- Today: one list query (:32-36) over research awardees [VERIFIED via header :10-11 and `shared/config/granteeResearchPrograms.js:19`, which re-exports `RESEARCH_PROGRAM_IDS`]; Liaison name from the formatted value of `_akoya_primarycontactid_value` (:166); `AwardeesPanel.js:203` shows it or "—" [VERIFIED via `shared/components/workbench/AwardeesPanel.js:203`].
- Change: select `_akoya_applicantid_value`; one batched account query for the distinct applicant ids (chunked OR-chain; existing pattern `reviewer-finder/my-candidates-service.js:428-444`), taking `_primarycontactid_value` and its formatted name. No per-row contact reads. `$expand` is not used (nav-property name and restriction handling unverified).
- A failed account batch fails the panel request (no silent blank column).

### 4. Site-visit materials — `lib/services/site-visit-materials/collection-service.js`

- Today: one `REQUEST_SELECT` [VERIFIED via :58] feeds **two independent reads that can disagree**: `resolveRecipients` via `resolveSiteVisitApplicantContacts` (:89, has the account fallback) and `resolveMaterialNames` reading the Request copy directly [VERIFIED via :126] for `liaisonFullName` / `liaisonEmail`. **Liaison required**: 409 "Both recipients are required" (:257-265); `{{liaisonFullName}}` missing → 409 (:373-380). Recipients **persisted** as a `contacts` JSONB snapshot (migration 042) at create (:478-512), refreshed by manual invite/remind via `currentContacts` + compare-and-swap (store :81-107); `prepare/sendReminderEmail` send from `row.contacts` (:693-730).
- Change: both reads use the one helper, so recipients and template names always agree. No Liaison → the email goes to the PI with no Cc (the 409 becomes PI-required only). A template that uses `{{liaisonFullName}}` still refuses when there is no Liaison (the name cannot be filled); the message names the missing Institution Primary Contact so staff can fix it in AkoyaGO.
- Program: Research uses the helper's institution rule; SoCal keeps today's reads (applicant-contacts fallback + direct Request copy). Site-visit paths have no program filter today, so SoCal Requests reach them.

### 5. Materials reminder sweep — `lib/services/site-visit-materials/reminder-sweep.js`

- Today: sends from the persisted `row.contacts`, never refreshed (header :16-18); skips a row without a Liaison (:116); select [VERIFIED via :49].
- Change (rule 2): before each send, refresh contacts through the same `currentContacts` + compare-and-swap path the manual remind uses; no Liaison → send to the PI only. A read failure skips the row retryably.

### 6. Site-visit applicant contacts — `lib/services/site-visit/applicant-contacts.js`

- Today [VERIFIED via :14-38]: Request copy first; the account Primary Contact only when the copy is blank (:26); account read failure → 503 (:40-50, per the trace); consumers collection-service (:89) and logistics attendee suggestions (`logistics-service.js:67,379` → `SiteVisitEditor.js:128-152`).
- Change: Research → institution only (no Request copy); other programs unchanged. The attendee prefill therefore suggests the current institution Liaison for Research; what staff already saved on a visit is not rewritten.

### Not Liaison reads (unchanged)

`lib/bill/honorarium-onboard-orchestrator.js:163` [VERIFIED: writes `akoya_primarycontactid@odata.bind` on the honorarium Request, the payee], `lib/services/reviewer-finder/remove-candidate-service.js:175` [VERIFIED: counts those honorarium Requests for a deletion disclosure], `lib/services/dataverse-export/*` (labels), `lib/services/test-requests/*` (the Factory sets the Request copy so AkoyaGO copies it up), `scripts/probe-*`.

Dynamics Explorer's prompt tells the model "liaison" means the Request field (`shared/config/prompts/dynamics-explorer.js:73,539,623`). Not a send path; wording updated to name the institution's Primary Contact for Research, as a separate small change in the same branch. [Owner may defer.]

## Invariants

| Invariant | Verification |
|---|---|
| Research Request Liaison = institution Primary Contact; Request copy never used for Research | unit tests per reader with **both** a Request copy and a different institution contact present; assert the institution one wins |
| Blank institution Primary Contact → no Liaison shown, no Cc, PI email still sent | tests where the Request copy is set but the institution's is blank (proves no fallback) |
| Account read failure ≠ no Liaison | tests: account read throws → 503 / retryable skip, never a PI-only send |
| Non-Research and blank-program Requests unchanged | existing tests stay green; one test per reader with a SoCal program id |
| Queued reminders and saved materials contacts re-resolved at send | tests: stored Cc X, current Liaison Y → sent to Y; current none → no Cc |
| A changed Liaison that is VIP-flagged does not send unreviewed | test with a VIP flag on the new contact |
| Recipients and `{{liaisonFullName}}` agree (one source) | collection-service test with divergent Request/institution contacts |
| No new routes, tables or migrations | `check:api-routes`, `check:atlas`, `check:migrations-manifest` green |

## Docs to reconcile in the build

Source headers (`recipients-service.js:9`, `applicant-contacts.js:2-4`, the reminder and sweep headers); `docs/API_ROUTE_SECURITY_MATRIX.md:156,336`; `docs/atlas/dataverse-wmkf-sitevisit.md:66`; `docs/atlas/postgres-infra-tables.md:673`; `docs/SERVICE_AND_UTILITY_CATALOG.md:83`; `docs/GRANTEE_PORTAL_SPEC.md:84`; `docs/GRANTEE_PORTAL_BUILD_PLAN.md:42,268`; `docs/APPLICANT_ADDITIONAL_MATERIALS_PLAN.md:507,771`; `docs/PC_MEETING_TRACKER_PLAN.md:151`; `docs/GRANTEE_DELIVERABLE_PACKAGE_MIGRATION_PLAN.md:109,192`; `docs/DYNAMICS_SCHEMA_ANNOTATION.md:106`; `.claude-memory/project-institution-foundation-liaison.md`; the cast plan *Facts* (on `claude/factory-cast`). Reconcile with `/sweep`; historical plans are classified, not rewritten.

## Open questions for review

1. Is the invitation Cc (reader 1) right to stay staff-editable and unre-resolved at send?
2. What does the reminder row store about the recipients it was approved with, and is "return to approval on a changed VIP Liaison" implementable without a schema change? If it needs a column, that is a migration and moves this to a larger change.
3. Blank institution Primary Contacts among active Research awardees are unmeasured [ASSUMED]. If they are common, rule 1 drops Liaison Ccs broadly at once; an owner-run read-only probe before the build would show it. (Dynamics Explorer's prompt text carries a population figure for account Primary Contact, but it is prompt text, not a probe.)
4. Duplicate contact rows (one person, two contacts) may change the address used for the same person. Accepted for Research [owner, S549: SoCal differs, out of scope]; noted, not measured.

## Release

Runtime change to email recipients: Tier 2 per `docs/CAMPAIGN_RELEASE_AND_DATAVERSE_TEST_STRATEGY.md`, built on this branch, promoted deliberately after review.
