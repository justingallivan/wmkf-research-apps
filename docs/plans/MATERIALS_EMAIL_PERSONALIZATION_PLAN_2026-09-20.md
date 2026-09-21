---
title: Meeting Tracker materials email personalization
domain: workbench
kind: plan
status: active
summary: Build per-user invitation and reminder defaults with editable, read-only previews before explicit sending.
owner: product-engineering
related:
  - docs/plans/PERSONAL_EMAIL_DEFAULTS_TODO_2026-09-20.md
  - docs/APPLICANT_ADDITIONAL_MATERIALS_PLAN.md
  - docs/API_ROUTE_SECURITY_MATRIX.md
---

# Meeting Tracker materials email personalization

## Scope and ownership

Owner direction: root orchestrates, Luna builds, Sol reviews and iterates.
Worktree `/private/tmp/wmkf-agenda-send-feedback`, branch
`codex/materials-email-personalization`, base `97d396e45`.
Immediate scope: original materials invitation, subsequent invitation, and manual
reminder in Meeting Tracker. Suite-wide adoption remains the separate recorded
to-do; do not migrate other email flows in this change. No production writes,
real sends, migration, main merge or deployment during implementation.

Luna owns runtime and tests. Root owns docs/status, gates coordination and final
adjudication. Sol reviews read-only, sends concrete findings to Luna and root;
Luna fixes and resubmits until no blocking findings remain. Agents report blockers
promptly; root resolves scope/contract questions rather than letting retries loop.

## Source-grounded decisions

[VERIFIED via source and Atlas] Shared subjects/bodies already exist in
`shared/config/editableTextDefaults.js`. The reviewer template store demonstrates
override-only preferences. `DatabaseService` delegates user preferences to
Dataverse `wmkf_appuserpreferences` (`docs/atlas/postgres-infra-tables.md`);
reuse it with two new preference keys, not a new table.

[VERIFIED via source] The current materials card sends immediately. The existing
route is app-grant gated, exact-body validated and DAL-wrapped, with session actor
and sender. Create persists a collection/link before sending; reminder claims
before transport; existing resend is not globally idempotent. Preserve these
transport/outcome contracts and do not claim to solve cross-tab duplicate resends.

## Planned product and wire contract

1. All users with Meeting Tracker permission can use the composer and save their
   own invitation/reminder defaults. Subject and message template fields live
   in the preview panel; users may change wording for this send without saving.
   Explain reusable placeholders briefly and show their rendered result below.
2. Load shared default → this user's field overrides → current edits. Separate
   invitation and reminder preference keys avoid cross-kind lost updates. Explicit
   **Save as my default** persists only overridden raw template fields, never
   rendered request/date/recipient data. **Use shared default** clears that kind's
   personal override. Save/reset are distinct from sending and report failures.
3. New thin `/api/meeting-tracker/materials-email-preferences` route supports
   GET/PUT/DELETE for invitation or reminder, app-grant gated, session profile
   only, DAL context. Put validation/persistence logic in a materials service.
   Reserve both keys against generic `/api/user-preferences` POST and DELETE,
   including bulk forms. No client profile/actor accepted. Shared-default read
   failures must not silently overwrite personal values or report save success.
4. Add a read-only `preview` action to the existing materials route with a send
   action discriminator (create/invite/remind), raw subject/body template, and
   exact allowlists. Preview reads eligibility, collection/current visit,
   recipients, required/missing items, signature and sender. No collection,
   contributor token, email activity, reminder claim or preference is written.
5. Show a conspicuous secure-link placeholder in the initial preview; state that
   the real link is generated on Send. Keep existing uploadLink templates working
   with that placeholder. The final secure CTA/fallback URL remains server-owned;
   no client URL or recipient drives transport. Do not label this an exact-link
   preview. Existing collections may use their actual server-resolved URL.
