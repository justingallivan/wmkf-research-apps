---
title: Personal reviewer reminder defaults and previews
domain: reviewer-engagement
kind: plan
status: built-in-branch
summary: Branch implementation of personal respond-by and review-due reminder wording, editable manual previews, and PD defaults in automated reminders; not merged or deployed.
owner: product-engineering
related:
  - docs/plans/PERSONAL_EMAIL_DEFAULTS_TODO_2026-09-20.md
  - docs/API_ROUTE_SECURITY_MATRIX.md
---

# Personal reviewer reminder defaults and previews

## Verified origin/main baseline before this slice

[VERIFIED via `origin/main` at `f1178bfda`] Manual respond-by had an editable rendered preview; manual review-due sent directly. Both actions were restricted at send to the lead PD or a superuser. Automatic reminders claimed a fire-once marker before delivery, used the request's PD mailbox, and read only shared Admin templates. [VERIFIED via `lib/dataverse/adapters/user-preference.js`] Preferences can be read by exact Dataverse owner systemuserid; unlike `DatabaseService.getUserPreferences`, this adapter propagates read errors. No schema or live service probe is proposed.

## Planned contract

1. Define separate subject/body template preferences for respond-by and review-due using `wmkf_appuserpreferences`. The existing Admin keys remain fallback. Validate bounded nonblank copy, placeholder vocabulary, and the review-due link-free rule before saving or claiming. No recipient, sender, URL, date, or claim is stored in a preference.
2. A dedicated `/api/review-manager/reminder-email-preferences` route supports GET/PUT/DELETE for the authenticated user's own profile and uses `requireAppAccess(req,res,'review-manager','reviewers')` and `withDalContext`. The generic preference route must reject these reserved keys so invalid stored values cannot bypass validation. Save and reset are explicit actions; preview and send never write preferences.
3. Manual preview and send are both restricted to the lead PD or a superuser, since preview reveals the assigned PD's saved copy and reviewer details. Preview resolves the current request, reviewer, sender, signature and effective due date server-side. Both kinds expose an editable subject/body. A preview proof binds the actor, request, suggestion, kind, current authoritative context and exact edited copy. Send verifies a fresh proof and rechecks eligibility and server-owned context before the existing ETag claim and transport. Respond-by keeps its server-minted link; review-due remains link-free with the fixed access instruction.
4. The sending PD's saved template is loaded by server-resolved `pd.systemuserid`; a superuser sending on behalf of a PD sees that PD's default. Every authorized staff user can explicitly save their own default, and the UI explains when the current mailbox belongs to another PD. Save never writes that PD's preference. Both automatic sweep kinds load that PD's validated template before their fire-once claim. An unavailable preference read or invalid stored override skips the send without claiming; an absent override uses Admin copy. Dry runs do not read preferences or claim.
5. Keep manual re-send, automatic at-most-once, send uncertainty, and eligibility semantics. A changed preview or context requires a new preview. A confirmed send remains confirmed even when a parent refresh fails.

## Contract-reconcile, Mode A

Change surface: reviewer reminder UI, two API routes, preference service, manual send service, and automatic sweep. Entry points: reviewer panels and cron. Persistence: `wmkf_appuserpreferences` for explicit saves; existing reminder markers/tokens for sends. Consumers: manual email dispatch, automatic sweeps, staff feedback, route matrix, tests and gates. Prior finding: the generic preference service maps read errors to `{}`; use the strict owner adapter at the send decision.

Whole flow: app-gated own-profile preference route → validated preference row; staff modal → request-authorized preview route → server render/proof → explicit request-authorized send → fresh context → ETag claim → Dynamics transport → truthful result. Cron → eligible row → server-resolved PD → strict preference read → ETag claim → transport. Partial success: existing claim-before-send can leave a marker when delivery fails; report failed or uncertain, never silently retry. Async state: modal generations cover load, save, preview and send on close/context change. Helper semantics: shared loader merges only subject/body, never sender or recipient; manual one-off edits never persist. Durable surface: no migration; add route matrix row and tests, run API/lifecycle and relevant boundary gates with self-tests. Symbol fan-out: two new preference keys have only route/service consumers and a generic-route reservation. Documentation reconciliation: keep the parent inventory's slice status current after the PR is opened. No exception to send authorization is introduced.

