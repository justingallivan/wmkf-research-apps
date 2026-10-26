---
title: Personal defaults for scheduled grantee reminders
domain: workbench
kind: plan
status: active
summary: "Slice 5 bounded proposal: exact-owner future reminder defaults, creation/handoff integration and independent editor; no runtime implementation or live writes. Owner chose hold-until-repaired for reassignment failures. Revised contract addresses N1–N7; independent rereview pending."
owner: product-engineering
related:
  - docs/plans/PERSONAL_EMAIL_DEFAULTS_INVENTORY_2026-09-24.md
  - docs/plans/PERSONAL_EMAIL_DEFAULTS_TODO_2026-09-20.md
  - docs/SCHEDULED_EMAIL_VIP_DIGEST_PLAN.md
  - docs/atlas/postgres-infra-tables.md
---

# Scheduled grantee reminder defaults — bounded plan

## 1. Status, ownership and scope

[PLANNED — NOT IMPLEMENTED.] Justin authorized flow review, a bounded plan and
independent Claude review before coding. Claude reviewed draft `0ba91394d` and
returned **READY WITH NAMED CHANGES**. Justin then chose **hold reassigned
reminders until repaired**, not shared-wording fallback. This revision incorporates
that choice and N1–N7; independent rereview is pending (§9). Codex owns this plan on
`codex/scheduled-grantee-defaults-plan` in the existing isolated worktree.
Baseline: `c7c3ce6e106ea0e9b6c390cfb49351af36377840` (main including the
reviewed distribution release and its documentation receipt). Claude's other
checkout, database work, migrations, environment and production state are excluded.
No live tenant reads/writes, cron invocation, preference mutation or email send
are part of this planning exercise. Live schema permissions and delivery are
UNKNOWN; Atlas observations are dated evidence, not fresh production probes.

The only workflow is `grantee_abstract_reminder`. A PD's reusable raw subject/body
will seed new scheduled reminders and eligible existing PD-handoff rebuilds.
Changing defaults alone must leave every existing message, edit, approval,
recipient, schedule, signature, version and transport receipt unchanged.
This does not add email types, scheduling controls, a review-posture matrix,
new notification mail, a global nav entry, or calendar/J27 functionality.
The owner-selected hold requires a bounded delivery guard and one attention reason
in existing ledger fields; it is the sole additional engine behavior in this slice.

## 2. Verified current flow

[VERIFIED via source inspection at baseline; not a live delivery claim.]

| Hop | Current enforcing source and behavior |
| --- | --- |
| Cron entry/auth | `pages/api/cron/grantee-deliverable-reminders.js`: GET/POST, `verifyCronSecret`, trusted `withDalContext`, calls `runGranteeDeliverableReminders` |
| Scan/configuration | `lib/services/cron/grantee-deliverable-reminders-service.js`: required shared `email.grantee_reminder.subject/body`; Invited deliverables with invite date, four workers, per-row failure summary |
| Identity/recipient/posture | Same `processRow`: test marker first; current request PD, active system user, PI and Liaison of record, review-all/VIP reads; missing/read-failed facts skip the row |
| Wording | Same draft construction uses shared subject literally; `buildGranteeReminderDraftBodyText` renders PI surname, title and day-14 deadline, removes template signature slots; signature is frozen separately |
| Persistence | `scheduled-email-store.js:createOrGetScheduledEmail`: one `(workflow_type, source_record_id)` row, INSERT ON CONFLICT DO NOTHING; repeat scans do not replace stored content |
| Handoff | `reassignScheduledEmail`: exact just-read version; different PD; scheduled/failed/sending; both transport fields null; no live lease. Atomic reset clears edits/approval, increments version/recipient generation, preserves scheduled time |
| Inbox/API | `pages/scheduled-emails.js` + `pages/api/scheduled-emails/{index,[id]}.js`: profile-authenticated, mapped system-user-owned list/actions; bounded literal row subject/body edits; PATCH version fence; no editable actor/recipients/signature/schedule |
| Preview/send | `scheduled-email-service.js:projectScheduledEmail/renderScheduledEmailPreview/deliverScheduledEmail`: stored wording plus stored signature; visibly placeholder preview URL; real URL minted only when creating recipient activity; row lease/approval/source/recipient guards, correlation/readback and no-resend intent fence |
| Other consumers | Digest, attention UI, reconciliation, finalization and retention consume the existing row state, not reusable wording; preserve their transport/receipt semantics; the proposed hold adds shared attention classification only |

