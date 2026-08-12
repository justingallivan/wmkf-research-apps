# Atlas: `wmkf_granteedeliverable` (Dataverse, WMKF child entity)

**Last verified:** row count refreshed 2026-08-12 via `npm run check:memory-drift` live Dataverse probe; reminder state/status/date combinations last probed 2026-07-27 via `scripts/probe-grantee-reminder-state.mjs`; active waiver version/body last probed 2026-07-27 via `scripts/probe-grantee-waiver-slot.mjs`. Production schema application and service-principal CRUD were previously verified in S271 (`docs/GRANTEE_DELIVERABLE_PACKAGE_MIGRATION_PLAN.md`).
**Live row count:** 14
**Operational-state snapshot:** on 2026-07-27 the then-existing 3 rows were all `Drafted`; 0 were day-12 reminder-eligible, past the day-14 deadline, `Reminder Sent` without `wmkf_remindeddate`, or `Reminder Sent` with a final timestamp. The 2026-08-12 row-count refresh did not re-probe status/date distribution for the 14 current rows.
**Entity set:** `wmkf_granteedeliverables`
**Schema spec:** `lib/dataverse/schema/wave3-grantee-deliverable-table/wmkf_granteedeliverable.json`
**Lookup `@odata.bind` key:** `wmkf_Request@odata.bind` (→ `akoya_request`) — PascalCase per schema-apply convention and sibling child entities.

## Source of Truth

One grantee deliverable package lifecycle row per awarded `akoya_request`. The table owns package status, image file reference, image caption, first invite date, and reminder date.

Abstract text remains on `akoya_request`:
- `akoya_request.wmkf_abstract` — applicant source abstract.
- `akoya_request.wmkf_abstractformatted` — staff/AI generated draft shown to the grantee.
- `akoya_request.wmkf_abstractapproved` — grantee-edited/approved body text.

## Fields

Identity:
- `wmkf_granteedeliverableid` (PK)
- `wmkf_name` (String 200, ApplicationRequired) — synthesized display name.

Lookup:
- `wmkf_Request` / `_wmkf_request_value` → `akoya_request` (ApplicationRequired).
- `wmkf_WaiverPolicyVersion` / `_wmkf_waiverpolicyversion_value` → `wmkf_policyversion` (N:1, Restrict, optional). The exact publication-waiver version the grantee acknowledged at submit. Added 2026-07-09 by the `wave12-grantee-waiver-consent` schema wave. Parent slot `grantee-waiver` in `wmkf_policy`/`wmkf_policyversion`; see `docs/GRANTEE_WAIVER_VERSIONING_PLAN.md`.
- Alternate key `wmkf_granteedeliverable_request_key` on `wmkf_request` enforces at most one package row per request.

Data:
- `wmkf_deliverablestatus` (Picklist) — values mirror `shared/config/granteeDeliverableStatus.js`: Drafted=100000000, Invited=100000001, Reminder Sent=100000002, Submitted=100000003, Staff Review=100000004, Revision Requested=100000005, Complete=100000006, Closed No Response=100000007. Null/missing row = not started.
- `wmkf_imagefileref` (String, Url, 1000) — private SharePoint URL/path/item reference.
- `wmkf_imagecaption` (Memo, 4000) — grantee-provided image caption.
- `wmkf_inviteddate` (DateTime) — first Drafted→Invited transition only; re-sends do not reset it.
- `wmkf_remindeddate` (DateTime) — automatic reminder send timestamp.
- `wmkf_waiverackedat` (DateTime) — timestamp the grantee acknowledged the publication waiver at submit; companion to the `wmkf_WaiverPolicyVersion` lookup. Added 2026-07-09.
- `wmkf_waiverbodyhash` (String, 64) — SHA-256 hex of the exact waiver body the grantee saw (from the signed render token). Audit aid: a later in-place edit of the acknowledged version's body is detectable when this stored hash no longer matches the current `wmkf_policybody` hash. Added 2026-07-09.

## Read Paths

