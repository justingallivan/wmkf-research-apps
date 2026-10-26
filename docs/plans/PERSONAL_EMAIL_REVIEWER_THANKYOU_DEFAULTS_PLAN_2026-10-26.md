---
title: Personal defaults for automated reviewer thank-you emails
domain: reviewers
kind: plan
status: active
summary: "Plan-only slice 8; independent Claude READY TO IMPLEMENT at 8af5b8381 with R1–R5 closed. Separate exact-owner default/editor and pre-claim preparation. Owner confirmed rendered-copy safety holds also apply to inherited Admin wording; no runtime or live writes."
owner: product-engineering
related:
  - docs/plans/PERSONAL_EMAIL_DEFAULTS_INVENTORY_2026-09-24.md
  - docs/plans/PERSONAL_EMAIL_DEFAULTS_TODO_2026-09-20.md
  - docs/atlas/dataverse-wmkf-appreviewersuggestion.md
  - docs/atlas/postgres-infra-tables.md
---

# Automated reviewer thank-you defaults — bounded plan

## 1. Status, scope and ownership

[PLANNED, NOT BUILT; INDEPENDENT REVIEW READY TO IMPLEMENT.]
Owner confirmed the final safety policy on 2026-10-26 (§9). Justin authorized current-flow review, a bounded plan and
independent Claude review before coding. This plan proposes the contract below;
it is not authorization to implement or release. Baseline `448ed17d1` on main;
Codex owns `codex/reviewer-thankyou-defaults-plan` in the existing isolated worktree.
Claude's other checkout, corpus/database work, migrations and environment are
excluded. No live tenant probe, preference/shared-setting write, cron invocation,
mail send, migration, seed or deployment belongs to this planning task.

Only automatic receipt thank-yous from `sweepReviewThankYous` are in scope. No
reviewer acceptance confirmation, compatibility/manual thank-you composer,
honorarium/payment eligibility, reviewer closeout, recipient/signature control,
new scheduler, delivery ledger or transport retry policy. No schema change.

## 2. Current flow: independently checked before proposing changes

[VERIFIED via source at baseline, not a fresh live-data probe.]

| Contract hop | Current source / behavior |
| --- | --- |
| Entry/auth | `pages/api/cron/send-review-thankyous.js`: cron-secret GET/POST, trusted DAL context, bounded maxBatch and dryRun, Maintenance run record |
| Eligibility | `lib/services/reviewer-thankyou-sweep.js`: received timestamp present, thank-you marker absent, not excluded; test/unknown request state skipped before request/claim/send |
| Sender | `reviewer-reminder-sweep.js:loadRequestContext`: server request PD, enabled system user, server-resolved signature; current sweep requires PD id/email and a reviewer email |
| Shared copy | Sweep reads required `email.reviewer_thankyou.subject` and `.body` once; missing/unreadable shared copy pauses the batch; the required reader may alert Admin |
| Pre-claim attachment | `sendOneThankYou` builds the reviewer's own DOCX using individual-review-builder; build failure increments attachmentFailed and writes no thank-you marker |
| Claim | `reviewer-suggestion.js:claimThankYou` requires If-Match; marker is `wmkf_thankyousentat`, not delivery acceptance; missing ETag/412 means no send |
| Render/transport | Currently renderThankYou runs AFTER claim, then createAndSendEmail uses PD mailbox/noFallback, actual attachment bytes and server recipient; failures after claim are not retried |
| Template storage | `reviewer_email_templates.thankyou` is a legacy field-override entry used by compatibility/manual paths; the automatic sweep never reads it |
| Editor | Profile Settings and Workbench expose EmailTemplatesModal; it explicitly labels Thank-you as legacy and says automatic thank-yous use Admin wording |
| Renderer | `reviewer-reminder-email.js` supports subject proposalTitle; body greeting/proposalTitle/signature; legacy aliases still render; retired honorariumNote resolves to empty |

