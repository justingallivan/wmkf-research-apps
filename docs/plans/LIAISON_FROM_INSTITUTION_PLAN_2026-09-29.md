# Research Liaison read from the applicant institution

Status: **DRAFT, revision 3 (2026-09-29, Session 549). Codex plan review round 1: needs-attention (five high, two medium); round 2 on revision 2: needs-attention (four high, two medium). Revision 3 answers both (*Review findings and responses*), records the owner's answers to the open questions, and splits the work into two phases, both to be built. A third review is required before any build. Nothing built.** Branch `claude/liaison-from-institution`.

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
9. **Both phases are built:** Phase 1 stops a queued reminder whose Liaison changed; Phase 2 re-addresses it automatically, preserving the PD's edits.

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

## Phase 1 — readers switch; a queued reminder whose Liaison changed is stopped and shown

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
  - The Awardee tab shows a recipients load failure with Retry and disables Send until recipients load.

### 2. Grantee reminders (Phase 1)

- Today:
  - The daily cron (`0 8 * * *`, `vercel.json`) runs three passes in order [VERIFIED via `lib/services/cron/grantee-deliverable-reminders-service.js:173-209`]:
    1. It processes each Invited deliverable: resolve recipients, then `createOrGetScheduledEmail`.
    2. It sends the digests.
    3. It delivers due messages through `deliverScheduledEmail`.
  - A row is created with `ccRecipients: [liaison email]` and `recipientContactIds: [pi, liaison]`, and `approval_required` is computed once from the PD's review-all override and VIP flags [VERIFIED via `:268-330`]. A missing Liaison email skips the row (`:277-280`).
- Change at creation: the Liaison comes from the helper. `none` → the row is created To the PI with no Cc. A failure → the row is skipped as retryable, never created PI-only.
- **Change before any Dynamics activity (the Phase 1 stop):**
  - `deliverScheduledEmail` re-resolves the Liaison for a Research Request before `resolveEmailActivity` can create or recover an activity (`lib/services/scheduled-email-service.js:116-138,315-358`). It compares the current Liaison email with the stored `cc_recipients`.
  - On drift, and only for a row with `dynamics_email_id IS NULL` and `send_requested_at IS NULL`, nothing is created or sent. The row is stopped with `last_error_code = 'liaison_changed'` through the store's existing source-cancel path, the same one used when the source is no longer eligible (`:309-313`).
  - A read failure throws, and the send stays retryable, as `sourceStillEligible` does for non-404 errors (`:140-154`).
  - Rows already past activity creation or send intent are out of the Phase 1 check and keep today's retry behavior (see *send intent* under Phase 2).
- **Visibility (answers round 2 finding 5):**
  - Today the digest lists only `scheduled`/`failed` and unsurfaced `sent` rows [VERIFIED via `lib/services/scheduled-email-store.js:305-313`]. `groupDigestRowsByPd` has approval, upcoming and sent sections only [VERIFIED via `scheduled-email-service.js:415-437`]. The UI projection drops `last_error_code` (per round 2).
  - Change: the digest query also returns stopped rows with `last_error_code = 'liaison_changed'` that are not yet surfaced (a `digest_fyi_at`-style receipt), in a new **Needs attention** section. The scheduled-email page renders the error. The remedy is written in the section: the reminder was not sent because the Liaison changed, and the PD can send the invitation again from the Awardee tab.
- Cost of Phase 1: one reminder is not sent after a Liaison change. Phase 2 removes the stop.

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
  - `none` → the email goes to the PI only. The recipients 409 becomes PI-required.
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
  - Change: that role is relabelled "Request Primary Contact (copy)". A second query finds the accounts whose `_primarycontactid_value` is the contact, then the Research Requests whose applicant is one of them. Those rows get the role "Liaison (institution)", merged into the same list by Request.
  - The prompt names the institution's Primary Contact as the Liaison of record. Prompt edits run `check:prompt-injection-tagging` and its self-test.

### Not Liaison reads (unchanged)