- `lib/services/grantee-deliverable-record.js` — canonical helper; `getDeliverableForRequest()` is read-only and never creates.
- `lib/external/verify-grantee-token.js` — external token verifier reads request + package row. Missing package row is not started.
- `pages/api/external/grantee/[token]/context.js` — fail-closed editable/view derivation from package status; external surface never exposes raw image ref.
- `pages/api/external/grantee/[token]/submit.js` — fail-closed editable guard from package status.
- `pages/api/workbench/grantee-deliverables/awardees.js` — per-awardee status label.
- `pages/api/workbench/grantee-deliverables/abstract.js` (GET) — staff Awardee-tab read of `wmkf_imagecaption`, `wmkf_imagefileref`, and `wmkf_waiverackedat` alongside status. The image ref is exposed to STAFF only, and only as a link when it is an absolute http(s) URL (the writer's fallback is a relative library path). `wmkf_waiverackedat` is surfaced as the de-facto submission time and labeled as the waiver acknowledgment, since no submitted-date field exists. Added 2026-07-29. Also returns (2026-08-10, S412) the server-computed `canReplace` capability flag and the package row's `deliverableEtag`, which the staff replace path sends back as its If-Match — the flag exists so the client never re-derives the status rule.
- `lib/services/grantee-document-assembly.js` — reads image ref/caption for staff website/cycle export and image presence for previews.
- `pages/api/cron/grantee-deliverable-reminders.js` — paged query of Invited packages where `wmkf_inviteddate` is 12+ days old; no `$expand`.

## Write Paths

- `lib/services/grantee-deliverable-record.js`
  - `ensureDeliverableForRequest()` — staff write paths only; find-or-create; recovers from alternate-key create conflict by re-read.
  - `patchDeliverable()` — writes only package-owned status/image/caption/date fields.
- `pages/api/workbench/grantee-deliverables/generate.js` — ensures package row and stamps status Drafted from null/Drafted only.
- `pages/api/workbench/grantee-deliverables/send-invite.js` — ensures package row; on first Drafted→Invited flip stamps `wmkf_inviteddate=now`; re-sends leave status/date unchanged.
- `lib/services/grantee-upload.js` — after validating/uploading image, commits the package row (`wmkf_imagecaption`, `wmkf_imagefileref`, status→Submitted, `wmkf_WaiverPolicyVersion` bind + `wmkf_waiverackedat` + `wmkf_waiverbodyhash`) AND the `akoya_request` approved-abstract PATCH in ONE atomic Dataverse changeset (per-op If-Match). SharePoint upload is outside the changeset; a non-412 failure re-reads before deleting the upload. **Reached only from the external grantee portal's submit route** — it requires an acknowledged waiver version and fails closed without one, so staff paths cannot use it.
- `lib/services/workbench/grantee-deliverables/replace-submission-service.js` — **second writer of `wmkf_imagecaption` / `wmkf_imagefileref`** (2026-08-10, S412), for STAFF replacing what the grantee returned after a revision agreed off-portal by email. Status-gated to Submitted / Staff Review from a fresh server read (Revision Requested deliberately refused — the grantee holds the pen there); the etag If-Match closes the window between that status read and the write (a status change bumps the etag → 412 → 409). Writes through `patchDeliverable`, whose field whitelist structurally prevents touching the waiver fields: the grantee's original consent **stands** and is never re-recorded. **Never** writes `wmkf_deliverablestatus`; never touches the `akoya_request` row. SharePoint upload is outside the Dataverse write and uses the SAME server-controlled filename pattern as the portal writer (the image proxy's allowlist and the prior-image prune both key on it); a failed PATCH removes the new upload, except where a re-read shows the ref DID commit (response drop), which returns success. A committed image replacement prunes the prior file best-effort, so the grantee's original leaves the folder and survives only in SharePoint's recycle bin.
- `pages/api/cron/grantee-deliverable-reminders.js` — durable pre-send claim moves status to Reminder Sent before sending; finalize stamps `wmkf_remindeddate`.

## Cross-System

| Target | Mapping |
|---|---|
| `akoya_request` | Parent request via `wmkf_Request`; stores abstract text and award/request metadata. |
| SharePoint `akoya_request/{requestnum}_{GUID}/Grantee_Uploads/` | Binary image storage; `wmkf_imagefileref` stores the private reference only. |
| Dynamics email | Invite/reminder emails are regarding the parent `akoya_request`; reminder sends as lead PD with impersonation and `noFallback:true`. |

## Migration Disposition

Straight cutover, no backfill. The old flat request fields `wmkf_granteedeliverablestatus`, `wmkf_granteeimagefileref`, and `wmkf_granteeimagecaption` are retired from application reads/writes and must be deleted manually from Dataverse only after owner/admin approval.

## Open Questions / Gotchas

- **Schema and write privilege are live.** S271 applied the production schema and verified full service-principal CRUD with `scripts/smoke-grantee-deliverable-write.mjs`; the 2026-08-12 memory-drift live count probe found 14 durable rows.
- **External paths are fail-closed.** `getDeliverableForRequest()` never creates; missing row means not editable.
- **No silent impersonation fallback for reminders.** The cron passes `noFallback:true` and reports send failures rather than sending from the service principal.
- **A claim without a final timestamp is ambiguous by design.** `Reminder Sent`
  with null `wmkf_remindeddate` can mean the pre-send claim succeeded but delivery or
  finalization failed. Investigate the email activity and logs; do not blindly
  reset/retry.