[VERIFIED via tests.] Five baseline mocked suites / 49 tests passed: thank-you
sweep, cron route, reminder renderer, email-template store and modal validation.
No new feature tests exist yet. Production saved values, row counts and delivery
are UNKNOWN; Atlas dates and seed copy are not proof of current tenant content.
I read the email-template-token-syntax memory: new personal copy uses mustache;
legacy shared aliases remain supported, with no renderer cleanup in this slice.

Three source/header overclaims need narrow correction during implementation:
cron header calls attachment nonfatal, but actual code stops before claim when
attachment generation fails; sendOneThankYou docs say render follows claim. The
new order below makes rendering failures retryable before the irreversible marker.
The sweep header also overclaims manual/automatic duplicate prevention: a callable
legacy post-send bookkeeping path still writes the same marker without a pre-send
claim. Preserve it as excluded compatibility behavior; promise concurrency safety
only for overlapping automatic If-Match claimers, not arbitrary manual delivery.

## 3. Proposed product contract

[PLANNED.]

- Own automatic subject/body pair → shared Admin copy only on confirmed absence.
  Invalid/duplicate/encrypted/unreadable own defaults pause that PD's unclaimed
  candidates; no silent fallback. Other PDs continue. Existing shared settings
  remain a batch prerequisite even when own copy is configured.
- New preference key `reviewer_automatic_thankyou_template`, exactly `{subject,body}`
  raw strings in existing Dataverse `wmkf_appuserpreferences`, owned by the exact
  sending systemuser. Full pair, not a field-override map. No migration or import
  from legacy thankyou; no legacy field/key mutation.
- Independent disclosure in Profile Settings → Reviewer Emails, labelled
  **Your default wording — automatic thank-you**. Keep the current template-modal
  entry intact. Its legacy help copy should point to this separate setting rather
  than suggest the legacy Thank-you tab now controls automatic mail. No new
  Workbench entry or automatic-mail preview/send action.
- Save/Clear explicitly affects future automatic sends only. Clear restores
  inheritance, not a copy of today's shared values. No changes to prior sent
  markers or in-flight prepared messages; no retrospective resend.
- The message acknowledges receipt and attaches the review; it does not assert
  human closeout or payment approval. Explain this in the editor. Do not promise
  semantic/NLP enforcement of arbitrary staff prose.

### Validation and rendering

[PLANNED.] Subject: trimmed, 1–300 JavaScript string code units, single line; optional exact
`{{proposalTitle}}`, no other brace tokens. Message: trimmed, 1–20000 JavaScript string code units;
optional exact `{{greeting}}`, `{{proposalTitle}}`, `{{signature}}`. Literal copy
is valid; tokens are not mandatory. When used, greeting/title/signature values
come only from the server's current context. This preserves the renderer's
existing optional-signature behavior, rather than adding an automatic second one.

Reject extra fields, arrays, nulls, nonstrings, unsupported/malformed braces,
case variants, inner-space/triple-brace tokens and the renderer's known legacy
bracket aliases in new personal values. Reject retired honorariumNote and secure
link/action placeholders. Reject exactly `[greeting]`, `[proposal title]`, `[Program Director signature]`
in personal input. Case-sensitive `[Greeting]` is ordinary prose and allowed.
Literal URLs are allowed as text (unlike reminder validation); no generated secure
link, link rewriting, token or action authority is added. These bounds and URL
choices are deliberate for this family; do not reuse the reminder validator.
No new URL extraction
or transport/link behavior: thank-you remains without a generated action link.
Shared Admin values retain their separate legacy-compatible renderer contract;
new-personal validation must not be applied to shared Admin copy. **R1 decision:
drop the proposed new shared grammar check.** Existing shared unknown/malformed
tokens remain literal as today; this slice does not silently introduce a batch or
per-PD grammar refusal for existing shared copy. The shared renderer still replaces
subject `{{proposalTitle}}` / `[proposal title]`; body `{{greeting}}` / `[greeting]`,
`{{proposalTitle}}` / `[proposal title]`, `{{signature}}` / `[Program Director signature]`,
and strips `{{honorariumNote}}`. Inner-space/unbalanced unknown tokens also retain
existing literal behavior for shared copy. Personal copy rejects them. Required
shared nonblank presence remains batch-wide; no stricter shared token gate exists. UI shows
raw shared copy as a starting point with a notice if it needs token correction to
save as personal. No seed/rebaseline operation is needed.

