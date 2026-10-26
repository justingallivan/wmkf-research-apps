---
title: Personal reviewer acceptance-confirmation defaults — bounded plan
domain: reviewers
kind: plan
status: active
summary: "Slice 9 planning only: exact-owner PD defaults, shared non-PD fallback, combined discard guard and recoverable pre-claim preparation. Owner policies resolved; Claude READY TO IMPLEMENT on5fc27b570 after required corrections closed. No coding or release authorized."
owner: product-engineering
related:
  - docs/plans/PERSONAL_EMAIL_DEFAULTS_INVENTORY_2026-09-24.md
  - docs/atlas/postgres-infra-tables.md
  - docs/audits/REVIEWER_THANKYOU_DEFAULTS_RELEASE_2026-10-26.md
---

# Scope and evidence

[VERIFIED via source at `a9e9b4de61cc544f1cdcf52cb7670dd5dc2fdde6`.]
Change surface: one personal raw subject/body pair for automated reviewer acceptance
confirmations. Entry: Profile Settings; consumer: acceptance-job drain after the
reviewer accepts. Existing persistence: Dataverse `wmkf_appuserpreferences` for
copy and Postgres `reviewer_acceptance_jobs.steps` for dispatch progress. Prior
findings: independent Claude review of `fc3097adb` found R1–R7 required
corrections; dispositions and two owner choices are recorded below. This is a proposed contract, not
built behavior. Justin authorized planning and Claude review, not coding.

Current caller→persistence→consumer trace:
- `pages/api/external/review/[token]/respond.js` delegates to
  `lib/services/external-review/respond-service.js`, which stages an acceptance job
  before the accepted Dataverse PATCH. `reviewer-acceptance-job-service.js`
  encrypts the portal token and stores request/reviewer snapshots; unique
  `(suggestion_id, accepted_at)` identifies the job. Repeat acceptance is excluded
  from confirmation by the drain's `isAcceptRepeat` branch.
- `reviewer-acceptance-drain.js` re-reads the suggestion, validates accepted state
  and timestamp, isolates test requests, performs other follow-ups, and calls
  `sendAcceptanceConfirmationOnce`. Its email step skips existing sentAt/claimedAt,
  writes claimedAt under the job lease, then decrypts the token and calls the sender.
- `reviewer-acceptance-email.js` resolves an enabled PD mailbox or the existing
  NOTIFICATION_EMAIL_FROM fallback, reads required shared Admin subject/body,
  resolves the request signature and due-date ICS, renders and sends with
  noFallback:true. Confirmed engagement email wins over person-record email.
  Missing shared defaults return skipped; the drain currently records sentAt even
  for that skipped result. Failures after claiming never automatically resend.
- `reviewer-acceptance-job-service.js` uses SKIP LOCKED leases and token-guarded
  mutations. `recordReviewerAcceptanceJobFailure` retries by default up to eight
  attempts, then marks failed. This is bounded recovery, not an indefinite hold.
- `pages/api/cron/drain-reviewer-acceptances.js` records per-job outcomes in
  Maintenance. A retried job alone currently leaves the run completed, but has
  retriedJobIds/errors. Failed and leaseLost jobs make the run failed.

[VERIFIED via source search.] Acceptance has shared keys
email.reviewer_acceptance.subject/.body, no dedicated personal-default key/route.
`renderAcceptanceConfirmationEmail` is also re-exported by the respond route and
used by renderer tests. Preserve that public renderer interface and output shape.
No database/schema changes or live data probes are required to describe this
existing source contract; tenant contents were not inspected.

# Proposed contract [PLANNED throughout]

## 1. Owner and raw wording

Add `REVIEWER_AUTOMATIC_ACCEPTANCE_TEMPLATE` = `reviewer_automatic_acceptance_template` as an independent
exact-owner preference, with exactly `{subject, body}` raw strings. No legacy
reviewer_email_templates migration or mutation. Use existing complete exact-owner
listing, duplicate refusal, strict Save readback and Clear-confirmed-absence
contracts demonstrated by reviewer-thankyou-personalization.js. Separate family
service/config; avoid generalizing all email-default services in this slice.