`lib/bill/honorarium-onboard-orchestrator.js:163` [VERIFIED: writes the field on the honorarium Request, the payee]; `lib/services/reviewer-finder/remove-candidate-service.js:175` [VERIFIED: counts those honorarium Requests]; `lib/services/test-requests/*` (the Factory sets the Request copy so AkoyaGO copies it up); `scripts/probe-*`.

## Phase 2 — queued reminders are re-addressed

Phase 2 replaces the Phase 1 stop for rows with no Dynamics activity and no send intent. It also makes activity recovery generation-safe.

- **Recipient generation (answers round 2 finding 1).**
  - New column `scheduled_email_messages.recipient_generation integer NOT NULL DEFAULT 0`, through a new migration (the next free number at build time), the fresh-install mirror in `scripts/setup-database.js`, the manifest, and the Atlas page `docs/atlas/postgres-infra-tables.md`.
  - The recipient correlation key becomes generation-specific: `correlationKey('recipient', message.id)` [VERIFIED via `scheduled-email-service.js:76-78`] becomes `wmkf-scheduled-recipient:<id>` for generation 0, keeping existing activities recoverable, and `wmkf-scheduled-recipient:<id>:g<n>` for later generations.
  - Recovery (`recoverByCorrelation`, `:108-114`) looks up only the current generation's key. A draft left under an older generation's key is never adopted or sent.
  - An orphaned older-generation draft stays an unsent draft in Dynamics. It is listed by the rebuild for cleanup, and it is never sent by the app.
- **Recipient-only rebuild (answers round 2 finding 3).**
  - A new store operation, `readdressScheduledEmail`, runs when the PD is unchanged and the cron's resolved recipients differ from the stored `to_recipients`, `cc_recipients` or `recipient_contact_ids`. It is separate from the PD-handoff `reassignScheduledEmail`, which keeps its current destructive rebuild [VERIFIED via `scheduled-email-store.js:344-377`].
  - It updates only the recipients, `recipient_name`, `recipient_contact_ids` and `approval_required` (recomputed from the new recipients), clears `reviewed_at` and `approved_at`, and increments `version` and `recipient_generation`.
  - It **keeps** `subject`, `body_text`, `signature_text` and `edited_at`, so PD edits survive.
  - WHERE: `id` and the **expected `version`** the cron read, `status IN ('scheduled','failed')`, `dynamics_email_id IS NULL`, `send_requested_at IS NULL`, no live lease. A concurrent edit, approval, send-now or claim makes it a no-op, and the next cron pass retries.
  - A newly substituted VIP Liaison therefore requires review, and an earlier approval does not carry over. Send-now already passes `expectedVersion` and returns 409 when the claim is lost [VERIFIED via `pages/api/scheduled-emails/[id].js:82-91`], so a PD acting on a stale preview cannot send it.
- **Send intent is a point of no return (answers round 2 finding 2).**
  - Today, an unaccepted activity with `send_requested_at` already set is re-sent on the ordinary path [VERIFIED via `scheduled-email-service.js:361-377`]; only the test-Request path refuses a resend (`:243-275`, per round 2).
  - Change, for Research reminders: once `send_requested_at` is set, delivery never reissues SendEmail for that activity. It reconciles: it reads the activity and records `sent` if accepted. Otherwise it marks the row `send_unconfirmed` for staff, shown in the Needs attention section.
  - The Liaison drift check does not apply past send intent. The Liaison was current when the intent was recorded.
- **Draft activity, no send intent.** A row with `dynamics_email_id` set but `send_requested_at` null cannot be re-addressed; the rebuild WHERE excludes it. The pre-send drift check runs on it. On drift the row is stopped as in Phase 1 (`liaison_changed_after_draft`) and shown in Needs attention, never sent to the old parties.

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

Per reader, Phase 1:
- **Invitation:**
  - The Liaison contact changed after compose → 409, transport not invoked.
  - **The same contact's email changed after compose → 409, transport not invoked.**
  - A resolution failure → 503, not invoked.
  - The client saw none, and the current Liaison is set → 409.
  - The recipients load fails → Send disabled.
