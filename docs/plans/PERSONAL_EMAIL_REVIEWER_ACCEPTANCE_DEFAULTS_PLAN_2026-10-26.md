---
title: Personal reviewer acceptance-confirmation defaults — bounded plan
domain: reviewers
kind: plan
status: active
summary: "Slice 9 planning only: exact-owner defaults for PD-attributed acceptance confirmations, shared wording for the existing non-PD fallback, and recoverable preparation before the email claim. Independent Claude review pending; no implementation or release authorized."
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
findings: none from an independent review yet. This is a proposed contract, not
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

Add `REVIEWER_ACCEPTANCE_TEMPLATE` = `reviewer_acceptance_template` as an independent
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
No new required token or secure-link token family.

Shared Admin grammar stays compatible, including literal unknown tokens and
legacy aliases. Personal saves do not rewrite shared settings. Final rendered
checks apply to either source: nonblank single-line subject ≤2000; nonblank
business body ≤100000 code units, checked before the automatic withdrawal
paragraph so a link alone cannot disguise empty authored copy; also cap the
final text including appended paragraph at 100000. Render plain text to HTML
with the existing escaping helper. Do not inspect HTML length as business length.

## 2. Staff self-service route and editor

New `/api/reviewer-acceptance-email-preferences`, parallel to the released thank-you
route: requireAuth (including existing Origin/revocation policy), refuse bypass
and applicant sessions, positive scalar profile identity plus actor GUID and
trusted profile-map equality inside withDalContext. No caller-selected owner,
profile, request or kind. GET bodyless/empty only, PUT exactly {template}, DELETE
exactly {}; private no-store, 256kb parser, 405/Allow handling. Response echoes
normalized ownerSystemId and authenticatedProfileId; do not leak raw failures.

Reuse the family contract rather than generic user-preferences: reserve/private
block the new key including case/trim aliases in keyed/list/single/batch reads
and mutations. Complete enumeration refuses capped results. Save refuses multiple
rows; Clear deletes only the current exact-owner/key rows and confirms absence.
Confirmed mutation followed by unavailable refresh is truthful refreshUnavailable;
ambiguous write is persistence_unconfirmed. Definite pre-write unavailable/mismatch
is never described as possibly saved. No change in generic unrelated preferences.

Independent disclosure under Profile Settings Reviewer Emails, controller called
above isLoading early return. Collapse/reopen retains unsaved wording; explicit
Reload fetches fresh defaults and warns before discarding edits. Navigation,
Back, unload, Switch and current-profile Archive warn on dirty or pending/uncertain
mutation; noncurrent Archive remains independent. A clean pending GET alone does
not need a discard warning. Auth loading retains draft, disables mutation and
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
`sendAcceptanceConfirmationEmail` wrapper for its current direct contract tests.
Only the drain owns the durable one-time claim. Helper extraction must preserve
recipient, sender, due-date override/ICS, signature, regarding and noFallback.
Preparation has no transport or email-step claim write.

Before email preparation, read the current request through grant-request.getById,
using the authoritative current suggestion request GUID; require consistency with
job.request_id and any payload request identity. Refuse missing/invalid/mismatched
identity or read failure before claim; do not fall back to stale payload request.
Use a small explicit projection: akoya_requestid, akoya_requestnum, akoya_title,
_wmkf_programdirector_value, wmkf_reviewduedate. Use this fresh request only for
confirmation preparation; leave honorarium/contact and other follow-up snapshot
contracts untouched. Read current suggestion again immediately before the email
claim and retain accepted/timestamp/not-released/not-withdrawn checks. On changed
state use the existing cancellation/retry policy rather than sending. No claim of
an atomic transaction across Dataverse reassignment and Postgres email dispatch:
request/PD/signature are a bounded preparation snapshot; a change after preparation
is not covered by a cross-system lock.

Resolve sender exactly once in preparation. For enabled PD attribution, require
valid matching systemuser GUID and freeze that identity, mailbox and entire selected
raw pair together. Confirmed own absence alone inherits shared copy; configured
selects personal; duplicate/encrypted/invalid/unavailable or unknown state refuses
before claim, without switching to another sender or shared copy. On the existing
non-PD fallback branch (no usable PD sender), never read a personal preference;
use Admin wording and preserve NOTIFICATION_EMAIL_FROM behavior. Sender lookup
failure can still take this historical fallback branch; personal-read failure
cannot. An identity mismatch from the lookup is a preparation refusal.

Preserve required shared-default prerequisite for both branches, as in the
thank-you slice; personal copy does not mask broken mandatory Admin configuration.
Resolve signature, due date/ICS and encrypted-token withdrawal URL before claiming.
Missing token retains historical no-link behavior; decryption/build exceptions
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
leaves an explicit failed job for existing staff repair/requeue. Document this
finite window prominently; no indefinite automatic repair promise. Existing
claimed jobs never become retryable emails. Deduplicate configuration alerts by
PD/reason (fallback by shared key/reason); keep tokens/raw copy out of metadata.
Expose per-job retry reason through existing errors/retriedJobIds. Do not falsely
claim retried jobs make the whole Maintenance run failed; test actual behavior.

# Bounded changes and verification [PLANNED]

Runtime files: one family config validator, personalization service, preference
route, Profile Settings disclosure/controller and discard hook; key and generic
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
   clean pending GET navigation; no network writes to real stores.
4. Existing acceptance email renderer/placeholder/greeting golden cases; PD own,
   confirmed absence/shared, all own refusal statuses before claim, non-PD fallback
   with an own row present but reader uncalled, shared prerequisite, due override
   and ICS, server token append/explicit placeholder, confirmed recipient and
   signature/escaping. Rendered empty/multiline/oversized both-source refusals.
5. Real drain orchestration: first prep refused, no claim/no send/no false sentAt,
   retry then repair and single confirmed send; bounded exhaustion; already-claimed
   skip; repeat acceptance skip; withdrawal/release/timestamp changes after prep;
   fresh request reassignment before preparation uses new PD pair; read failures
   do not use payload snapshot. Current-PD pair frozen during concurrent edits;
   overlapping leased workers (lost lease before claim → zero sends; winner → one
   unmixed subject/body with actual lease-token checks in scratch-Postgres tests).
   Post-claim failures/uncertain/lost recording stay non-retryable for email.
6. Cron/Maintenance truthful retried vs failed outcomes and deduplicated alerts.
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

Independent review verdict: pending. Owner implementation decision: pending.