Validation: trim storage strings; subject 1–300 code units, no CR/LF; body 1–20000.
Subject optional exact tokens: {{reviewerName}}, {{proposalTitle}}.
Body optional exact tokens: {{greeting}}, {{reviewerName}}, {{proposalTitle}},
{{reviewDueDate}}, {{signature}}, {{programDirectorName}}, {{programDirectorEmail}},
{{withdrawUrl}}. Tokens remain optional. Reject unknown/partial/spacing variants,
stray braces, retired {{requestNumber}} and renderer-supported legacy aliases
[greeting], [reviewerName], [title], [reviewDueDate], [Program Director signature],
[requestNumber]. Other ordinary brackets and literal URLs remain prose.
{{reviewDueDate}} expands to the existing whole due-date sentence, not a bare date.
Explain that explicitly in editor help. {{withdrawUrl}} always comes from the
server's decrypted portal token; authors cannot change token minting/binding.
When absent in the body, retain the existing automatic withdrawal paragraph.
If no server token exists, {{withdrawUrl}} expands to empty; editor help says so.
No new required token or secure-link token family.

Shared Admin grammar stays compatible, including literal unknown tokens and
legacy aliases. Personal saves do not rewrite shared settings. Final rendered
checks apply to either source: nonblank single-line subject ≤2000; nonblank
business body ≤100000 code units, checked before the automatic withdrawal
paragraph so a link alone cannot disguise empty authored copy; also cap the
final text including appended paragraph at 100000. Render plain text to HTML
with the existing escaping helper. Add an internal plain-text rendering step
returning business text and final text; public renderAcceptanceConfirmationEmail
continues returning exactly {subject, body}. Do not inspect HTML length as business length.

[OWNER DECISION O1, 2026-10-26.] Replace CR/LF runs in subject placeholder
VALUES with a single space, for both personal and inherited Admin wording.
Preserve body substitutions verbatim; raw authored subject CR/LF still refuses.
Use separate subject/body replacement maps in the internal renderer. Include
supported shared legacy subject aliases in the same normalization so historical
alias grammar does not bypass the policy. Do not normalize the entire subject,
which would hide malformed authored copy. Final empty/oversize output still
refuses preparation; tests distinguish authored copy from substituted values.

## 2. Staff self-service route and editor

New `/api/reviewer-acceptance-email-preferences`, parallel to the released thank-you
route: requireAuth (including existing Origin/revocation policy), refuse bypass
and applicant sessions, positive scalar profile identity plus actor GUID and
trusted profile-map equality inside withDalContext. No caller-selected owner,
profile, request or kind. GET bodyless/empty only, PUT exactly {template}, DELETE
exactly {}; private no-store, 256kb parser, 405/Allow handling. Response echoes
normalized ownerSystemId and authenticatedProfileId; do not leak raw failures.

Reuse the family contract rather than generic user-preferences: reserve/private
block the new key in ALL THREE reserved/private/canonical-alias sets, including case/trim aliases in keyed/list/single/batch reads
and mutations. Complete enumeration refuses capped results. Save refuses multiple
rows; Clear deletes only the current exact-owner/key rows and confirms absence.
Confirmed mutation followed by unavailable refresh is truthful refreshUnavailable;
ambiguous write is persistence_unconfirmed. Definite pre-write unavailable/mismatch
is never described as possibly saved. No change in generic unrelated preferences.