- **Reminder cron:**
  - The account returns a Liaison id but the contact read throws → row skipped, not created PI-only.
  - `none` → PI-only row.
  - Drift before any activity → stopped, no activity created, no transport. The row appears in the digest's Needs attention section, and the page shows the error.
- **Awardees:** a batch missing an account → request fails. A divergent Request copy never shown for Research.
- **Collection:** recipients and `{{liaisonFullName}}` from one source with divergent fixtures. `none` → PI-only send. A `{{liaisonFullName}}` template with `none` → refused.
- **Sweep:**
  - A concurrent manual contacts update between prepare and claim → claim lost, nothing sent.
  - Refreshed contacts persisted with the claim.
  - `none` → PI only.
- **Applicant contacts:** SoCal keeps its account fallback. Research never uses the Request copy.
- **Export and Explorer:** divergent Request and account fixtures. The Explorer Liaison relationship returns the current institution contact's Research Requests and labels the former Request-copy match as the copy. The export shows the relabelled caption.

Phase 2:
- **Re-address:** stored X, current Y, unsent → re-addressed to Y. Edited body kept. Approval reset. `recipient_generation` incremented.
- **VIP:** a new VIP Liaison → `approval_required`.
- **Stale version:** a concurrent edit or approval between read and update → no-op.
- **Crash between activity create and persist, then Liaison drift:** the old-generation draft is not adopted or sent, and the new generation's activity goes to Y.
- **Send intent:** `send_requested_at` set with an unaccepted activity → no second SendEmail; `send_unconfirmed` shown.
- **Draft activity, no intent, drift:** stopped, not sent.

Every failure test asserts the transport or email-activity mock was not called, and every success test asserts the exact To and Cc sent. Each guard is mutation-checked, so the test fails when the guard is removed.

## Invariants

| Invariant | Where |
|---|---|
| Research Liaison = institution Primary Contact; Request copy never used for Research | helper; every reader |
| `none` only from a successful read; account, batch-cardinality and contact read failures fail closed | helper; readers 1–5 |
| No send to a Liaison other than the current one at the moment of send intent | readers 1, 2, 5; Phase 2 |
| A changed Liaison re-runs the PD review posture; PD edits survive a re-address | Phase 2 |
| A draft addressed to an older generation is never adopted or sent | Phase 2 correlation key |
| Non-Research and blank-program Requests unchanged | helper `request_copy` path |
| Phase 1: no new routes, tables or migrations; Phase 2: one migration | `check:api-routes`, `check:atlas`, `check:migrations-manifest` |

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

## Docs to reconcile in the build

Source headers (`recipients-service.js:9`, `applicant-contacts.js:2-4`, the reminder, sweep and scheduled-email headers); `docs/API_ROUTE_SECURITY_MATRIX.md:156,336`; `docs/atlas/dataverse-wmkf-sitevisit.md:66`; `docs/atlas/postgres-infra-tables.md:673` and the scheduled-email table entry (Phase 2 column); `docs/SERVICE_AND_UTILITY_CATALOG.md:83`; `docs/GRANTEE_PORTAL_SPEC.md:84`; `docs/GRANTEE_PORTAL_BUILD_PLAN.md:42,268`; `docs/APPLICANT_ADDITIONAL_MATERIALS_PLAN.md:507,771`; `docs/PC_MEETING_TRACKER_PLAN.md:151`; `docs/GRANTEE_DELIVERABLE_PACKAGE_MIGRATION_PLAN.md:109,192`; `docs/DYNAMICS_SCHEMA_ANNOTATION.md:106`; `.claude-memory/project-institution-foundation-liaison.md`; the cast plan *Facts*. Reconcile with `/sweep`; historical plans are classified, not rewritten.

## Release

Runtime change to email recipients: Tier 2 per `docs/CAMPAIGN_RELEASE_AND_DATAVERSE_TEST_STRATEGY.md`. Phase 1 and Phase 2 are built on this branch and may be promoted separately; Phase 2 applies its migration before its code deploys.