Validate personal raw copy strictly; shared copy uses its unchanged presence/
legacy-render behavior. [OWNER-APPROVED POLICY 2026-10-26; implementation still planned.]
For BOTH sources, preflight the rendered business body
(using existing buildThankYouBodyText, not the always-present HTML notice): trimmed
nonempty check and at most 100000 code units. Final subject: trimmed nonempty check,
at most 2000 code units and no CR/LF. These are proposed application safety limits,
not a claim about Dataverse metadata limits. Do not truncate or normalize request
data or change renderer output; trim is only a blankness check. Send the exact
rendered strings. Overlong/newline/title-expansion failures use reason
`rendered_context_invalid` and leave the claim untouched; they remain paused until
the underlying context/template is fixed (a PD can remove optional title tokens).
Other empty rendered-copy failures use `rendered_copy_invalid`. These rendered
safety refusals are deliberately new for inherited Admin copy, even though its
TOKEN GRAMMAR remains unchanged. Justin explicitly confirmed these safety holds
for inherited Admin wording on 2026-10-26; this policy decision is separate from
implementation/release authorization. Counts and errors
identify these separately from unreadable own preferences. No repeated auto-send
is used to resolve them.
Render the exact HTML once for transport before claim; use the same frozen input
for the body preflight. No settings, preference read, template render or attachment
rebuild occurs after a successful claim. Keep existing escaping, legacy automation
marker stripping, server notice, sender identity and attachment builder unchanged.

## 4. Proposed persistence and exact-owner API

[PLANNED.] New `/api/reviewer-thankyou-email-preferences` (outside the app-gated
review-manager directory), GET/PUT/DELETE.
Staff self-service settings only: requireAuth with explicit bypass/applicant
refusal, positive linked profile, authenticated actor GUID, and server profile-map
GUID equality inside withDalContext. Same exact-owner posture as the released
scheduled-grantee default route. No request-selected owner/profile/PD/kind/request/
message. This deliberately uses staff auth, not an app grant: Profile Settings is
self-service, and reading/writing your future wording grants no send authority.
A PD without the reviewers app grant may edit this automatic wording but still
cannot edit app-gated reminder wording; this asymmetry is deliberate, not an
expansion of reminder access. The new matrix row will document Profile/own-staff
auth. [VERIFIED via scripts/check-api-route-security-matrix.js:12–30,93–108:] the
gate recognizes guard tokens in each source file and explicit matrix coverage; it
does not infer app authorization from the directory. The cron still chooses the
actual sender solely from the request. No widening of
any send/claim route authorization.

Private no-store, bounded 256kb parser. GET allows only no query and an empty body,
including Next's actual bodyless empty string. PUT exactly `{template}`; DELETE
exactly `{}`; unsupported methods405, malformed400, actor mismatch403, identity/
read unavailable503. Response includes exact ownerSystemId, authenticatedProfileId (positive integer
from session, never client input), ownStatus, own/shared
raw pairs, sharedStatus/source and canSave/canClear. Own and shared read statuses
stay independent; invalid own copy may show labelled shared copy for repair but
must never appear configured/usable for automatic delivery.

Use complete `listByOwnerAndKey`, not top1: distinguish absent/configured/
duplicates/encrypted/invalid/unavailable/identity-unavailable. Strict shared GET
uses getSettingStrict and never the alerting required-reader. Keep cron's existing
required shared-config/alert behavior. Cache neither failed reads nor writes across
runs or page opens.