Independent disclosure under Profile Settings Reviewer Emails, controller called
above isLoading early return. Collapse/reopen retains unsaved wording; explicit
Reload fetches fresh defaults and warns before discarding edits. One PAGE-LEVEL navigation guard must combine the existing thank-you and new
acceptance controllers: one beforePopState slot, one beforeunload/route-events
owner, and one aggregate dirty/pending/confirmed-refresh status. Remove the
thank-you controller-owned guard invocation and pass its guard state to the page;
do not mount a second independent Back hook. Navigation, Back, unload, Switch
and current-profile Archive prompt ONCE when either editor has dirty or pending/
uncertain mutation state. A combined confirmContextChange first asks once, then
resets both controllers only on confirmation; cancellation resets neither.
Cleaning/collapsing one editor must not remove the other editor's Back guard.
Controllers expose guard state and a resetWithoutPrompt operation; page-owned
confirmation resets both without calling either controller's old prompting
confirmContextChange. Migrate its unit/integration callers deliberately.
Noncurrent Archive remains independent. Acceptance clean pending GET alone does
not warn. Preserve the released thank-you controller's current clean-read warning
semantics in this slice (its busy state still contributes); do not silently change
that existing behavior while composing the guard. Auth loading retains draft, disables mutation and
invalidates old completions; actual actor change clears private state. Epoch,
operation and mounted guards cover every post-await write and finally; old actor
cannot clear new actor busy state. Validate owner/profile and DTO status/flags.
Foreign/malformed/contradictory receipts stay uncertain until strict readable
Reload. A failed or unavailable-own Reload cannot unlock an existing uncertainty.
Clear always confirms; confirmed-refresh failure has distinct truthful copy.
No live send preview or test send button.

## 3. Preparation, attribution and fire-once claim

Split sender orchestration into `prepareAcceptanceConfirmationEmail` and a
transport-only `sendPreparedAcceptanceConfirmationEmail`; keep the existing
`sendAcceptanceConfirmationEmail` wrapper as a compatibility entry point; migrate its direct tests for the new
owner policies rather than preserving their old fallback assertions.
New drain dependency seams: prepareAcceptanceEmail, sendPreparedAcceptanceEmail,
readConfirmationRequest and readConfirmationSuggestion. Enumerate all old
deps.sendAcceptanceEmail callers/tests (including operational-events and
notification-trust-model pushup suites), migrate to the new seams, and reject a
leftover legacy send injection loudly before any default preparation can run.
Mocks must return explicit {sent:true}; undefined/malformed transport receipts
are uncertain, no sentAt, claimedAt retained and no automatic resend. The REAL sendPreparedAcceptanceConfirmationEmail must await
DynamicsService.createAndSendEmail (which resolves {emailId}, not {sent:true})
and adapt successful resolution to {sent:true, emailId: receipt?.emailId}. It must
not merely return the raw Dynamics result. Its failure throws for classification.
Only the drain's injected/adapter-level transport result needs the explicit
sent:true check. The existing public sendAcceptanceConfirmationEmail wrapper
prepares then awaits this helper and preserves its existing {sent:true} return
shape on success for direct callers. On preparation refusal, that wrapper returns
{skipped:true, reason} using the typed safe refusal reason; it never claims or
sends, and the drain uses the split helpers rather than this wrapper. Add a test using the real send-prepared helper, mocked
Dynamics resolving {emailId}, and the drain: verify claimedAt then sentAt, no
uncertain alert. An injected undefined/malformed receipt remains uncertain.
Only the drain owns the durable one-time claim. Helper extraction must preserve
recipient, sender, due-date override/ICS, signature, regarding and noFallback.
Preparation has no transport or email-step claim write.

Before email preparation, read a FRESH post-honorarium suggestion and use it for
request binding, confirmed recipient, due-date override and accepted-state checks.
Record the request GUID checked for test-request isolation in this job pass. Read
the current request through grant-request.getById using this fresh suggestion
request GUID; require equality with that isolation-checked GUID, job.request_id
(which must be nonnull/valid) and any payload request identity. Compare with the
isolation-checked GUID only when isolation is enabled; retain the existing switch
and test-state gates. Refuse missing/invalid/mismatched
identity or read failure before claim; do not fall back to stale payload request.
Use a small explicit projection: akoya_requestid, akoya_requestnum, akoya_title,
_wmkf_programdirector_value, wmkf_reviewduedate. Use this fresh request only for
confirmation preparation; leave honorarium/contact and other follow-up snapshot
contracts untouched. Read current suggestion again immediately before the email
claim. Compare request GUID, wmkf_revieweremail, wmkf_reviewduedateoverride, accepted/
declined/review-status and response timestamp against the prepared suggestion
snapshot. Any changed email/date/request/timestamp means retry without claiming.
A suggestion moved to a different request refuses; a PD change on the SAME
request before preparation selects the new PD's copy. For released/withdrawn
state, reuse the exact existing post-honorarium cancellation blocks, including
late-honorarium cleanup and operational-event supersession; do not copy a weaker
boolean-only check. No claim of
an atomic transaction across Dataverse reassignment and Postgres email dispatch:
request/PD/signature are a bounded preparation snapshot; a change after preparation
is not covered by a cross-system lock. Existing resolveSignatureForRequest
independently re-reads request/PD and swallows failures; its signature fallback
and potential race with the prepared sending PD remain unchanged. Do not claim
the signature is transactionally bound to that sender snapshot.

