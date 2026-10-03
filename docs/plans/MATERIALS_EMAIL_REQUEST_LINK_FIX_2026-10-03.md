---
title: Site Visit materials email Request association
domain: workbench
kind: plan
status: active
summary: Attach Site Visit materials invitations and reminders to their AkoyaGO Request and preserve the test-Request delivery guard.
owner: product-engineering
related:
  - docs/plans/TEST_REQUEST_FACTORY_PRODUCTION_PLAN_2026-09-27.md
  - docs/atlas/dataverse-akoya-request.md
  - docs/atlas/dataverse-wmkf-sitevisit.md
  - docs/CAMPAIGN_RELEASE_AND_DATAVERSE_TEST_STRATEGY.md
---

# Site Visit materials email Request association

## Change surface and current state

Change surface: the `lib/services/site-visit-materials` email send path, its existing focused tests, and this plan. Entry points are the Meeting Tracker materials create/invite/remind action and the automatic materials reminder sweep. Email activities are persisted in Dynamics `emails`; no schema or other persistence change is planned. Consumers are Dynamics' Request timeline, the existing test-Request email guard, and the materials collection/reminder receipt stores.

Prior finding: Site Visit materials activities are created without a `regarding` Request, so the Request timeline does not show them and the shared test-Request dispatch guard cannot classify them by Request.

[VERIFIED 2026-10-03 via read-only Production Dataverse probe] Activity `8dbdf590-53bf-f111-aaaf-000d3a361c1f` is sent (`statecode=1`, `statuscode=3`; `senton=2026-10-03T17:55:41Z`), has a null `regarding` lookup, and the named Request GUID `2d58a2a4-5c77-4193-b249-cc37b85b8040` resolves to Request `1003303`, with test marker true and a run ID present. Its two To/Cc recipients pass the current server-side test-Request email allowlist decision; recipient addresses are intentionally omitted here. No live write or send was performed.

[VERIFIED via source] `collection-service.js::loadContext` rejects malformed request GUIDs and missing Requests before create, invite, manual reminder, or preview proceeds (lines 455–459). The create and invite paths call `assertRequestEmailAllowed` on the request and current recipients before email dispatch; create does so before minting or inserting a collection (around lines 531–550), invite before updating recipients/sending (lines 647–671), and manual reminder before its claim (lines 712–744). `reminder-sweep.js` skips every synthetic or unknown test-request state before preparation and claim when isolation is enabled (lines 90–111). These are complementary guards: the automatic sweep deliberately skips test Requests, while staff sends can proceed only for allowlisted recipients.

[VERIFIED via source] `collection-service.js::DEFAULT_DEPENDENCIES.sendEmail` currently destructures no Request association and passes none to `emailActivityAdapter.create` (lines 159–162). Invitation creation and resend call this dependency at lines 617–627; manual and automatic reminders share `sendReminderEmail` at lines 781–798. The shared `lib/services/dynamics/email.js::createEmailActivity` accepts `regardingId` and `regardingType`, binds them to `regardingobjectid_akoya_request@odata.bind` when both are present (lines 161–175, 220–224), and uses them to run its pre-create test-Request guard (lines 175–180). Its send-time guard also reads the existing activity's regarding lookup and fails closed if an attached Request or type cannot be confirmed (lines 115–158). The defect is therefore in the materials caller contract, not the shared Dynamics helper.

## Plan

1. In the materials default email dependency, require a valid server-derived Request GUID and use the fixed logical name `akoya_request`; pass both through `emailActivityAdapter.create` together with the existing subject, HTML, sender, recipients, correlation key, actor and no-fallback setting. Invalid or missing IDs fail before activity creation. Do not accept either association value from the browser.
2. Add `regardingId` from the loaded Request (`request.akoya_requestid`) to the shared invitation send payload. This covers both a new collection invitation and a later invitation resend.
3. Add the stored server-side Request GUID (`row.request_id`) to `sendReminderEmail`. This one builder covers manual reminders and the automatic reminder sweep after its existing ordinary-request gate. Preserve all existing recipient checks, manual claim-before-send ordering, cron claim-before-send ordering, send outcome classification and email receipt attachment.
4. Keep the shared Dynamics helper untouched. Its create-time check will now see the Request and recipient list for every materials email. With `TEST_REQUEST_ISOLATION=on`, unknown/anomalous requests remain refused; test Requests remain refused unless every current To/Cc recipient is allowlisted. The existing dispatch-time recheck then reads the persisted regarding Request before sending.

Before any material/claim side effect, each send entry point must verify that its loaded Request GUID is valid and case-insensitively equals the requested GUID. The automatic sweep must verify that `row.request_id` is valid and equals the Request returned by its fresh read before it prepares or claims a reminder. Keep generic `loadContext` unchanged for read and preview behavior; enforce these extra identity checks only on the sending paths.