| Invariant | Files likely touched | Verification |
| --- | --- | --- |
| Only owner can save; another user's default never loads | preference route/service and key registry | route/service isolation tests |
| A transient/invalid preference cannot burn an automatic claim | preference service and sweep | failures assert no claim or transport |
| One-send edits never save | modal, manual service | send tests assert no preference write |
| Manual preview copy and authoritative context match send | modal, send route/service | stale proof and changed date/sender/recipient tests |
| Review-due has no reviewer URL; respond link is server-owned | renderer and send service | link-positive rejection and injection tests |
| Existing claim and outcome behavior remains | reminder services | focused regression suites |

Mode A verdict: READY WITH NAMED CHANGES — implement the proof and strict preference read before modifying send paths; the existing direct-send review-due UI must become preview-first. No external state has been probed under the owner's restriction.

## Branch implementation evidence

[VERIFIED via branch source and focused Jest] The dedicated preference route, two owner-keyed preferences, raw-template editor, proof-bound preview/send for both manual kinds, and strict PD-owned reads before each automatic claim are built on `codex/personal-email-reviewer-reminders`. The generic preference endpoint reserves both new keys. Preview and send paths do not call a preference writer. Review-due still renders without a new reviewer link; respond-by still mints its link server-side after the claim. The route's auth guard remains unchanged. The automatic cron remains unscheduled under the existing incident hold. This is branch code, not a Production behavior claim.

## Contract-reconcile, Mode B

[VERIFIED via branch source] The full path is staff composer → app-gated, request-authorized preview → server-derived request/reviewer/PD and exact PD preference → bounded template validation and scoped proof → app-gated, request-authorized send → fresh context and proof check → fresh suggestion read and unchanged ETag → If-Match marker/token claim → Dynamics send → truthful status in the composer. The automatic path is cron eligibility → assigned PD lookup → strict exact-owner preference read → If-Match claim → Dynamics send. The dedicated preference route uses the session systemuserid as the exact preference owner; the profile is used for app access, and the generic route blocks reads and writes of the new keys. Read failures and malformed stored overrides have no Admin fall-through for sending. Unknown reminder kinds and unexpected route fields reject; a missing proof rejects before any claim. A send with a changed proof context or suggestion ETag returns a no-send result.

Partial success remains the existing claim-before-transport contract: a failed or unconfirmed transport after a successful claim is reported as failed or uncertain, and the automatic sweep does not silently retry. Manual one-send copy is never persisted; Save/Clear are separate own-profile actions. The composer generation guards cover preview, preference, save and send completions across close and request changes, and a confirmed send stays confirmed if parent refresh throws. The sweep's two kinds each load their sender's template before incrementing the attempted claim count; dry runs do not read preferences. No shared helper, schema, auth guard, or cron schedule was changed.

[VERIFIED via local commands] Focused Jest passed 10 suites/198 tests, the final reviewer/reviews run passed 189 suites/3,625 tests, and the final six directly affected suites passed 140 tests. `npm run lint` and the final `npm run lint -- --quiet` passed with no errors; the unfiltered run reported 116 repository warnings. `npm run build` passed twice with two existing unrelated filesystem trace warnings. API route, route lifecycle, service/DAL/context, reviewer engagement, GUID, cron-hold, fact consistency, doc symbol, catalog, currency, canonical pointer, types, secret-scan, and scaffolding gates passed; every available self-test was run sequentially with its gate. A fresh-agent adversarial review found that preview initially lacked request ownership authorization and could reveal another PD's saved copy; both preview and send now authorize request ownership before loading content, and a non-owner route test proves the preview service is not called. No Dataverse, Graph, SharePoint, Vercel, Postgres, or email probe was run. The remaining live-data behavior is unverified until a later authorized deployment and smoke test.

## PR #332 Claude Opus review follow-up

[VERIFIED via read-only OAuth Claude Opus review and branch source] The first Opus review found five actionable defects: Workbench Reviews still posted a direct send without proof; GET used the session systemuserid while PUT/DELETE delegated to a profile mapping that can remap another user; refreshing preview during a preference save could leave Save stuck; a malformed own default had no modal repair path; and preview/send digests depended on template property order. The original direct-send path had tests that mocked success despite the new route rejecting it.

The follow-up changes make Workbench Reviews open the same review-due composer; use the session systemuserid as the exact owner for GET, PUT and DELETE through the existing Dataverse preference adapter, bypassing profile remaps; return an invalid own default's shared copy and owner ID solely for explicit repair while send remains blocked; separate preference-action state from preview generations; and canonicalize the raw template before digesting it. Regression tests cover each case. No external service, schema, or auth primitive was changed.