Save: validate → enumerate → refuse duplicates → create/update exact owner/key →
strict exact-pair readback. Clear: explicit confirmation → enumerate all exact
owner/key rows → delete only those → confirm absence. Invalid/encrypted own rows
may be replaced; duplicate rows require Clear before Save. Failed initial listing
means nothing changed; any mutation/readback/partial-Clear failure is unconfirmed,
never success. Confirmed mutation plus failed refreshed DTO is distinct success
with refreshUnavailable, requiring Reload before further writes.

Register key in RESERVED_WRITE_KEYS and PRIVATE_REMINDER_KEYS; extend the narrow
canonicalizer to a two-key set (existing scheduled key + new key only). Block
canonical, casing and whitespace aliases in generic
user-preferences keyed/list reads and single/batch writes/deletes. Preserve the
scheduled-key alias guard and all other generic-key behavior. Family service
uses existing DAL adapter directly; no identity-map/adapter/schema redesign.
Cross-tab Save/Clear is not transactional; races can produce duplicates, and
strict future reads pause for explicit repair rather than select an arbitrary row.

## 5. Proposed sweep integration and concurrency

[PLANNED.] Keep current serial loop and existing source/sender/recipient loaders,
ETag claim, batch cap, dryRun and at-most-once transport semantics.

1. Existing required shared-config read and test-request skip remain first.
2. Resolve enabled PD + reviewer context; validate PD GUID. Increment eligible
   once a candidate has the valid sender/reviewer context, BEFORE own preference
   lookup. Thus a later preference/render refusal remains eligible AND skipped/
   skippedMisconfigured. Existing batch-wide missing shared config returns before
   row eligibility counts, unchanged.
3. Resolve one strict raw pair per lowercase PD per sweep. Store the promise before
   awaiting, including error results. A later row for that PD reuses the same
   outcome; a new sweep reads fresh. Different PDs never share a pair. No new
   parallel worker pool, cross-run cache or unbounded fan-out.
4. On failed own resolution: skipped + skippedMisconfigured and no attachment/
   claim/send/attempted increment. No new preferenceFailed counter. Group NEW
   preference/render refusals by normalized PD + reason, with affectedCount and
   up to 10 sample candidate IDs. Cap new groups at 100 per run; count all refusals
   even after the diagnostic cap. No template text or full reviewer/request data
   in errors. Keep existing attachment/transport errors unchanged. Maintenance
   uses skippedMisconfigured so neither real nor dryRun refusal looks clean.
5. A common pure preparation contract first checks for a concrete source ETag in
   BOTH paths; a missing ETag increments claimFailed only (not skipped or
   skippedMisconfigured), no render/attachment/claim/send. Own read failures still
   precede this check as in steps 3–4. Then per-row rendering/validation precedes
   the dryRun early return. Every render/copy refusal increments BOTH skipped
   and skippedMisconfigured, leaving claimFailed unchanged. DryRun
   therefore reveals raw/expanded-copy failures and counts them identically, but
   builds no attachment, claims nothing and sends nothing. A cron dryRun still
   writes its existing Maintenance run record and may produce existing shared-
   config alerts; it is NOT a read-only/live-probe shortcut and is not authorized
   for this planning task. No new post-deploy dryRun requirement is introduced
   after dropping the new shared grammar gate. Fixture dryRun proof is required.
6. Non-dry sweep reserves attempted++ immediately before sendOneThankYou,
   preserving the conservative budget even for missing ETag/preparation failures.
   In sendOneThankYou, check ETag and use the exact subject/html from the same
   family preparation function used in dryRun. The helper accepts raw frozen
   templates/context (not arbitrary caller-provided prepared output) and calls
   that pure preparation before attachment/claim. Non-dry sweep calls the helper;
   dryRun calls only that pure preparation. This avoids different validation
   rules or duplicate HTML rendering in the two paths,
   then build the full required attachment. Any preparation failure leaves the
   marker untouched; rendering/config failures are skippedMisconfigured, attachment
   failures retain attachmentFailed. Failed rows can recover on a later sweep.
7. Claim with the original ETag and unchanged timestamp/attribution contract; reuse
   that timestamp for DOCX generatedAtIso. A lost claim means no transport.