Resolve sender exactly once in preparation. For enabled PD attribution, require
valid matching systemuser GUID and freeze that identity, mailbox and entire selected
raw pair together. Confirmed own absence alone inherits shared copy; configured
selects personal; duplicate/encrypted/invalid/unavailable or unknown state refuses
before claim, without switching to another sender or shared copy. On the existing
non-PD fallback branch (no usable PD sender), never read a personal preference;
use Admin wording and preserve NOTIFICATION_EMAIL_FROM behavior. Personal-read failure cannot take the generic fallback. An identity mismatch
from the lookup is a preparation refusal.

[OWNER DECISION O2, 2026-10-26.] PD lookup throws are retryable preparation
refusals before claim. Do not downgrade to shared wording or the generic mailbox
on a transient/unreadable lookup. Retain shared generic fallback for no assigned
PD, a confirmed disabled PD or a confirmed PD without a mailbox. Missing/null
lookup result for an assigned PD is unreadable identity, so retry; a deleted PD
may throw 404 and now also retries to exhaustion rather than taking the historical
generic fallback. This is a named residual of the owner-approved O2 policy. Malformed or
mismatching GUID refuses. Validate the assigned GUID before the DAL lookup.

Preserve required shared-default prerequisite for both branches, as in the
thank-you slice; personal copy does not mask broken mandatory Admin configuration. Blank/missing
Admin defaults previously returned skipped and the drain falsely completed them;
they now retry, then fail if not repaired. Authored multiline shared subjects also
newly refuse, since existing readRequiredEmailDefaults only checks nonblank copy.
Document these intentional behavior changes rather than claiming shared-send
behavior is completely unchanged.
Resolve signature, due date/ICS and encrypted-token withdrawal URL before claiming.
Check for a missing encrypted token BEFORE decrypt; missing token retains
historical no-link behavior. Nonempty-token decryption/build exceptions
refuse before claim. Do not log the decrypted token, full wording or secure URL.
All required inputs, final subject/body and attachments freeze in one prepared
object. Transport consumes it without reads, rendering or selecting new defaults.

Drain sequence: existing claimedAt/sentAt → skip without preparation; otherwise
prepare all inputs → recheck current accepted state → lease-guarded claimedAt
commit → send frozen object → sentAt only for confirmed sent:true. A missing lease
mutation aborts before transport. After claim, throw, uncertain send, malformed
receipt or lost success recording never clears claimedAt and never auto-resends.
Record/alert accurate failed/uncertain result rather than false sentAt. Preserve
other follow-ups and repeat-accept suppression. Do not reset any historical
claimed or completed jobs as a rollout action.

## 4. Pre-claim refusal recovery and observability

Preparation refusal returns a typed safe reason (own status, shared configuration,
request/context/render/token preparation), never a sent receipt. Drain records
acceptance_confirmation preparation failure metadata under its lease WITHOUT
claimedAt/sentAt, emits a bounded deduplicated operations alert with IDs/reason,
and adds a retryable reason to the existing retryReasons collection. Continue
quota and other existing tails before the normal failure/retry path. It must not
complete this job as successful while confirmation preparation is refused.

