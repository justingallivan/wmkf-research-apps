---
title: Site Visit materials email Request association
domain: workbench
kind: plan
status: complete
summary: PR 424 deployed Request association for materials emails; the owner closed the historical test-email repair as unnecessary after the runtime fix shipped.
owner: product-engineering
related:
  - docs/plans/TEST_REQUEST_FACTORY_PRODUCTION_PLAN_2026-09-27.md
  - docs/atlas/dataverse-akoya-request.md
  - docs/atlas/dataverse-wmkf-sitevisit.md
  - docs/CAMPAIGN_RELEASE_AND_DATAVERSE_TEST_STRATEGY.md
---

# Site Visit materials email Request association

## Current release state

[VERIFIED via GitHub and Vercel] PR #424 merged as `5bfe07826`. Production deployment `dpl_Ac2a21TX57PXgTcMJ57FSCrTJpKF` includes this fix and PR #425 and is Ready on `applications.wmkeck.org`. Invitations, resends and manual/automatic reminders pass the server-derived Request association; invalid or mismatched identities fail before dispatch. The shared helper also classifies its known pre-create test-Request refusal as definitely not dispatched. No new production email has been sent as a smoke test of this release.

## Historical diagnosis before PR #424

Change surface: the `lib/services/site-visit-materials` email send path, its existing focused tests, and this plan. Entry points are the Meeting Tracker materials create/invite/remind action and the automatic materials reminder sweep. Email activities are persisted in Dynamics `emails`; no schema or other persistence change is planned. Consumers are Dynamics' Request timeline, the existing test-Request email guard, and the materials collection/reminder receipt stores.

Prior finding at the pre-fix baseline: Site Visit materials activities were created without a `regarding` Request, so the Request timeline does not show them and the shared test-Request dispatch guard cannot classify them by Request.

[HISTORICAL pre-repair read-only Production probe, 2026-10-03] Activity `8dbdf590-53bf-f111-aaaf-000d3a361c1f` is sent (`statecode=1`, `statuscode=3`; `senton=2026-10-03T17:55:41Z`), has a null `regarding` lookup, and the named Request GUID `2d58a2a4-5c77-4193-b249-cc37b85b8040` resolves to Request `1003303`, with test marker true and a run ID present. Its two To/Cc recipients pass the current server-side test-Request email allowlist decision; recipient addresses are intentionally omitted here. No live write or send was performed.

[VERIFIED via source] `collection-service.js::loadContext` rejects malformed request GUIDs and missing Requests before create, invite, manual reminder, or preview proceeds (lines 455–459). The create and invite paths call `assertRequestEmailAllowed` on the request and current recipients before email dispatch; create does so before minting or inserting a collection (around lines 531–550), invite before updating recipients/sending (lines 647–671), and manual reminder before its claim (lines 712–744). `reminder-sweep.js` skips every synthetic or unknown test-request state before preparation and claim when isolation is enabled (lines 90–111). These are complementary guards: the automatic sweep deliberately skips test Requests, while staff sends can proceed only for allowlisted recipients.