[VERIFIED via adapter/identity source.] Preferences already live in Dataverse
`wmkf_appuserpreferences`. `user-preference.listByOwnerAndKey` enumerates complete
owner/key results and throws on capped results. The generic profile mapper has
legacy remaps; its lax preference reader also collapses failures to absence.
Neither is suitable as the new wording reader. Existing review-all preference
reads are a separate policy and are not redesigned here.

[VERIFIED via `docs/atlas/postgres-infra-tables.md` scheduled-email section.]
The existing Postgres ledger and migration history are documented; no new table,
column, constraint, migration or data backfill is proposed. No claim is made
that this planning session re-probed the live schema or historical send status.

## 3. Proposed reusable wording contract

[PLANNED.] Add one reserved, private key
`scheduled_grantee_reminder_template` holding exactly `{ subject, body }` as
unencrypted JSON under the authenticated PD's exact Dataverse system-user owner.
Save the whole pair; no partial field merging, inheritance sentinel or versioned
schema is needed. Clear removes this key only; it never clears another family.

Proposed family bounds follow the existing scheduled row editing bounds:
- Subject: trimmed non-empty single line, maximum 300 characters; literal only,
  with braces/token syntax rejected. The current scheduled subject has no renderer.
- Body: trimmed length 10–20,000; raw unresolved template, maximum 20,000 before
  and after rendering. Require `{{granteeName}}`, `{{proposalTitle}}` and
  `{{dueDate}}` (including `COB {{dueDate}}`) to preserve the reminder's named,
  award-specific, deadline-bearing intent. `{{signature}}` is optional and stripped
  by the existing draft renderer; the real saved signature is always appended once.
- Allow exactly `{{granteeName}}`, `{{proposalTitle}}`, `{{dueDate}}`,
  `{{signature}}` in the body. Reject unknown tokens and unmatched or extra brace
  delimiters, including triple braces. Subject rejects any brace. Explicitly reject
  `[Name]`, `[title]`, `COB [date]`, `[Program Director signature]` in personal
  templates: the reused renderer would otherwise replace these literals. Ordinary
  bracket prose remains literal. Preserve legacy alias support for shared copy;
  do not run the personal token validator against shared fallback.
- Preserve plain-text escaping, server-owned link/button, automation notice,
  separate PD signature, current day-14 deadline and PI surname behavior.
  Do not seed/rewrite Admin copy or import rendered row edits as raw defaults.

These are proposed acceptance criteria for this slice, not new owner decisions
about other email families. Empty bodies are not supported here. Existing
one-message edit rules remain unchanged; personal-default validation can require
context tokens without retroactively rejecting an existing edited row.

## 4. Dedicated own-defaults API and service

[PLANNED.] New `/api/scheduled-emails/email-preferences` GET/PUT/DELETE, using
`requireAuth` for the same staff self-service infrastructure category as the
scheduled inbox, not a new app grant. Explicitly return 403 for
`session.authBypassed` or applicant sessions after `requireAuth`, including in
production; neither can reach preference access. Then require a GUID session actor
and linked profile. Inside trusted DAL context, resolve the authenticated session
profile with the existing mapping (catch lookup exceptions as sanitized 503) and require
its system-user GUID to equal `actorRefFromSession(session)` case-insensitively.
Mismatch/unavailable identity returns sanitized 403/503 and no preference access.
This avoids editing another person's defaults through a legacy remap without
changing authorization of the existing inbox or any old route.

