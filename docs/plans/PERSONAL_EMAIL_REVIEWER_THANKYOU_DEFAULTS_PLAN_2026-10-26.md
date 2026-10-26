---
title: Personal defaults for automated reviewer thank-you emails
domain: reviewers
kind: plan
status: active
summary: "Plan-only slice 8: exact-owner automatic thank-you defaults, independent Profile Settings editor, strict reads and complete pre-claim preparation. No runtime/schema/live writes. Independent Claude plan review pending. Legacy manual templates and at-most-once transport stay separate."
owner: product-engineering
related:
  - docs/plans/PERSONAL_EMAIL_DEFAULTS_INVENTORY_2026-09-24.md
  - docs/plans/PERSONAL_EMAIL_DEFAULTS_TODO_2026-09-20.md
  - docs/atlas/dataverse-wmkf-appreviewersuggestion.md
  - docs/atlas/postgres-infra-tables.md
---

# Automated reviewer thank-you defaults — bounded plan

## 1. Status, scope and ownership

[PLANNED, NOT BUILT.] Justin authorized current-flow review, a bounded plan and
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

Two source/header contradictions need narrow correction during implementation:
cron header calls attachment nonfatal, but actual code stops before claim when
attachment generation fails; sendOneThankYou docs say render follows claim. The
new order below makes rendering failures retryable before the irreversible marker.

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

[PLANNED.] Subject: trimmed, 1–300 characters, single line; optional exact
`{{proposalTitle}}`, no other brace tokens. Message: trimmed, 1–20000 characters;
optional exact `{{greeting}}`, `{{proposalTitle}}`, `{{signature}}`. Literal copy
is valid; tokens are not mandatory. When used, greeting/title/signature values
come only from the server's current context. This preserves the renderer's
existing optional-signature behavior, rather than adding an automatic second one.

Reject extra fields, arrays, nulls, nonstrings, unsupported/malformed braces,
case variants, inner-space/triple-brace tokens and the renderer's known legacy
bracket aliases in new personal values. Reject retired honorariumNote and secure
link/action placeholders. Ordinary bracket prose is allowed. No new URL extraction
or transport/link behavior: thank-you remains without a generated action link.
Shared Admin values retain their separate legacy-compatible renderer contract;
new-personal validation must not invalidate existing shared aliases. Use a
separate shared-compatibility check allowing the exact existing renderer aliases
and retired honorariumNote stripping; unknown mustache tokens still fail before
claim rather than leak unexpanded into automatic mail. UI shows
raw shared copy as a starting point with a notice if it needs token correction to
save as personal. No seed/rebaseline operation is needed.

Validate the selected raw template before claim, then validate the rendered
business body (using existing buildThankYouBodyText, not the always-present HTML
notice) is nonempty/bounded and final subject is nonempty/bounded/single-line.
Render the exact HTML once for transport before claim; use the same frozen input
for the body preflight. No settings, preference read, template render or attachment
rebuild occurs after a successful claim. Keep existing escaping, legacy automation
marker stripping, server notice, sender identity and attachment builder unchanged.

## 4. Proposed persistence and exact-owner API

[PLANNED.] New `/api/review-manager/thankyou-email-preferences`, GET/PUT/DELETE.
Staff self-service settings only: requireAuth with explicit bypass/applicant
refusal, positive linked profile, authenticated actor GUID, and server profile-map
GUID equality inside withDalContext. Same exact-owner posture as the released
scheduled-grantee default route. No request-selected owner/profile/PD/kind/request/
message. This deliberately uses staff auth, not an app grant: Profile Settings is
self-service, and reading/writing your future wording grants no send authority.
The cron still chooses the actual sender solely from the request. No widening of
any send/claim route authorization.

Private no-store, bounded 256kb parser. GET allows only no query and an empty body,
including Next's actual bodyless empty string. PUT exactly `{template}`; DELETE
exactly `{}`; unsupported methods405, malformed400, actor mismatch403, identity/
read unavailable503. Response includes exact ownerSystemId, ownStatus, own/shared
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