[HISTORICAL source before PR #424] `collection-service.js::DEFAULT_DEPENDENCIES.sendEmail` destructured no Request association and passes none to `emailActivityAdapter.create` (lines 159–162). Invitation creation and resend call this dependency at lines 617–627; manual and automatic reminders share `sendReminderEmail` at lines 781–798. The shared `lib/services/dynamics/email.js::createEmailActivity` accepts `regardingId` and `regardingType`, binds them to `regardingobjectid_akoya_request@odata.bind` when both are present (lines 161–175, 220–224), and uses them to run its pre-create test-Request guard (lines 175–180). Its send-time guard also reads the existing activity's regarding lookup and fails closed if an attached Request or type cannot be confirmed (lines 115–158). The defect is therefore in the materials caller contract, not the shared Dynamics helper.

## Implemented contract

1. In the materials default email dependency, require a valid server-derived Request GUID and use the fixed logical name `akoya_request`; pass both through `emailActivityAdapter.create` together with the existing subject, HTML, sender, recipients, correlation key, actor and no-fallback setting. Invalid or missing IDs fail before activity creation. Do not accept either association value from the browser.
2. Add `regardingId` from the loaded Request (`request.akoya_requestid`) to the shared invitation send payload. This covers both a new collection invitation and a later invitation resend.
3. Add the stored server-side Request GUID (`row.request_id`) to `sendReminderEmail`. This one builder covers manual reminders and the automatic reminder sweep after its existing ordinary-request gate. Preserve all existing recipient checks, manual claim-before-send ordering, cron claim-before-send ordering, send outcome classification and email receipt attachment.
4. Preserve the shared Dynamics helper association and delivery guards. Its create-time check sees the Request and recipient list for every materials email. The implemented follow-up marks only its known pre-create test-Request denial as definitely not dispatched; ambiguous failures retain their existing classification. With `TEST_REQUEST_ISOLATION=on`, unknown/anomalous requests remain refused; test Requests remain refused unless every current To/Cc recipient is allowlisted. The existing dispatch-time recheck then reads the persisted regarding Request before sending.

Before any material/claim side effect, each send entry point must verify that its loaded Request GUID is valid and case-insensitively equals the requested GUID. The automatic sweep must verify that `row.request_id` is valid and equals the Request returned by its fresh read before it prepares or claims a reminder. Keep generic `loadContext` unchanged for read and preview behavior; enforce these extra identity checks only on the sending paths.

## Contract and test invariants

| Invariant | Implemented test contract |
|---|---|
| New invitation, resend and manual reminder activities carry the exact server-loaded Request GUID and `regardingType: 'akoya_request'` | Add assertions to the existing materials collection-service tests for all three send builders. |
| Automatic reminders carry `row.request_id` and never turn the cron's ordinary-request filter into a staff-send exception | Extend the real-default-dependency cron contract assertion; retain and run current isolation-on skip tests for synthetic and unknown Request states. |
| Missing, malformed or mismatched Request identifiers cannot create an unlinked or mislinked materials activity | At send entry points, require the loaded Request GUID to equal the requested GUID; in the cron, require a valid row Request GUID and exact equality with the freshly loaded Request before reads, claim or send. Cover each refusal before any email adapter call. |
| The existing test-Request guard runs with materials context | Exercise the real default dependency through the mocked email adapter and assert its `regardingId` / type payload; retain `tests/unit/test-request-email-guard.test.js` for shared create- and dispatch-time refusal semantics and `tests/unit/site-visit-materials-collection-service.test.js` for early manual allowlist behavior. |
| A test Request with any unallowlisted current recipient is still refused before material or reminder side effects | Existing three-action materials test covers create/invite/remind refusal before token/insert, contact update, or claim; preserve its counterpart where all recipients are allowlisted. |
| Normal Request sends and send/receipt outcomes remain unchanged except for the new association | Existing create/invite/manual reminder tests and automatic sweep tests assert accepted IDs, failure classification, claims, and receipt writes. |

Complement check: the default email dependency must reject an absent ID, malformed ID, or incomplete association before calling the adapter; its entity type is fixed to `akoya_request`, so no caller-supplied alternate type exists. Each sending path must reject a malformed client/request row ID, a missing Request, or a mismatched fetched Request before any side effect. Generic read and preview paths keep their current `loadContext` semantics. No send branch may silently fall back to an unassociated email. The unrelated materials reader, contact resolution, template and email helper behavior stay outside scope.

## Historical test activity — repair closed by owner

[OWNER DECISION, October 3] The owner closed this repair because the activity was only a test and the runtime fix is shipped. Do not resume repair experiments, change the historical activity or delete test records under this workstream.

[VERIFIED via last read-only Production preflight] The exact historical activity is sent and unassociated. Its correlation, exact To/Cc/no Bcc, current allowlist and marked Request/run match the pinned repair. The owner authorized one regarding-only, ETag-fenced Production PATCH only after a successful sandbox characterization, with no resend.

[VERIFIED via sandbox action/readback, October 3] The synthetic email draft created for this characterization automatically received an Owner activity party. A subsequent owner-authorized adjustment allowed only that exact role-9 party and rejected every sender/recipient role. Dataverse returned HTTP 400 to `SendEmail` with `IssueSend:false`. Readback confirmed draft (`statecode=0/statuscode=1`), no sent time, null regarding and one unchanged Owner party. The exact response body was not retained, so the particular rejection cause is unknown. No retry, send-for-delivery, association PATCH, deletion or extra test-record creation followed this refusal.

The test therefore did not reach the stale-ETag or sent-regarding checks. The conditional Production repair was never executed. The owner subsequently closed the repair rather than requesting another fixture or test method. All test records remain retained. The source fix is deployed independently of this historical-record repair.

The unexecuted historical Production proposal would re-read exact identity, sent state, correlation, recipient set/allowlist, Request marker/run and fresh ETag; it uses only `regardingobjectid_akoya_request@odata.bind`, keeps the normal write interlock enabled with a purpose/date acknowledgment, and verifies association type and unchanged sent state/recipients. An ambiguous response gets readback, never blind retry. Possible organization-specific automation effects are not exhaustively characterized by a sandbox fixture; do not infer inbox delivery from an association update.

## Execution, release and limits

This is Tier 2 email behavior under `docs/CAMPAIGN_RELEASE_AND_DATAVERSE_TEST_STRATEGY.md`. Luna built it, Sol and root reviewed it, and Claude Fable approved after bounded follow-up through subscription OAuth. Materials send paths, reminder paths, live-contract and shared test-Request guard tests passed; final PR CI passed before the owner-authorized merge. The runtime release is complete. The historical test-record repair is closed by owner; no resend or broader production mutation is included.

No new entity, field, migration, endpoint, route-security entry or API response shape is planned. The association is metadata on the already-created standard email activity. Existing accepted limitations remain: automatic reminders are at-most-once after claim, so a definite/uncertain send failure does not restore the claim; this change does not add resend deduplication or a durable repair queue.

## Contract-reconcile summary

- Caller → service → email adapter → Dynamics `emails` association → Request timeline and shared test-Request guard traced above.
- Persistence changes: none; the email activity receives its existing supported `regarding` binding.
- Partial success: unchanged; collection/claim may already be durable before transport. Existing outcomes and receipts remain authoritative.
- Async/stale state: no new awaits or background behavior; automatic sweep retains test-state skip before claim.
- Helper extraction: N/A; no shared helper extraction or semantics change.
- Durable surfaces: no schema, route, field, status, migration or catalog change.
- Documentation reconciliation: this records the merged implementation and the owner-closed historical activity repair; deployment does not establish inbox delivery or a new-send production smoke.