GET accepts no query/body. PUT accepts exactly `{template:{subject,body}}`;
DELETE accepts exactly `{}`; reject target identities, workflow/message IDs,
extra fields, arrays and malformed shapes. Parser 256kb; private no-store on all
responses; state-changing Origin protection remains in `requireAuth`.

A family service `lib/services/scheduled-grantee-reminder-personalization.js` owns:
- Complete strict own-key reads: configured, absent, duplicates, encrypted,
  invalid, identity_unavailable or unavailable; never use first row or `{}` fallback.
- Shared reads directly via `getSettingStrict`, never `readRequiredEmailDefaults`
  (which emits operational alerts). Return shared status independently. Shared
  prefill may fail the stricter personal validator; expose field errors, not an
  implicit Admin rewrite or a claim that the prefill was saved.
- GET DTO: exact `ownerSystemId`, own state/raw pair, shared state/raw pair,
  effective pair/source if available, `canSave`, `canClear`; no message DTO/token.
- Save: validate pair, enumerate, reject duplicates with 409, update one or create
  exact owner/key, then strict readback equal to normalized submitted pair.
- Clear: enumerate/delete exact listed owner/key rows including duplicates, then
  complete absence readback. Partial deletion or any uncertain result is not success.
- Mutation uncertainty: 503 `persistence_unconfirmed`; editor must Reload before
  another mutation. Confirmed mutation plus failed independent DTO refresh remains
  success with `refreshUnavailable`, separate from unconfirmed persistence.

Generic `/api/user-preferences` must block keyed/list disclosure and single/batch
writes/deletes for this key. Register the key in `reviewerFinderPreferences.js`.
Do not claim uniqueness, cross-tab serialization or atomic multi-row Clear:
concurrent creates can produce duplicates, detected on subsequent strict reads;
last successful writer can win. UI success confirms a readback at that time only.

## 5. Background integration, owner-selected hold and concurrency

[PLANNED; hold policy OWNER-DECIDED 2026-10-25.] A strict family reader accepts
only the server-resolved current PD GUID. No reverse profile lookup, caller ID or
identity remap in cron. Resolve after current PD and before render/create/handoff.
Cache normalized result promises, including failures, by lowercase GUID for the
run; store the promise before awaiting. A later run retries freshly.

Only confirmed absence uses the required shared Admin pair. Duplicate, encrypted,
invalid, unavailable or unknown own state pauses new creation/handoff for that PD.
No silent shared fallback. Invalid rendered personal content also skips before a
new draft write. Preserve the existing shared-config batch prerequisite. Do not
apply stricter personal token grammar to existing shared copy.

Keep the existing `preferenceFailed` count per affected row. Emit a distinct
`personal reminder default <status> for current PD` reason, separate from posture
failures. Group wording failures once per PD per run with bounded affected request
numbers (up to the existing scan size), without adding a new summary top-level
field. Existing logger emits the grouped summary. No new notification emails.
New-row failures do not abort digest, due-delivery, reconciliation or finalization.

Creation remains render → existing create-or-get → existing handoff. A failed
lookup leaves existing frozen content untouched. Same-owner rows continue to send
stored content even if their owner's default later becomes unreadable. A changed
request PD is different: the former PD's stored message MUST NOT be newly sent
while handoff is deferred. This is enforced at delivery, not just in the producer.

### 5.1 Delivery guard (automatic AND manual Send now)

Add a server-side current-request-PD read, using the existing grant-request DAL,
to `deliverScheduledEmail`. Never read personal wording at send time. Validate
both GUIDs and compare case-insensitively; missing/unreadable/invalid current PD
means unknown ownership, not permission to use the stored sender.