6. A short-lived signed preview proof binds the action, request, profile/actor,
   sender, canonical recipients, collection identity, visit/window, active or
   missing checklist, exact raw templates and rendered text (including signature,
   excluding the newly minted URL). Reuse `mintScopedToken` / `verifyToken` with
   a distinct internal audience, digest as subject, explicit send action and
   five-minute expiry; do not alter the external token primitive. It confers no
   external upload permission and must never verify for audience `materials`.
7. Explicit Send posts templates and proof. Server validates proof/expiry,
   rereads/recomputes authoritative context and rejects stale previews BEFORE
   insertion/claim/transport. Carry the checked rendered content to transport;
   do not reread mutable templates/signature afterward and silently send different
   copy. Insert/claim remains in the existing service flow. Map a concurrent
   first-create uniqueness conflict to a safe conflict, not a success receipt.
8. Shared template validation is applied at personal save, preview and send:
   bounded nonblank strings, recognized placeholders for each field, required
   `{{checklist}}` for invitation or `{{missingItems}}` for reminder. Reject
   unresolved/unknown placeholders and missing required tokens. The preview
   renders current required content; UI explains how to preserve placeholders.
9. Any edit invalidates the preview and disables Send until refreshed/reviewed.
   Prevent double clicks synchronously. Abort/generation guards cover close,
   request/kind/profile changes, load, preview, save and send completions. Malformed
   successful send responses/network loss remain uncertain, not retry-safe failed.
   Preserve partial create success (collection exists but invitation failed or
   uncertain); refresh the parent even when sending fails after creation.

The registry is Dataverse and claims are Postgres; a contributor upload can race
the final freshness check. No cross-store serializability is claimed. Existing
resend duplication/cooldown limits remain explicit residuals; preview proofs are
freshness/actor binding, not a new exactly-once delivery ledger.

## Acceptance and validation

| Invariant | Required evidence |
|---|---|
| Own defaults only, app permission required | Route tests for denied access, session profile, forged profile, reserved generic single/bulk writes/deletes |
| Template layers and independent kinds | Service/UI tests for shared fallback, overrides, reset, save failure and invitation/reminder isolation |
| Preview has no send or durable business effects | Spies cover collection insert, token mint for upload, claim and email; signed proof mint is allowed |
| Saved templates reusable; one-off edits not saved | Two request contexts render different details from same saved tokens; ordinary send does not call preference save |
| Fresh reviewed content sent | Tests mutate visit, recipients, required/missing items, sender/signature, template, kind, actor or expiry; no transport on mismatch |
| Required content and secure link survive | Unknown/missing token rejection; renderer injects authoritative CTA, proof cannot authorize external materials upload |
| Outcomes truthful, stale results ignored | Real EmailSendFeedback, partial-create failed/uncertain, malformed 2xx, deferred close/request change, double click |
| Prior behavior outside this slice retained | Materials collection/contributor/reminder service tests and upload tests; no cron preference-policy change |

Luna starts with discriminating tests, then source. Run focused materials,
preference, route and UI suites, scoped ESLint and types. Run applicable API,
route-service, DAL/context, token/security and documentation gates with each
self-test sequentially, never concurrently with its gate. Root handles new route
matrix and catalog/Atlas documentation updates. Use Mode A mocked rehearsal;
the blocked Test Request Factory is not required for these tests.

Before acceptance: Sol reviews the exact stable diff with contract-reconcile;
Luna addresses findings; root independently reruns the final focused tests,
reviews complement branches, records residuals and commits the accepted candidate.
Push the feature branch for recoverability; no main promotion in this task.

## Plan review

Sol: READY with two clarifications, accepted by root and sent to Luna:
`verifyToken` does not check audience, so explicitly require exact
`materials-email-preview` audience, singleton action operation and recomputed
canonical digest subject. Normalize recipient order and bind raw template bytes,
session actor/profile, request and rendered signature. For `{{uploadLink}}`, bind
the server-generated placeholder render and substitute only that sentinel with
the authoritative URL after mint; test both body URL and fixed CTA/fallback.