8. Send the frozen subject/html/attachment with unchanged PD/recipient/noFallback.
   After-claim failure/unconfirmed classification stays at-most-once: record it,
   never clear the marker or auto-retry. Defaults changes cannot reopen it.

The top-of-loop cap check still skips rows before context/preference reads once
the non-dry attempted budget is reached. DryRun never increments attempted, so
its scan remains uncapped by maxBatch as today.
The existing attempted budget is a conservative upper bound on claims, not a new
exact delivery count: preparation failures may consume the run's budget as today;
preference-refused rows do not. Preserve no more than maxBatch potential claims.
The Maintenance response retains `{ok:true,...counts}` compatibility; failure is
truthfully carried by counts/errors and its failed operational run status, not a
new top-level success contract.

Overlapping sweeps can prepare different snapshots but the original If-Match
claim permits one winner; only that winner's frozen complete pair can send.
There is no atomic transaction across owner preferences, request PD and the claim.
Retain the existing per-run request-context snapshot; do not claim to solve live
PD reassignment, reviewer address changes or compatibility manual-send races here.
Any newly observed directly relevant unsafe race must be reported before coding.

## 6. Proposed client lifecycle and discard protection

[PLANNED.] Family-owned component beside the existing Reviewer Emails controls;
no generic editor/shared-hook extraction. The existing generic EmailWordingDefault
and scheduled hook do not meet this entire contract as-is (generic editor lacks
confirmed readback barriers; scheduled hook hardcodes its page exemption).
Use a small family-owned lifecycle modeled on the reviewed scheduled component.

Lazy open reads own/shared together; collapse retains local edits. Ordinary reopen
of the page gets fresh defaults. Actor/profile pair scopes requests and state;
strict identity match is required before enabling writes: session profileId
must equal currentProfile.id (normalized integer/string comparison), session actor
must be a GUID, and every DTO authenticatedProfileId + ownerSystemId must match
that exact pair (case-insensitive GUID). Mismatch hides raw fields and disables
all writes, with an own-profile notice; never remap to the selected foreign
profile. Transient loading pauses
retain the last same-actor draft while disabling actions; real authenticated actor
change clears it and ignores late responses. [VERIFIED via profile-settings.js:351:]
the page has an isLoading early return, so child-only state would unmount and lose
the draft. The family controller hook must run unconditionally in ProfileSettings
before that return; the new form renders its model beside Reviewer Emails. This
keeps state/uncertainty/navigation guards alive through loading without redesigning
the page or generic editors. A foreign selected profile hides the form, never
exposes another actor's draft. Wrap explicit Switch/current-profile Archive actions
with the new family discard/pending warning before they change context; cancel
keeps selection and draft. Forced session expiry/actor change prioritizes privacy.
No unrelated profile mutations, persistence or permission rules are changed. Mounted/generation/inFlight guards cover reads,
writes and finally branches. Raw fields never derive from rendered per-review text.

Warn before Reload/Clear discards edits. Navigation/Back/reload/tab close warns for
dirty or pending/unconfirmed changes; pending text says the operation may already
be saved. Cancellation retains exact raw draft/current history; accepted departure
loses only local state. A confirmed save with failed refresh has distinct truthful
wording. Unconfirmed or malformed/foreign mutation receipt latches a write barrier
until strict Reload; never offer blind repeated Save/Clear. Loading and disabled
states must not silently dismiss dirty or uncertain edits. No mutation on collapse,
navigation, load, preview or send. Update all affected help sites: EmailTemplatesModal legacy help; Profile Settings
Reviewer Emails Admin-only thank-you sentence; reviewer-template source comment;
and distinguish its legacy saved-signature explanation from this automatic
setting's request-PD-resolved signature. No unrelated Profile Settings behavior changes.

## 7. Bounded files, planned tests and completion gates

[PLANNED.] Runtime edits: new family config validator, personalization service,
preference route, Profile Settings component plus its navigation guard; existing
preference registry/generic guards, Profile Settings mount, legacy help copy,
thank-you sweep and its cron source header. Do not edit shared renderer/token
engines, individual-review-builder, reminder personalization, scheduled recovery,
legacy preference writes or any migration/environment file.

