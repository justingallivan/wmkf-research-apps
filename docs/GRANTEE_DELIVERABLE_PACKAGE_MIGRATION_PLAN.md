# Plan: Grantee Deliverable Package table + automatic reminders (S271)

> **Status: PLAN — pending Codex pre-impl review (owner-requested) + one open decision (sender mailbox).**
> Owner chose **Option 1** (move the deliverable package off `akoya_request` into its own related
> table) over adding more one-off date columns to the top-level request. This plan covers that
> migration plus the 14-day / day-12 automatic reminder it unblocks.

## Why (owner intent, S271)

- The 14-day-to-respond / remind-at-day-12 cadence needs an anchor: **when was the invite sent?**
  Nothing records that today.
- Owner did not want to keep bolting one-off lifecycle dates onto the top-level `akoya_request`.
  Decision: give the deliverable **package its own related table** (a distinct lifecycle — the
  "different lifecycle/shape" exception to the fewer-tables principle in
  `feedback-human-legibility-schema-principle`), so future lifecycle dates land there, never on the
  request.

## Verified preconditions

- **[VERIFIED via `scripts/probe-grantee-deliverable-data.mjs`, S271]** 0 `akoya_request` rows carry
  ANY deliverable data (status / image ref / caption all 0). → **straight cutover, no backfill, no
  dual-write transition.** No requests have been sent to grantees yet (owner-confirmed).
- **[VERIFIED]** The 3 live fields are read/written in ~10 paths: `lib/external/grantee-token-lifecycle.js`,
  `lib/external/verify-grantee-token.js`, `lib/services/grantee-document-assembly.js`,
  `lib/services/grantee-upload.js`, `pages/api/external/grantee/[token]/context.js`,
  `pages/api/external/grantee/[token]/submit.js`, `pages/api/workbench/grantee-deliverables/awardees.js`,
  `pages/api/workbench/grantee-deliverables/generate.js`,
  `pages/api/workbench/grantee-deliverables/send-invite.js`,
  `shared/config/granteeDeliverableStatus.js` (+ `scripts/preflight-grantee-deliverables-fields.mjs`).
- **[VERIFIED]** Status enum already has `REMINDER_SENT` (100000002) and `CLOSED_NO_RESPONSE` (100000007).
- **[VERIFIED]** Cron pattern (title cron): `verifyCronSecret` guard → `bypassDynamicsRestrictions` →
  `queryAllRecords` (honor `capped`) → per-row skip+report → schedule in `vercel.json`.
- **[VERIFIED]** `DynamicsService.createAndSendEmail({ from, to, cc, regardingId, regardingType,
  actingUserSystemId })` sends as the acting user via `MSCRMCallerID` impersonation when
  `DYNAMICS_IMPERSONATION_ENABLED === 'true'` (`dynamics-service.js:161`). send-invite derives
  `fromEmail` from the staff session (`access.session.user.azureEmail`); **a cron has no session.**

## OPEN DECISION (needs owner answer before Part 4 build)

- **Sender mailbox for the automatic reminder.** A cron has no logged-in staffer. Proposed: send as
  **each request's Program Director** via impersonation (the request carries `programDirectorId`; resolve
  PD systemuser → email + systemuserid; `from = PD email`, `actingUserSystemId = PD systemuserid`). This
  keeps reminders coming "from the PD" (consistent with the invite). **Requires
  `DYNAMICS_IMPERSONATION_ENABLED=true` in prod — owner to confirm**, else fall back to a single
  shared/service mailbox (owner to name it). If a row's PD email can't be resolved → skip+report (never
  send from a wrong identity).

## Proposed schema — new entity `wmkf_granteedeliverable` (1:1 with `akoya_request`)

Modeled as 1:N (Dataverse has no true 1:1) with **at most one row per request**, enforced by a
find-or-create helper. New wave dir `lib/dataverse/schema/wave3-grantee-deliverable-table/`
(creation-only `schema-apply`, mirrors `wave2-grantee-deliverables`).

| Field (logical) | Type | Source / note |
|---|---|---|
| `wmkf_request` | Lookup → `akoya_request` | the parent; the join key |
| `wmkf_deliverablestatus` | Picklist | SAME option set values as today (moved from the request) |
| `wmkf_imagefileref` | String (Url, 1000) | moved from `wmkf_granteeimagefileref` |
| `wmkf_imagecaption` | Memo (4000) | moved from `wmkf_granteeimagecaption` |
| `wmkf_inviteddate` | DateTime | **NEW** — stamped on the initial Drafted→Invited flip |
| `wmkf_remindeddate` | DateTime | **NEW (optional)** — stamped when the day-12 reminder sends |