Use existing job retry scheduling (300 seconds for this tail; eight total attempts,
including other failures), not a new queue/table/status. Repair before exhaustion
allows a new preparation on the next drain with fresh owner/copy; exhaustion
leaves an explicit failed job. There is NO existing staff requeue route/tool.
A reviewer repeat may collide and reopen status but does not reset attempts,
steps or payload; it is not a supported recovery mechanism. After exhaustion
the automatic confirmation is lost unless staff intervene manually; the terminal
alert must say “confirmation not sent; confirm the reviewer is still accepted
and eligible before sending by hand.” No requeue tool or DB repair
is in this slice. Eight total attempts mean seven retry gaps. Theoretical minimum is 35 minutes
(7 × 300 seconds); with a two-minute cron cadence the nominal first-refusal-to-
exhaustion window is about 42 minutes (7 × 6 minutes), longer for slow passes or
backlog (default five jobs per drain). Prior consumed attempts can shorten it.
This is not a guaranteed repair deadline. Document this finite window prominently; no indefinite automatic
repair promise. Existing
claimed jobs never become retryable emails. Use a job-bound preparation alert key acceptance-confirmation-preparation:<jobId>
with IDs/reason in metadata (at most one active alert per affected job), not a
PD-wide key that one successful sibling can incorrectly resolve. A distinct
:terminal key guarantees a terminal manual-send warning despite earlier alert
deduplication. Use warning severity plus explicit operationalEvent opt-in in
NotificationService.notify, with matching recovery key; otherwise there is no
durable operational event to settle. Keep tokens/raw copy out of metadata.
After the email claim commits, autoResolve the nonterminal preparation key:
preparation recovered; any later dispatch failure has its separate existing
failed/uncertain alert. A confirmed send may resolve both preparation keys.
Do not use mere job completion to assert dispatch success after an uncertain send.

For cancellation observed by this drain, settle ONCE in the outer-loop
processed.status === cancelled branch, covering all process cancellation exits
and avoiding duplicate cleanup hooks. For both new keys, first call
OperationalEventService.markSuperseded(key, {note}), THEN AlertService.autoResolve(key).
autoResolve takes no note and propagates markRecovered only to open events;
reversing the order falsely records recovery. Best-effort failures do not change
job outcome. Cancellations performed outside this drain (respond-service or
terminal-transition cancelling unlocked jobs) are not claimed/seen again, so may
leave a stale preparation alert/event. This is an explicit scope limit; do not
claim all cancellation alerts are automatically settled and do not expand this
slice into external cancellation writers. Terminal sibling failure still dominates retryReasons:
if preparation was refused in that pass, the confirmation is not sent and will
not automatically recover. Emit the manual-send :terminal alert in the OUTER drain catch only after
recordReviewerAcceptanceJobFailure returns a fresh updated row, when
updated is nonnull (null is lease loss), updated.status === failed,
parsePayload(updated.payload).isAcceptRepeat !== true, and
updated.steps.acceptance_confirmation has neither claimedAt nor sentAt. Use
this returned row, not the stale claimed job, and a nonthrowing notifier. This
single hook covers exhaustion and an immediate terminal sibling failure, including
failure before preparation itself was reached. Do not emit a manual-send alert
for a claimed/uncertain send, since a manual duplicate would be unsafe. A successfully prepared email may still send before that existing
terminal-sibling decision, as today. Preserve this ordering; do not retry unrelated
terminal honorarium/contact work or imply that confirmation is guaranteed.
Expose per-job retry reason through existing errors/retriedJobIds. Do not falsely
claim retried jobs make the whole Maintenance run failed; test actual behavior.

# Bounded changes and verification [PLANNED]

Runtime files: one family config validator, personalization service, preference
route, Profile Settings disclosure/controller and ONE combined page guard replacing its thank-you-only hookup; key and generic
reserved/private sets; acceptance sender and email-step drain regions only. New
request read uses existing DAL API. No SQL/schema/lease rewrite, migration,
honorarium/BILL/contact behavior change, token authority change, generic renderer
rewrite, personal defaults for compatibility sends, or production mutation.

Tests must include:
1. Validator boundaries, optional exact tokens, retirement/legacy forms, URLs;
   exact-owner foreign rows actually present, duplicate/encrypted/capped failures,
   readback mismatch/partial Clear and repair. Direct adapter filter/capped-result
   characterization to avoid a mock-only owner-exclusion claim.