After the existing send lease and source-eligibility checks, but before token
minting, activity creation or sending, require the current PD to equal the row's
stored `pd_systemuser_id`. Recheck immediately before `recordSendRequested` after
all intervening awaits. This applies to cron and forced sends; `force` can bypass
approval/schedule as today, never current-PD ownership.

On mismatch/unknown ownership:
1. Permit only read-only stored-activity or exact current-generation correlation
   lookup, to detect transport already accepted. Do not readdress/create/mint/send.
2. If an existing activity is proven accepted, persist any recovered activity ID,
   record sent and finalize through the existing lease-fenced path. This records
   history; it does not authorize a new send. Failed/ambiguous lookup cannot prove
   acceptance and must hold. A recovered unaccepted activity ID must be persisted
   before releasing the lease so producer reassignment cannot treat it as pristine.
3. Otherwise, unless existing missing/forbidden activity classification applies
   (precedence below), record `scheduled_email_pd_handoff_held` using the existing
   lease-fenced failure operation: status failed, lease released, hold reason
   persisted; subject/body/signature/recipients/schedule/edits/approval/activity
   identity/generation remain untouched. On persistence failure, return no success;
   the last safe lease/receipt remains authoritative. Never call SendEmail.
4. Return a distinct `{held:true, reason:'pd_handoff_held', message}` result after
   confirmed hold persistence. The action route maps that to 409 with the held
   message, not sent feedback, an uncertain-send notice or a generic retry claim.
   Cron does not count a held attempt as sent. It may record the distinct reason
   in existing `failures`; no new counters or summary shape are required.

If send intent already exists, preserve the existing read-only reconciliation
lane and no-resend rule: reconcile acceptance, never reset/rebuild/re-send it.
The new ownership hold must not replace an unconfirmed marker or reopen transport.
A saved unaccepted activity without intent is also held on PD mismatch: the old
B5 policy of sending that activity as created applies only when ownership still
matches. It cannot be automatically rebuilt for the new PD; manual reconciliation
or stopping the old message is required. No new reset/delete/send-by-hand action
is added. Missing/forbidden activity classifications take precedence over the new hold:
retain their existing persisted codes, no-send action rules and read-only recovery
lanes instead of replacing them with `pd_handoff_held`. Any later ordinary send
restored by those lanes still passes both current-PD guards. Other ambiguous
activity reads during a mismatch are held without asserting acceptance; retain
activity ID and a bounded explanation. A failed read never permits transport.

A current-PD read cannot atomically lock a Dataverse request and Postgres row.
Reassignment after the final successful PD read and before the transport intent
is persisted remains a bounded cross-system race. State and test this limit;
never claim absolute atomicity. The guard closes persistent known-mismatch and
unknown-ownership sends and does not widen existing send uncertainty.

### 5.2 Hold visibility, recovery and action rules

Use the existing `last_error_code` column: add `PD_HANDOFF_HELD` to the store error
constant and `pd_handoff_held` to the shared attention reason/copy mapping. No new
status/column/migration. Project the reason through the existing DTO; put the row
in Needs attention in the digest and show **Held — PD reassignment needs repair**
in the inbox. Copy explains that no new send will occur while ownership differs
or cannot be checked. Do not promise that editing defaults alone repairs an
already-created old-PD activity.

For this reason only: edit/approve disabled, Stop available, and **Retry send**
may perform the existing explicit Send now action. It must pass the fresh ownership
guards again and remains held if mismatch/unknown. If the request has returned to
that stored PD, a deliberate retry can send the same frozen message, with the
existing force/approval semantics clearly disclosed in the confirmation. This is
an intentional exception to the shared helper's stop-only attention rule, not an
exception for unconfirmed/missing/forbidden activity reasons. Add exact route/UI
parity tests; preserve those other attention branches.