Future lifecycle dates (submitted / reviewed / completed) land here too — not on the request.

## Work breakdown

1. **Schema-as-code + preflight.** New wave JSON (entity + attributes + the relationship). New
   `scripts/preflight-grantee-deliverable-table.mjs` (3-way exit contract like the existing preflight).
2. **Package data-access helper** `lib/services/grantee-deliverable-record.js`:
   `getDeliverableForRequest(requestId)` (find the one related row, or null),
   `ensureDeliverableForRequest(requestId)` (find-or-create), `patchDeliverable(requestId, fields, opts)`.
   ALL touched paths go through this helper — single place that knows the relationship. Eliminates the
   copy-paste-drift risk across the ~10 sites.
3. **Cut the 10 paths over** to read/write status+image+caption via the helper instead of the
   `akoya_request` fields. (Straight cutover — 0 live data.)
4. **send-invite:** on the initial Drafted→Invited flip, set `wmkf_deliverablestatus=Invited` **and**
   `wmkf_inviteddate=now` (re-sends do NOT reset the clock — same non-downgrade guard).
5. **Reminder cron** `pages/api/cron/grantee-deliverable-reminders.js` (`verifyCronSecret`; daily in
   `vercel.json`): `queryAllRecords('wmkf_granteedeliverables', { filter: status eq Invited and
   wmkf_inviteddate ne null and wmkf_inviteddate le {nowMinus12d}, expand request })`; honor `capped`.
   Per row → resolve PD (sender) + PI(To)/liaison(Cc) → mint magic-link → render PD-voice reminder →
   `createAndSendEmail` → flip status→Reminder Sent (+ `wmkf_remindeddate=now`). Per-row skip+report;
   summary counts (reminded / skipped-no-pd / skipped-no-recipient / failed). Targets only `Invited`, so
   a responded grantee (status ≥ Submitted) or an already-reminded one (Reminder Sent) is never re-sent.
6. **Reminder email copy** (PD voice, owner-approved structure) → PI + liaison; reuse/extend
   `renderGranteeInviteHtml`.
7. **Manual destructive cleanup (FLAGGED):** after cutover, **delete the 3 now-orphaned fields from
   `akoya_request`** (`wmkf_granteedeliverablestatus`, `wmkf_granteeimagefileref`,
   `wmkf_granteeimagecaption`). `schema-apply` is creation-only → this is a **manual Dataverse admin
   step**, safe because 0 rows hold data. Requires explicit owner go-ahead; do NOT auto-run.
8. **Tests / docs / gates:** helper + cron + send-invite stamp + every cut-over path; Atlas (new entity,
   retire the 3 request fields), API-route matrix (new cron route), build-plan chunk-6, status-enum
   parity (status now on the new entity). Run `check:atlas`, `check:api-routes`, `check:status-enum-parity`,
   `check:trust-boundary-guid`, `check:fact-consistency` + self-tests.

## Cutover order

1. Apply the new table/fields (preflight → `schema-apply`).  2. Deploy the helper + cut-over code +
reminder cron.  3. (After verification) manually delete the 3 orphaned request fields. Because data is
clean, no transitional dual-read/dual-write is required.

## Risks / for Codex to scrutinize

- **1:1 enforcement** — concurrent find-or-create could create two rows for one request. Low concurrency
  (staff action + daily cron), but the helper needs a guard / dedupe-on-read.
- **Sender identity** — the impersonation path + the no-PD-email skip; never send from a wrong mailbox.
- **Reminder selection window** — `inviteddate le now-12d` AND status still `Invited`; verify no
  double-send across daily runs and that timezone/COB framing is consistent with the email's "COB [date]".
- **Status fan-out** — moving status off the request: confirm EVERY reader (dashboard query, awardees,
  context/editable gating, submit guard, assembly) now reads the related row, with the same fail-closed
  semantics (null/absent deliverable record → not editable).
- **Expand vs. per-row read** in the cron query (junction/lookup expand limits).
- **Gate impact** — `check:status-enum-parity` producer/consumer keys after the move.