2. Real requireAuth Origin/revocation/no-session plus route identity/envelope shape,
   exact reason strings, no-store/parser limits and actual Next bodyless GET.
   Generic key aliases blocked in all read/write shapes with forbidden rows present.
3. Actual Profile Settings loading/draft retention, async scope/epoch/unmount,
   definite vs ambiguous writes, confirmed refresh failure, strict Reload recovery,
   Clear and Switch/current Archive guards. Real Pages Router fixture-browser:
   load, collapse, cancel/confirm discard, Back cancel, pending write cancel/confirm,
   acceptance-only clean pending GET navigation (preserve thank-you's existing
   clean-read warning); BOTH editors dirty, one becomes clean while the
   other stays dirty then Back still prompts once; acceptance-only dirty Switch/
   current Archive cancellation, confirming context change resets both. No network
   writes to real stores.
4. Existing acceptance email renderer/placeholder/greeting golden cases; PD own,
   confirmed absence/shared, all own refusal statuses before claim, non-PD fallback
   with an own row present but reader uncalled, shared prerequisite, due override
   and ICS, server token append/explicit placeholder, confirmed recipient and
   signature/escaping. Both-source rendered empty/oversize and authored multiline
   subject refusals. CR/LF in reviewer/title placeholder VALUES normalizes only
   the subject, including shared legacy aliases; body remains byte-preserved.
   Lookup throws/null for an assigned PD retries without shared or generic send;
   confirmed no-PD/disabled/no-mailbox still uses the existing shared fallback.
5. Real drain orchestration: first prep refused, no claim/no send/no false sentAt,
   retry then repair and single confirmed send; bounded exhaustion with manual-send alert and terminal sibling failure; already-claimed
   skip; repeat acceptance skip; withdrawal/release/timestamp changes after prep;
   fresh PD reassignment on the same request before preparation uses new PD pair; read failures
   do not use payload snapshot. Fresh/post-honorarium and preclaim request/recipient/due/timestamp differences
   retry without claim; correct withdrawal cleanup. Current-PD pair frozen during concurrent edits;
   overlapping leased workers (lost lease before claim → zero sends; winner → one
   unmixed subject/body with actual lease-token checks in scratch-Postgres tests).
   Post-claim failures/uncertain/lost recording stay non-retryable for email.
6. Cron/Maintenance truthful retried vs failed outcomes; job-bound alert dedupe,
   terminal warning, recovery and cancellation supersession without closing another
   job's failure; cancellation order must leave durable events superseded rather
   than recovered. Tests cover external-cancellation stale-alert limit explicitly
   without asserting nonexistent automatic settlement. Migrate all old drain
   injected-send tests; leftover injection fails loudly and transport undefined
   is uncertain. Inject all four new seams in shared deps helpers, or derive
   readConfirmationSuggestion from injected suggestions. Include the intentionally
   real-sender trust-model case at notification-trust-model-pushup.test.js:1118:
   blank shared copy now expects followup_retry_required rather than completed,
   with real preparation and mocked DAL readers. Ensure the shared fixture has a
   valid matching job.request_id and suggestion._wmkf_request_value so the case
   actually reaches the missing-shared-default gate rather than failing identity.
   Do not force this real-path case
   to inject the transport-only seam. Repeat-acceptance injections at :1012/:1358
   never call transport; do not cite them as undefined-receipt coverage.
   Explicitly migrate reviewer-acceptance-email.test.js: its thrown PD lookup
   case must now assert skipped/refused and no send under O2, not generic fallback.
   Replace pd-guid/su-1 fixtures with valid matching GUIDs and mock the own-reader
   for PD preparation. Pin the compatibility wrapper's {skipped:true, reason}
   refusal shape and unchanged {sent:true} success shape. Preserve existing
   missing-recipient/sender/request input errors as throws in the compatibility
   wrapper; typed policy/preparation refusals return skipped. Retain genuine no-PD,
   confirmed disabled and confirmed missing-mailbox fallback cases.
   Regression red against prior claim-before-preparation source, then green.
   No real cron invocation, tenant mutation, or outbound email as test evidence.