Normal due queries keep ownership-held rows eligible for another ownership check
under existing schedule/approval/lease rules; do not exclude them as if missing
activities. Unapproved rows remain unapproved; they need explicit retry or a
successful producer handoff. A successful eligible handoff resets the held error
using the existing version-fenced transition, including new PD wording/signature,
recipients/posture, cleared edits/approval and incremented generation. It does not
send immediately or bypass the new PD's review requirements. With a saved activity
or intent, no automatic handoff reset: preserve receipts and offer existing manual
recovery/Stop guidance. A defaults Save/Clear itself never clears a message hold.

### 5.3 Race and complement requirements

- Winning INSERT freezes its resolved pair; repeat scans/default Save never alter
  same-owner stored content. No cross-tab preference locking promise.
- Two runs compete through the existing unique source key, version, lease and
  transport predicates. Failed new-PD preference reads cannot cause former-PD
  delivery because both due and forced delivery perform the ownership check.
- Live lease/version drift/sent/stopped/activity/intent refuses producer rebuild.
  A losing hold persistence or receipt write is not reported successful.
- Preference repair → later cron rebuilds pristine eligible row under new PD;
  old-PD edits/approval are reset only by that existing atomic transition and
  original schedule is preserved. No sent/uncertain transport reset or cleanup.
- Add no preference generation to activity correlation, leases, signatures,
  digest receipts, review posture or retention. Only one additional attention
  reason describes the no-new-send hold.

## 6. UI boundary and stale work

[PLANNED.] Add a family-specific **Your default wording — grantee reminders**
editor above the scheduled message list, visible even with no messages. Use the
adopted disclosure, raw subject/message, source notice, Save as my default,
Clear my default and Reload defaults labels. Copy explicitly says: affects newly
scheduled reminders and eligible PD-reassignment rebuilds; existing messages and
their approvals are unchanged. Do not add Profile Settings or a global nav item.

Own this editor in a separate component, not in selected-row draft state. No
Save/Clear/Reload callback reloads the messages list, invokes PATCH, changes
selection, resets one-message edits, approves, prepares, mints a link or sends.
No "use this message as my default" or "apply to this message" action.
Selecting another message must not reset unsaved reusable wording or cause another
preference GET. Collapsing the disclosure retains edits. Explicit Reload and Clear
warn before discarding dirty raw default edits; cancellation preserves them.
Clear confirmation never implies a message action. Page departure/Back/reload
warn when editor edits or pending/unconfirmed mutation results would be lost.
Same-pathname shallow query changes on `/scheduled-emails` are explicitly exempt:
message selection must update the URL without a prompt or discarded defaults.
Handle cancelled true departures without an unhandled router promise.
Use a small scoped guard with the existing proven Pages-router behavior; do not
extract/refactor the distribution component or its recovery contract in this slice.

Independent preference request generations plus mounted/actor-scope checks guard
success, error and finally after every await. Stable scope uses authenticated
session actor/profile, not selected message ID/version or a transient profile
loading phase. Disable (optionally visually hide without unmounting) during
transient identity loading; retain mounted edits for the same confirmed actor.
Clear/remount only on a real actor change; ignore old reads/writes.
Late load never overwrites typing. Busy blocks duplicate preference actions;
unknown mutation latches until strict Reload. Navigation during a pending mutation
warns it may already have persisted; do not claim cancellation rolls it back.
The editor can be independently disabled during a row action without rebasing it.
Any necessary page-boundary wiring stays limited to protecting this new editor;
existing row-selection/discard behavior is not silently redesigned.

For broken own defaults, explain that new reminders/reassignment rebuilds are
paused until repaired. When exact identity and enumeration permit it, allow
Clear (including duplicates) or corrected Save; Save still refuses duplicates.
Unavailable enumeration needs Retry and never claims Clear succeeded. Show
field-specific validation errors. Shared prefill is not guaranteed save-valid.
Explain that already-frozen same-owner messages continue; reassigned messages
are held by the independent delivery guard, and saved old-PD activities need
manual resolution. No live mutation occurs on editor open.

