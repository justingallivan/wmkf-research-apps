---
title: Personal defaults for scheduled grantee reminders
domain: workbench
kind: plan
status: active
summary: "Slice 5 bounded proposal: exact-owner future reminder defaults, creation/handoff integration and independent editor; no runtime implementation or live writes. Independent Claude review pending."
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
independent Claude review before coding. Codex owns this plan on
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
| Other consumers | Digest, attention UI, reconciliation, finalization and retention consume the existing row state, not reusable wording; keep those paths unchanged |

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
- Reject unsupported/malformed mustache syntax. New personal templates use
  mustache; retain legacy bracket aliases in the existing shared renderer.
  Do not reinterpret ordinary bracket prose in personal wording as a new token.
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
scheduled inbox, not a new app grant. Fail closed for applicant, bypassed,
missing-profile or invalid session actor identities. Inside trusted DAL context,
resolve the authenticated session profile with the existing mapping and require
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
- Shared reads via strict settings (without emitting operational notifications
  merely because someone opens the editor). Return shared status independently.
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

## 5. Background integration, failures and concurrency

[PLANNED.] Add a strict family reader accepting the server-resolved current PD
system-user GUID directly. No reverse profile lookup, session actor, caller ID,
admin impersonation or remap in cron. It uses the same exact key and validator as
the editor; lookup is after current PD resolution and before rendering/persistence.
Use a per-run Map of in-flight promises keyed by lowercase GUID so concurrent
workers share one snapshot (including failures); a later cron run retries freshly.

Only confirmed absence uses the already-required shared Admin pair. Duplicate,
encrypted, malformed, unavailable or unknown personal state skips creation/handoff
for that row, increments `preferenceFailed`, and adds a bounded request-number
failure reason. Never quietly send shared wording after an unreadable personal
copy. Configured invalid rendering also skips before a ledger write. Shared
configuration remains an existing batch prerequisite, even when personal wording
exists; do not widen this slice into redesigning that historical behavior.

Keep the smallest producer change: resolve/render the proposed draft then pass it
to the existing create-or-get and handoff operations. No ledger query/helper/schema
change is needed. An existing same-owner row may still incur a defaults read while
scanning; a failed read skips this producer attempt but does not mutate that row.
The batch must still run its independent due-delivery, digest, reconciliation and
finalization passes for existing rows. Existing delivery reads frozen content and
must not consult personal defaults again. An invalid new default must not block
or rewrite an already-created scheduled message.

The store remains authoritative for races:
- Repeat scan / default change / Save racing cron: the winning INSERT freezes its
  resolved pair; later ON CONFLICT leaves it unchanged. A concurrent preference
  change applies only to a later new-row/handoff resolution, not to frozen rows.
- Two workers/runs: unique source row avoids two messages; existing version,
  transport and lease fences make losing handoff updates no-ops. No new lock promise.
- PD handoff: use the newly resolved PD's raw pair, render for current facts, and
  pass the just-read version. Preserve source schedule; clear old approval/edits
  only through the existing atomic SQL transition. Failed preference lookup leaves
  the previous row untouched; existing delivery semantics are not expanded here.
- Activity exists, send intent exists, live lease, sent/stopped or changed version:
  no new wording overwrite; retain existing recovery and recipient generation.
- No default generation enters activity correlation, send proof, digest receipt,
  attention state, review posture or retention decisions.

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
Clear confirmation never implies a message action. Page navigation/Back/reload
warn when editor edits or pending/unconfirmed mutation results would be lost.
Use a small scoped guard with the existing proven Pages-router behavior; do not
extract/refactor the distribution component or its recovery contract in this slice.

Independent preference request generations plus mounted/actor-scope checks guard
success, error and finally after every await. Stable scope uses authenticated
session actor/profile, not selected message ID/version or a transient profile
loading phase. Hide/disable while identity is loading, retain edits for the same
confirmed actor, clear/remount on a real actor change; ignore old reads/writes.
Late load never overwrites typing. Busy blocks duplicate preference actions;
unknown mutation latches until strict Reload. Navigation during a pending mutation
warns it may already have persisted; do not claim cancellation rolls it back.
The editor can be independently disabled during a row action without rebasing it.
Any necessary page-boundary wiring stays limited to protecting this new editor;
existing row-selection/discard behavior is not silently redesigned.

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
   profile-map mismatch, no caller identity, methods/query/body/size, private
   no-store, mutation confirmation vs refresh failure; no ledger/transport calls.
   Generic keyed/list GET and single/batch POST/DELETE cannot bypass new key.
4. Cron: absent vs configured current-PD defaults at INSERT and eligible handoff;
   failure before any new draft write; same-owner stored row unchanged after
   defaults change; four simultaneous same-PD requests share one in-flight read;
   different PDs isolated; later run refreshes; personal failures do not abort
   existing due sends/digests/reconciliation/finalization; retain shared-config gate.
5. Store/transport regressions: competing INSERTs, version/lease/transport/sent/stopped
   handoff fences, preserved schedule, reset edits/approval only on eligible handoff,
   no send-time defaults read; exact frozen row used by preview and recipient activity.
   Reuse existing isolated Postgres integration harness; never the shared live DB.
6. UI: empty inbox availability, raw source/error states, explicit future-only actions;
   message selection/concurrent row completion leaves default edits intact; defaults
   responses leave current row edits/selection/version/approval intact; late read,
   unmount, transient loading vs real actor switch, busy/uncertain latch and Reload;
   cancelling discard/navigation retains edits, confirmed discard only affects editor.
   Real-router fixture browser coverage for navigation/Back and pending result warning.

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
  workflow enum and dispatch states get no new values.

## 9. Independent review gate and next boundary

[PLANNED.] Commit this draft to fingerprint it, then run an independent read-only
Claude Code review using its existing interactive OAuth subscription on the host.
No project/provider API-key authentication, metered review product or additional
agent delegation. Reviewer must inspect actual callers/store/consumer complements
and return findings plus READY TO IMPLEMENT / READY WITH NAMED CHANGES / NEEDS REWORK.
Preserve the report verbatim in a dated audit receipt. Findings stay open until
verified and addressed; review does not authorize release or implementation.

After review, present the plan and any required changes to Justin. Do not code in
this task. Keep Claude's database work and the main checkout untouched.