## Contract and test invariants

| Invariant | Planned evidence |
|---|---|
| New invitation, resend and manual reminder activities carry the exact server-loaded Request GUID and `regardingType: 'akoya_request'` | Add assertions to the existing materials collection-service tests for all three send builders. |
| Automatic reminders carry `row.request_id` and never turn the cron's ordinary-request filter into a staff-send exception | Extend the real-default-dependency cron contract assertion; retain and run current isolation-on skip tests for synthetic and unknown Request states. |
| Missing, malformed or mismatched Request identifiers cannot create an unlinked or mislinked materials activity | At send entry points, require the loaded Request GUID to equal the requested GUID; in the cron, require a valid row Request GUID and exact equality with the freshly loaded Request before reads, claim or send. Cover each refusal before any email adapter call. |
| The existing test-Request guard runs with materials context | Exercise the real default dependency through the mocked email adapter and assert its `regardingId` / type payload; retain `tests/unit/test-request-email-guard.test.js` for shared create- and dispatch-time refusal semantics and `tests/unit/site-visit-materials-collection-service.test.js` for early manual allowlist behavior. |
| A test Request with any unallowlisted current recipient is still refused before material or reminder side effects | Existing three-action materials test covers create/invite/remind refusal before token/insert, contact update, or claim; preserve its counterpart where all recipients are allowlisted. |
| Normal Request sends and send/receipt outcomes remain unchanged except for the new association | Existing create/invite/manual reminder tests and automatic sweep tests assert accepted IDs, failure classification, claims, and receipt writes. |

Complement check: the default email dependency must reject an absent ID, malformed ID, or incomplete association before calling the adapter; its entity type is fixed to `akoya_request`, so no caller-supplied alternate type exists. Each sending path must reject a malformed client/request row ID, a missing Request, or a mismatched fetched Request before any side effect. Generic read and preview paths keep their current `loadContext` semantics. No send branch may silently fall back to an unassociated email. The unrelated materials reader, contact resolution, template and email helper behavior stay outside scope.

## Existing sent activity repair proposal

[VERIFIED via read-only Production probe] The named activity is sent and currently unassociated; its Request is marked synthetic, and both persisted recipients satisfy the live allowlist decision. This supports an operator-reviewed, one-record association repair candidate without resending the email.

[PLANNED] If the owner separately authorizes a repair, first re-read the activity by exact ID and confirm it is still sent, still has a null regarding lookup, still has the expected materials correlation/recipient set, and still matches the exact marked Request. Confirm the recipient allowlist decision again and preserve the activity ETag. Characterize that a sent email accepts this one association update in a non-production target first. Then propose exactly one ETag/`If-Match`-fenced update of the email's `regardingobjectid_akoya_request` binding to Request `2d58a2a4-5c77-4193-b249-cc37b85b8040`, followed by exact readback. If the response is lost, re-read the activity and treat an exact match as observed completion; never retry the update blindly. Refuse if any precondition differs. This plan stage performs no update, resend, or other live write; the future repair needs its own explicit owner authorization and reviewed command/dry-run output.

## Execution, release and limits

This is Tier 2 email behavior under `docs/CAMPAIGN_RELEASE_AND_DATAVERSE_TEST_STRATEGY.md`. Sol reviewed the plan and marked it ready with the scope correction to keep identity checks at send entrypoints while preserving generic read/preview behavior. Implementation is underway on branch `codex/materials-email-link`. Luna owns `lib/services/site-visit-materials/*` and directly related tests; shared email/Dynamics helper changes and durable catalog/Atlas edits require coordination with root. Use mocked Mode A tests only for implementation. Required focused coverage: materials collection service, materials reminder sweep, materials live-contract, shared test-request email guard, and any touched route test. Run the scoped email/materials gates from `docs/CI_GATES_REFERENCE.md` before handoff; no production send, Dataverse write, deploy, merge or promotion is part of this work.

No new entity, field, migration, endpoint, route-security entry or API response shape is planned. The association is metadata on the already-created standard email activity. Existing accepted limitations remain: automatic reminders are at-most-once after claim, so a definite/uncertain send failure does not restore the claim; this change does not add resend deduplication or a durable repair queue.

## Contract-reconcile summary

- Caller → service → email adapter → Dynamics `emails` association → Request timeline and shared test-Request guard traced above.
- Persistence changes: none; the email activity receives its existing supported `regarding` binding.
- Partial success: unchanged; collection/claim may already be durable before transport. Existing outcomes and receipts remain authoritative.
- Async/stale state: no new awaits or background behavior; automatic sweep retains test-state skip before claim.
- Helper extraction: N/A; no shared helper extraction or semantics change.
- Durable surfaces: no schema, route, field, status, migration or catalog change.
- Documentation reconciliation: this is a proposed implementation plan. Update implementation status only after accepted code/tests and root's release adjudication.