Register key and block canonical, casing and whitespace aliases in generic
user-preferences keyed/list reads and single/batch writes/deletes. Preserve the
scheduled-key alias guard and all other generic-key behavior. Family service
uses existing DAL adapter directly; no identity-map/adapter/schema redesign.
Cross-tab Save/Clear is not transactional; races can produce duplicates, and
strict future reads pause for explicit repair rather than select an arbitrary row.

## 5. Proposed sweep integration and concurrency

[PLANNED.] Keep current serial loop and existing source/sender/recipient loaders,
ETag claim, batch cap, dryRun and at-most-once transport semantics.

1. Existing required shared-config read and test-request skip remain first.
2. Resolve enabled PD + reviewer context; validate PD GUID for preference lookup.
3. Resolve one strict raw pair per lowercase PD per sweep. Store the promise before
   awaiting, including error results. A later row for that PD reuses the same
   outcome; a new sweep reads fresh. Different PDs never share a pair. No new
   parallel worker pool, cross-run cache or unbounded fan-out.
4. On failed own resolution: skipped + skippedMisconfigured, structured bounded
   error id/reason (cap new preference-error entries at 100 per run, count every
   refusal), no attachment/claim/send and no attempted++ for this refusal.
   Use existing maintenance failure count so operational failure cannot be reported
   as a clean run. DryRun resolves/validates defaults, reports blocked candidates
   but does not build attachments, claim, mint tokens or send.
5. In sendOneThankYou, check ETag, validate raw/fully rendered copy and render HTML,
   then build the full required attachment. Any preparation failure leaves the
   marker untouched; rendering/config failures are skippedMisconfigured, attachment
   failures retain attachmentFailed. Failed rows can recover on a later sweep.
6. Claim with the original ETag and unchanged timestamp/attribution contract; reuse
   that timestamp for DOCX generatedAtIso. A lost claim means no transport.
7. Send the frozen subject/html/attachment with unchanged PD/recipient/noFallback.
   After-claim failure/unconfirmed classification stays at-most-once: record it,
   never clear the marker or auto-retry. Defaults changes cannot reopen it.

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
PD reassignment, reviewer address changes or historical manual-send races here.
Any newly observed directly relevant unsafe race must be reported before coding.

## 6. Proposed client lifecycle and discard protection

[PLANNED.] Family-owned component beside the existing Reviewer Emails controls;
no generic editor/shared-hook extraction. The existing generic EmailWordingDefault
and scheduled hook do not meet this entire contract as-is (generic editor lacks
confirmed readback barriers; scheduled hook hardcodes its page exemption).
Use a small family-owned lifecycle modeled on the reviewed scheduled component.

Lazy open reads own/shared together; collapse retains local edits. Ordinary reopen
of the page gets fresh defaults. Actor/profile pair scopes requests and state;
strict identity match is required before enabling writes. Transient loading pauses
retain the last same-actor draft while disabling actions; real actor change clears
it and ignores late responses. Mounted/generation/inFlight guards cover reads,
writes and finally branches. Raw fields never derive from rendered per-review text.

Warn before Reload/Clear discards edits. Navigation/Back/reload/tab close warns for
dirty or pending/unconfirmed changes; pending text says the operation may already
be saved. Cancellation retains exact raw draft/current history; accepted departure
loses only local state. A confirmed save with failed refresh has distinct truthful
wording. Unconfirmed or malformed/foreign mutation receipt latches a write barrier
until strict Reload; never offer blind repeated Save/Clear. Loading and disabled
states must not silently dismiss dirty or uncertain edits. No mutation on collapse,
navigation, load, preview or send. No unrelated Profile Settings behavior changes.

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

Independent Claude review pending. No runtime or database changes have been made.
