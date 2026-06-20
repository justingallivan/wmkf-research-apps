# Plan: Grantee Deliverable Package table + automatic reminders (S271)

> **Status: PLAN — Codex pre-impl review folded (S271); ready for implementation.** Sender-mailbox
> decision RESOLVED (Path A, PD impersonation; prod flag verified). Remaining prerequisite is the
> Dataverse write-privilege grant for the new table (Codex #7) — a deploy-time admin step, not a code
> blocker. Owner chose **Option 1** (move the deliverable package off `akoya_request` into its own
> related table) over adding more one-off date columns to the top-level request. This plan covers that
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

## RESOLVED DECISION — sender mailbox (owner, S271)

- **Path A chosen: send as each request's Program Director via impersonation.** Resolve PD systemuser →
  email + systemuserid; `from = PD email`, `actingUserSystemId = PD systemuserid`. Keeps reminders coming
  "from the PD" (consistent with the invite).
- **`DYNAMICS_IMPERSONATION_ENABLED=true` in prod — [VERIFIED S271 via `vercel env pull --environment=production`].**
  (The dangling Preview-scoped copy was removed; only the Production entry remains, value `true`,
  non-sensitive so it's readable.) Runtime effect requires a deployment built after the var was set.
- **No silent fallback (Codex #6).** A 403 on an impersonated write retries WITHOUT `MSCRMCallerID` and
  silently attributes to the service principal (`dynamics-service.js:145-195`). The reminder cron must
  pass a `noFallback` flag so an impersonation failure (or impersonation disabled) **skips + reports**
  the row rather than sending from the wrong identity. If a row's PD email/systemuser can't be resolved →
  skip + report.

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

1. **Schema-as-code + preflight.** New wave JSON (entity + attributes + the relationship + the
   `wmkf_request` **alternate key** per folded fix #2). New
   `scripts/preflight-grantee-deliverable-table.mjs` (3-way exit contract like the existing preflight).
2. **Package data-access helper** `lib/services/grantee-deliverable-record.js` (per folded fix #1 — the
   read/create split is BINDING): `getDeliverableForRequest(requestId)` (find the one related row, or
   null — **never creates**; used by all read + external token paths, missing row = not-started/not
   editable), `ensureDeliverableForRequest(requestId)` (find-or-create, recovers from alt-key conflict by
   re-reading; **staff write paths only**), `patchDeliverable(requestId, fields, opts)`. ALL touched paths
   go through this helper — single place that knows the relationship. Owns status/image/caption/dates only;
   abstracts stay on `akoya_request`.
3. **Cut the 10 paths over** to read/write status+image+caption via the helper instead of the
   `akoya_request` fields. (Straight cutover — 0 live data.) Preserve fail-closed editable/submit gating.
4. **send-invite:** on the initial Drafted→Invited flip, set `wmkf_deliverablestatus=Invited` **and**
   `wmkf_inviteddate=now` (re-sends do NOT reset the clock — same non-downgrade guard).
5. **Reminder cron** `pages/api/cron/grantee-deliverable-reminders.js` (`verifyCronSecret`; daily in
   `vercel.json`): paged query of `wmkf_granteedeliverables` where `status eq Invited and wmkf_inviteddate
   ne null and wmkf_inviteddate le {nowMinus12d}`; honor `capped`. **NO `$expand`** (folded fix #4) —
   per row, bounded-concurrency reads resolve the request → PI(To)/liaison(Cc) + PD systemuser (sender).
   **Durable pre-send claim** (folded fix #3): transition the row out of `Invited` BEFORE sending so a
   post-send failure can't re-trigger next run. Then mint magic-link → render PD-voice reminder →
   `createAndSendEmail` with **`noFallback`** (folded fix #5) → finalize status→Reminder Sent (+
   `wmkf_remindeddate=now`). Per-row skip+report; summary counts (reminded / skipped-no-pd /
   skipped-no-recipient / claim-failed / send-failed). Targets only `Invited`, so a responded grantee
   (status ≥ Submitted) or already-reminded one is never re-sent.
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

## Codex pre-impl review folded (S271) — binding for implementation

The implementer MUST apply these (from the Codex review, all confirmed):

1. **Fail-closed helper split (HIGH, #1/#9).** `getDeliverableForRequest(requestId)` is **read-only and
   never creates** — used by the external token paths (verify / context / submit) and all read paths; a
   missing deliverable row → treated as not-started / **NOT editable** (same fail-closed as today's
   null-status). Only the staff write paths (`generate`, `send-invite`) call
   `ensureDeliverableForRequest` (find-or-create). The abstract fields (`wmkf_abstractformatted`,
   `wmkf_abstractapproved`) **stay on `akoya_request`** — the helper owns only status/image/caption/dates,
   not the whole package; assembly still reads abstracts from the request.
2. **1:1 via Dataverse alternate key (HIGH, #3).** Add an alternate key on the `wmkf_request` lookup for
   `wmkf_granteedeliverable` (schema-apply supports it — see `wave2/wmkf_app_request_person.json`).
   find-or-create recovers from a create-conflict by re-reading the existing row. No code-only guard.
3. **Reminder cron is once-only via a durable pre-send claim (HIGH, #4).** Flip status to a claim state
   (e.g. conditional transition / "reminder pending") **before** sending; a post-send write failure must
   NOT leave the row re-selectable as `Invited` next run. Report failed claims.
4. **No `$expand` in `queryAllRecords` (MEDIUM, #5).** `queryAllRecords` only serializes select/filter/
   orderby. Use a paged deliverable query, then per-row reads (request → PI/liaison + PD systemuser) under
   bounded concurrency, with skip+report. Do NOT pass `expand`.
5. **No silent impersonation fallback (HIGH, #6).** Reminder sends pass `noFallback` so an impersonation
   403 / disabled flag → skip+report, never a service-principal-attributed send. (Mirror the intake-admin
   `noFallback: true` precedent.)
6. **Cutover needs a Dataverse write-privilege grant + smoke probe (HIGH, #7).** The service principal's
   write scope is `akoya_request` / `wmkf_ai_run` / email; writing `wmkf_granteedeliverable` will 403
   until granted. Add that grant + a create/update smoke probe as a cutover gate BEFORE code stops writing
   `akoya_request`.
7. **Gate retarget (MEDIUM, #8).** Grantee status parity is a Jest test hardwired to the old wave2
   request-field JSON (`tests/unit/grantee-deliverable-status-constants.test.js`) — retarget it to the new
   entity schema. Add the cron route to `docs/API_ROUTE_SECURITY_MATRIX.md` (`check:api-routes`) and the
   new table to the Atlas (`check:atlas`); retire the old-field shape in `docs/atlas/dataverse-akoya-request.md`.

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