[VERIFIED via a second read-only OAuth Claude Opus review and source] The second review confirmed those five defects closed and found that Refresh could clear an uncertain send result, allowing a duplicate attempt; edits typed during preview loading could be overwritten; and automatic respond-by notices lost the PD name/email fallback when signature resolution returned no block. The branch now keeps uncertain send feedback and blocks a second send for that modal, disables editing during preview loads, and supplies the server-read PD fallback to the automatic notice. The generic preference GET also now excludes these new private keys so its older profile remap cannot return another user's reminder copy. Regression tests cover these paths. A fresh adversarial review follows the fixes.

[VERIFIED via a third read-only OAuth Claude Opus review and branch source] The third review found no P1/P2 and confirmed the prior five findings, uncertain-send latch, preview edit guard, and generic read isolation. It found that the existing fixed-select PD adapter omitted `fullname`, so the new notice name fallback could still be generic, and that a failed first preview left Refresh disabled on the blank template. The sweep now uses the existing caller-select system-user adapter to load `fullname`, and the composer offers Retry preview with no template after an initial load error. Regression tests exercise both through the real read and retry paths.

[VERIFIED via a final read-only OAuth Claude Opus review of commit `7af043073`] No P1, P2, or P3 findings remained. The review confirmed all ten earlier findings closed, including the PD `fullname` lookup and initial preview retry. Claude ran no tests, gates, services, or email; the local checks below supply the executable verification. Live Admin copy and Production behavior remain unprobed under the owner's restriction.

[VERIFIED via local commands after the third-review fixes] Focused Jest passed 2 suites/56 tests; the reviewer/reviews run passed 189 suites/3,628 tests. Lint and build passed. Route service, reviewer engagement, reminder hold, API route, lifecycle auth, fact consistency, documentation, types, and secret-scan gates and their available self-tests passed sequentially. No live service or email probe was run.

[VERIFIED via PR #332 CodeQL annotation and source, after final Opus review] GitHub's CodeQL alert identified polynomial backtracking in the existing `stripLegacyAutomationMarker` regex in `lib/external/automated-email-notice.js`. With the owner's explicit authorization to edit that shared helper, the branch replaced the regex with a trimmed, case-normalized marker and suffix comparison. It preserves exact standalone marker removal for reviewer and grantee email, including optional colon and surrounding whitespace, while retaining non-marker prose. A direct test covers long whitespace on matching and nonmatching lines. The focused email tests passed 3 suites/21 tests; the reviewer/reviews run passed 189 suites/3,628 tests; lint and build passed. GitHub CodeQL will be rechecked on the pushed commit. No live service or email probe was run.

[VERIFIED via local commands after the follow-up edits] Focused Jest passed 7 suites/158 tests and the reviewer/reviews run passed 189 suites/3,626 tests. `npm run lint -- --quiet` and `npm run build` passed. The API route, lifecycle auth, service/DAL/context, reviewer engagement, GUID, reminder hold, fact consistency, doc symbol, catalog, doc currency, canonical pointer, types, and secret-scan gates passed, with each available self-test run sequentially. The cron remains unscheduled. No live service or email probe was run.

## Staff rehearsal setup for PR #332

[VERIFIED via local source and in-app browser on 2026-09-24] Run `npm run rehearse:reviewer-reminders`, then open `http://127.0.0.1:3132`. The page mounts the branch's actual `RespondReminderModal` with synthetic reviewer and PD data. A loopback-only static server serves the page; in-memory handlers intercept the composer API calls and reject any other fetch. Send records a local receipt only. Reload the page to reset all synthetic defaults and receipts. No Dataverse, Graph, SharePoint, Vercel, Postgres, or email service is contacted.

Staff walkthrough (human sign-off pending):

1. As Program Director, open **Respond by**. Edit the subject, verify Send becomes disabled, refresh preview, and check the sender, recipient, copy, and secure-link note.
2. Save as the PD's default, close and reopen, and verify the saved wording loads. Edit again without saving, send, close and reopen, and verify only the saved wording persists.
3. Switch to **Superuser**. Verify the preview still uses the PD mailbox and saved PD wording. Save a different default; verify the separate PD and superuser indicators, then reopen to confirm the PD's send wording remains unchanged.
4. Open **Review due**. Verify the required due date appears and the preview says no new review link is included.
5. Check **Make next Send result uncertain**, send, and verify Send stays disabled even after **Refresh preview**. Reload before another scenario; do not interpret this synthetic status as a real Dynamics send.

Record the staff member, date, outcome, and any defects here after the walkthrough. This browser rehearsal covers the composer only; it does not establish live data, delivery, or Production behavior. Before promotion, record the last-known-good Production deployment and authorized rollback operator under the Tier 2 release procedure. The automatic reminder cron remains held.