Run relevant scoped gates/self-tests sequentially: API inventory/security matrix,
Atlas, reserved-key callers, route/service/DAL/context/lifecycle/GUID boundaries,
source enums, types/lint, docs/facts/symbol/build-claim checks and secret scan.
Update route inventory/canonical counts from source, Atlas preference/job semantics,
service catalog, slice inventory/TODO and verification receipt. Scratch Postgres,
if needed for planned lease tests, must be an isolated owned fixture, never Claude's
DB. Branch runtime work uses deliberate independent review and owner release.

# Seven-audit review checklist

1. Whole flow: route identity→owner row→strict DTO→editor; accept→job→prepare→
   lease claim→frozen transport→receipt→Maintenance accounted for.
2. Partial success: readback barriers, skipped vs sent vs uncertain and finite
   retry exhaustion explicitly separate; no claimedAt clearing.
3. Stale async: client epochs; preclaim state recheck; post-claim at-most-once;
   cross-system reassignment transaction explicitly excluded.
4. Helpers: preparation cannot claim/send; transport cannot reselect/rerender;
   legacy exported renderer contract retained. No suite-wide abstraction.
5. Durable: existing preference and job step JSON only; schema/manifest N/A.
   New route and key require catalog/Atlas/security/count updates at build time.
6. Docs: this is planning-only; release evidence for slice 8 separate. Reconcile
   current slice records after independent review, preserve historical snapshots.
7. Fan-out: new key reaches strict reader, route/UI, generic privacy sets and
   sender. No new job terminal status; typed refusal reasons reach retry and
   alerts/tests. Unknown source/status refuses rather than sends.

## Initial independent review and dispositions

[VERIFIED via host ordinary OAuth Claude, read-only.] Target fc3097adb:
READY WITH NAMED CHANGES. R1 finite recovery corrected, R2 single page-level guard,
R3 explicit test seams, R4 fresh suggestion and binding/recheck, R7 terminal siblings
and job-bound alert lifecycle, R8 three privacy sets/naming/missing token corrected.
R5 internal plain-text helper added; O1 owner approved subject-value normalization.
R6 owner approved pre-claim retries on PD lookup errors; O2 resolved. The independent review history follows. Rereview at `1aef57b70` returned READY WITH
NAMED CHANGES: real transport receipt adapter, accurate retry timing, terminal
alert placement, truthful event settlement and real-path test migration corrected
above. Its low-priority signature/isolation/deleted-PD and clean-GET clarifications
are also incorporated. Targeted closure at `1a9ad691e` closed all prior required
items but named N1: direct-wrapper test migration and refusal shape. Those are
now explicitly specified above, along with its optional fresh-payload/lease-loss,
manual-send eligibility and discriminating trust-model fixture clarifications.
Final N1 closure at `5fc27b570`: READY TO IMPLEMENT. Initial verbatim report is retained in
`docs/audits/REVIEWER_ACCEPTANCE_DEFAULTS_PLAN_CLAUDE_REVIEW_2026-10-26.md`.

[VERIFIED via root-run mocked baseline.] Four existing suites / 63 tests passed:
acceptance email, drain, job service and placeholder callers. This characterizes
current code; it does not test this unbuilt plan. Doc currency/facts/symbol/build-
claim gates/self-tests, docs catalog, API/Atlas gates/self-tests and secret scan/
self-test passed during planning. Runtime files and Claude's DB work untouched.

Owner choices O1/O2 resolved 2026-10-26 as recorded above. Independent Claude
review READY TO IMPLEMENT at `5fc27b570`; required findings closed. Final receipt:
`docs/audits/REVIEWER_ACCEPTANCE_DEFAULTS_PLAN_CLAUDE_FINAL_2026-10-26.md`.
The post-review input-error clarification preserves the existing wrapper contract
and addresses the reviewer's nonblocking note. No runtime or test edits made.
Implementation and release authorization: pending.