## 7. Planned tests and verification

[PLANNED; not run as implementation tests during planning.]
1. Validator/renderer: exact pair, types/extras, 300/20k/minimum bounds, newline,
   supported required body tokens, malformed/unknown tokens, literal subject,
   optional signature stripped and one server signature, current surname/deadline,
   escaped HTML and generated link/notice retained; rendered expansion overflow.
2. Family service: exact GUID (mixed case), absence/shared/configured, duplicates,
   capped enumeration, encrypted/malformed, shared failure independent of valid own,
   exact Save readback, failed create/update/readback, partial Clear and confirmed
   absence, other-owner/key exclusion with actual foreign rows present.
3. Route: unauthenticated/applicant/bypass/inactive, missing/invalid actor,
   profile-map mismatch, explicit production bypass/applicant refusal and
   PUT/DELETE Origin rejection; no caller identity, methods/query/body/size, private
   no-store, mutation confirmation vs refresh failure; no ledger/transport calls.
   Generic keyed/list GET and single/batch POST/DELETE cannot bypass new key.
4. Cron: absent vs configured current-PD defaults at INSERT and eligible handoff;
   failure before any new draft write; same-owner stored row unchanged after
   defaults change; four simultaneous same-PD workers reach a deliberately blocked
   snapshot and share one read (assert before releasing; never wait for four reader
   calls); failure snapshot shared too;
   different PDs isolated; later run refreshes; personal failures do not abort
   existing due sends/digests/reconciliation/finalization; retain shared-config gate.
5. Store/transport regressions: competing INSERTs, version/lease/transport/sent/stopped
   handoff fences, preserved schedule, reset edits/approval only on eligible handoff,
   exact frozen row used by preview and recipient activity. Treat no send-time
   defaults lookup as a structural contract, not an absent-dependency spy.
   Reuse existing isolated Postgres integration harness; never the shared live DB.
6. UI: empty inbox availability, raw source/error states, explicit future-only actions;
   message selection/concurrent row completion leaves default edits intact; defaults
   responses leave current row edits/selection/version/approval intact; late read,
   unmount, transient loading vs real actor switch, busy/uncertain latch and Reload;
   cancelling discard/navigation retains edits, confirmed discard only affects editor.
   Real-router fixture browser coverage for navigation/Back and pending result warning,
   plus dirty-default message selection with no prompt, retained edits and changed URL.
7. Ownership hold: actually due old-PD row with broken new-PD preference never sends,
   mints or creates; cover missing/read-failed/invalid PD and mixed-case equality,
   cron and forced send; PD changes during recipient/activity awaits; recheck before
   intent; accepted activity readback vs unaccepted/missing/forbidden/correlation
   failure; preserve already-requested no-resend reconciliation. Successful repair
   rebuilds pristine row with new wording and approval reset, preserves schedule;
   activity/intent prevents automatic reset. Lost lease or failed hold persistence
   returns no success. Hold reason appears in projection/digest/page/routes; only
   deliberate guarded Retry send or Stop is allowed, never uncertain-transport retry.
   Approval-required held row is not silently approved by a cron recheck; version,
   concurrency and existing missing/forbidden/unconfirmed complements remain covered.

Implementation verification: scoped Jest suites (`grantee-deliverable-reminders-cron`,
`scheduled-email-routes`, `scheduled-emails-page`, scheduled service/current-recipient,
renderer, reserved-key and new family suites), isolated engine SQL regressions,
fixture browser cases, types/lint/build. Relevant gates with sequential self-tests:
API routes, Atlas, facts, docs currency/symbol/build claims, DAL/context/service/auth
boundaries, GUID, enums, secrets; update route inventory counts only when built.
Run the React checklist if multiple components change. No live mutation/send testing
or release is authorized by acceptance of this planning task.

## 8. Contract-reconcile review ledger