Planned tests:
- Validator grammar, boundaries, optional supported tokens, literal text, blank
  refusal, retired/legacy token refusal; legacy shared rendering remains valid.
- Complete exact-owner reads: absence, valid, wrong GUID, malformed, encrypted,
  duplicate, capped/read failure. Save/readback mismatch; Clear all duplicates,
  partial Clear, pre-write vs post-write errors, confirmed-write refresh failure.
- Real route auth/Origin/revocation/bypass/applicant, GUID/profile-map equality,
  strict query/body/selector rejection, actual installed Next empty-GET parser,
  method/body cap/no-store and separate read/mutation status DTOs.
- Generic-key privacy for exact/case/whitespace variants on keyed/list and
  single/batch mutation paths, with actual forbidden entries present in fixtures;
  unrelated and scheduled preference behavior unchanged.
- Sweep: personal vs absent shared fallback; corrupt/unreadable/duplicate blocks
  only its PD before claim/attachment; same-PD stable success/failure snapshot,
  different PD isolation, next-run freshness and default change between rows.
- Complete-preparation ordering: render/validation/DOCX before claim, correct
  bytes/timestamp; each pre-claim failure leaves marker null and later recovery
  succeeds. Two overlapping sweeps use a controlled ETag fake that lets only one
  claim succeed, even with different saved-template snapshots; winning pair only.
  Keep missing ETag,412, test/unknown request, dryRun, maxBatch, shared/template
  preflight failures and post-claim/unconfirmed no-retry coverage.
- Component actor drift/loading pause/unmount/late read-write results, dirty
  Reload/Clear and navigation decisions, duplicate clicks, uncertain barrier,
  malformed/foreign receipt, confirmed-refresh failure and independence of legacy
  template edits. Six fixture browser scenarios: load; collapse/reopen retention;
  cancel departure; deliberate discard/fresh page; Back cancel; pending-write
  warning. All API/external traffic mocked; no live Save/Clear/claim/send.

Baseline suites above plus new focused tests, affected Profile Settings/legacy
characterizations, types, scoped/full lint as appropriate, production build and
fixture Chromium. Gates+self-tests sequentially: API inventory, Atlas, facts,
doc currency/symbol/build claims, DAL/context, route/service, lifecycle auth,
GUID trust, status parity, docs catalogue and secret scan. Update route matrix,
Atlas/catalog/counts only when runtime is built, never to present planned routes
as existing. No live DB migration/probe or production mutation needed.

Implementation requires owner authorization after plan review; then an independent
Claude implementation review is required before a separate deliberate release.

## 8. Contract-reconcile Mode A / review handoff

[VERIFIED source / PLANNED extension.] Caller cron→source context→shared/own
preference→preparation→conditional marker→transport→Maintenance accounted above;
client request/auth→exact owner persistence→status DTO→independent editor also
explicit. Partial success, async snapshots, helper differences, durable surfaces,
fan-out and documentation checks are separate. New enum/status readers include
API/UI/cron/Maintenance; the new key is hidden on generic paths. There is no new
schema/transport state. Current live tenant configuration/delivery stays UNKNOWN.

Initial independent Claude review at `dc9e65a5c`: READY WITH NAMED CHANGES.
Verbatim: `docs/audits/REVIEWER_THANKYOU_DEFAULTS_PLAN_CLAUDE_REVIEW_2026-10-26.md`.
R1–R5 revised above; delta rereview at `8af5b8381` returned READY TO IMPLEMENT.
Verbatim: `docs/audits/REVIEWER_THANKYOU_DEFAULTS_PLAN_CLAUDE_REREVIEW_2026-10-26.md`. No runtime or database changes.

### Finding disposition / self-review