[PLANNED contract; current prerequisites verified in §2.]
- Whole flow: editor → dedicated strict API → exact-key preferences → cron raw
  reader → render → existing frozen ledger → existing preview/send covered above.
- Partial success: whole-pair Save; readback-confirmed Clear; per-row cron failures
  keep request-number identifiers and never imply all rows succeeded.
- Async: separate actor-scoped editor lane and per-run promise cache; existing
  ledger versions/leases remain the persistence authority.
- Helper semantics: new family helper only; no generic preference reader changes,
  renderer extraction, identity-map rewrite or distribution recovery reuse.
- Durable surfaces: existing schema only; planned route matrix, key/privacy guards,
  source service header/catalog, preference/ledger Atlas and canonical counts on build.
- Doc reconciliation: this plan is the slice 5 proposal; historical September
  inventory tables remain historical. Implementation/release claims wait for proof.
- Symbol fan-out: new preference key must have dedicated reader/writer, cron consumer,
  UI source states, generic privacy/reserved guards and tests. Existing ledger fields,
  workflow enum and ledger statuses get no new values. The new persisted
  `scheduled_email_pd_handoff_held` error is a new attention reason: trace raw and
  projected names through the store constant, shared maps/actions, page label,
  digest classification, action route and due-send/reconciliation selectors.
  Unknown error codes must not bypass the independent fresh ownership guard.

## 9. Review history, owner decision and next boundary

[VERIFIED via ordinary OAuth Claude review of `0ba91394dd4f3b421e1c2603fb164515d769943a`.]
Initial verdict: **READY WITH NAMED CHANGES**. Verbatim historical report:
`docs/audits/SCHEDULED_GRANTEE_DEFAULTS_PLAN_CLAUDE_REVIEW_2026-10-25.md`.

[OWNER-DECIDED via explicit reply 2026-10-25.] Justin chose **hold the reassigned
reminder until repaired**, including an explicit send hold in the revised plan.
No shared fallback or acceptance of former-PD sending was selected.

| Initial finding | Revision disposition |
| --- | --- |
| N1 persistent handoff failure | §5 now requires independent current-PD delivery guards for cron/forced sends, persisted hold, accepted-activity reconciliation, no intent reset, truthful UI and repair boundaries |
| N1/N7 diagnostics | §5 groups request-number failures per PD with distinct wording reason and unchanged counter shape; §6 distinguishes own-default repair from activity recovery |
| N2 renderer aliases/grammar | §3 rejects the four substituted bracket strings, defines mustache grammar and bounds; shared legacy rendering remains unchanged |
| N3 navigation/loading | §6 exempts shallow message query changes and retains mounted same-actor edits; §7 requires real-router selection/URL/no-prompt proof |
| N4 auth | §4 explicitly refuses bypass/applicant before actor/profile/mapping checks, handles DAL-scoped mapping throws as 503; route tests include Origin and production bypass |
| N5 prefill | §4/6 says shared prefill need not pass personal validation and requires field errors without Admin writes |
| N6 tests | §7 includes blocked-promise concurrency, actual foreign Clear fixtures, frozen-content assertions and the due old-PD complement matrix |

These are plan changes only. They require independent rereview, especially the
new delivery/hold semantics and the bounded cross-system race, before a claim of
readiness. No application code, migrations or database/environment state changed.

### Verification for planning

[VERIFIED via local mocked baseline tests at the initial draft.] Six current
suites / 127 tests passed: cron reminders, scheduled routes/page/service/current
recipients and grantee renderer. No proposed feature tests have been written.
No Postgres integration or live data probe was run. Documentation gates and paired
self-tests passed for the initial draft and review receipt; this revision must
pass those gates after rereview is recorded.

Next: independent read-only OAuth Claude review of this exact revised plan,
record findings verbatim, and present readiness and any remaining issues to Justin.
Do not implement or release in this task. Keep Claude's other checkout and database
work untouched.