| Finding | Plan resolution / independent evidence |
| --- | --- |
| R1 | Dropped new shared grammar refusal; no owner decision is invented. Existing shared unknown tokens remain literal. No new live dryRun requirement or unapproved Maintenance writes. |
| R2 | Explicit rendered 2000/100000 code-unit limits, unchanged output/no trimming, CR/LF refusal, distinct context/copy reasons and repair behavior. No tenant metadata bound is assumed. |
| R3 | Moved route outside review-manager; deliberate auth asymmetry and Profile matrix row specified; read the gate implementation, no directory inference. |
| R4 | Eligible before lookup; pure render before dryRun; same failure counts, grouped capped diagnostics/no new counter; existing maxBatch/dry scan semantics pinned. |
| R5 | Exact session/profile/DTO identity equality, mismatch hiding/disable; controller survives page loading early return; Switch/Archive guard and four help sites explicit. |
| N1 | Partly REFUTED: manual marker writer still exists. send-emails-service.js:123,1178 imports/calls recordDeliveredEmail for non-invitation sends; record-email-outcome.js:28–33,73–88 maps thankyou→thankYouSentAt; reviewer-suggestion.js:1952 maps to wmkf_thankyousentat. It is post-send bookkeeping, not a pre-send claim. Preserve this baseline and excluded path, but do not repeat the cron header's incorrect claim that it can never double-thank versus manual delivery. Implementation header correction will describe sweep-to-sweep If-Match only and explicitly exclude manual coordination. |
| N2/N3 | Family bounds/URL policy deliberate; literal URLs allowed as text; exact refused bracket aliases listed, case-sensitive prose allowed. |
| N4 | Existing two guard sets and small two-key canonicalizer specified; all read/write paths and unrelated-key regression tests listed. |
| N5/N6 | Existing pure body function runs separately for preflight and inside HTML render with identical frozen inputs; no clock/randomness. Test identical resolved subject/body/signature inputs/outputs; generatedAtIso reuse is explicitly retained behavior. |

Additional tests pin R2 final bounds/context failures, R4 count placement/dryRun
render failures/Maintenance status/group cap and maxBatch-before-lookup, R5 parent
loading-unmount hazard/explicit Switch cancel and foreign DTO profile rejection; non-current Archive
needs no new family warning. Baseline fixture IDs for new strict lookup paths must
be real GUIDs, with explicit absent-own defaults where a test characterizes the
unchanged legacy behavior. Retain existing assertions, do not delete them.
No claim that dryRun or this plan exercises Production delivery.


## 9. Final review status and owner choice

[VERIFIED via independent ordinary OAuth Claude report.] READY TO IMPLEMENT at
`8af5b8381`, R1–R5 closed; no blocking findings. Mechanical nonblocking count/
ordering and non-current Archive test clarifications are incorporated above.
The separately run post-send bookkeeping + reviewer-engagement-contract baseline
also passed: 2 suites / 72 tests, all mocked. Total baseline: 7 suites / 121 tests.
This proves existing contracts, not the planned feature.

[OWNER DECISION 2026-10-26 — CONFIRMED.] Justin selected: "Hold it before claiming
the send and report the problem (Recommended)." Apply rendered safety checks to
BOTH personal and inherited Admin copy before any send claim: subject nonempty,
single-line and at most 2000 code units; business message nonempty and at most 100000.
Report the distinct reason/counts, leave the marker untouched, and retry only after
context or wording repair. Shared TOKEN GRAMMAR remains unchanged: unknown legacy
shared tokens retain the existing literal-render behavior, subject to these final
rendered safety checks. No remaining product-policy choice in this plan.
Implementation and release still require separate authorization.

Bounded sweep Mode A: slice 8 moved from not-started to plan-reviewed, not built.
Current TODO and inventory link this plan/review; source, Atlas, route matrix and
counts still describe deployed behavior, with no imaginary route/table. Historical
review reports retained verbatim, other slices/corpus work excluded. Doc/fact/
symbol/build/catalog and secret gates+self-tests run sequentially before closeout.
Owner: Codex; plan branch above; next action: authorize implementation if desired. No production or database state was touched.
