---
title: Meeting agenda defaults — build and OAuth Opus review evidence
domain: meeting-tracker
kind: audit
status: active
summary: Slice 6 built on a feature branch; corrected candidate passed full tests/build and OAuth Opus recheck. Not deployed; Production wording validated unchanged and one isolated agenda email confirmed Sent; owner confirmed inbox receipt and appearance.
owner: product-engineering
related:
  - docs/plans/PERSONAL_EMAIL_MEETING_AGENDA_DEFAULTS_PLAN_2026-10-24.md
  - docs/audits/MEETING_AGENDA_DEFAULTS_PLAN_REVIEW_2026-10-24.md
---

# Slice 6 — build evidence

## Candidate and scope

Branch `codex/meeting-agenda-email-defaults`. Original build `736df83d3`;
corrected runtime `693e637d12a19bcb3b842b51009ce9b767b32619`.
Sender-owned raw subject/optional opening in existing Dataverse preferences;
shared/raw/expanded validation; one-send To/Cc and wording independent of explicit
Save/Clear; raw sessionDate resolved against one fresh agenda snapshot; original
ledger, sender binding and exact-send recovery retained. No schema, migration,
seed, cron or shared template overwrite. The separate suite interface audit stays
queued; this build follows the owner-selected default-wording disclosure.

## Verification

[VERIFIED via parent commands, not by Opus.] Corrected candidate full isolated
run (`npx jest --ci --maxWorkers=2 --silent`) passed **1,465 suites / 25,231 tests /
five snapshots**, with 21 suites / 247 tests skipped, exit 0. Start/end HEAD in
`/tmp/slice6-corrected-head-start.txt` and `...-end.txt` match `693e637d1`.
Log: `/tmp/slice6-corrected-jest.log`. Worker teardown warning was emitted despite
exit 0; no unrelated teardown rewrite was made. Corrected focused run passed
192 tests in 12 suites. Subsequent test-only strengthening adds a shared-to-personal
source-label assertion, panel outage notice and parser/escaping checks; the final
focused result is **194 tests in 12 suites**, recorded in `/tmp/slice6-final-focused.log`. No runtime source
changed after the corrected full run or Opus recheck.

Corrected production-mode Turbopack build passed, exit 0
(`/tmp/slice6-corrected-build.log`). Scoped lint/types, API-route gate/self-test,
Atlas gate/self-test, route lifecycle/service boundaries and self-tests,
Dataverse access law/self-test, GUID trust boundary/self-test, OData/context
boundaries/self-tests, status parity/self-test, script-writer gate/self-test,
secret/scaffolding/harness checks and applicable self-tests, agent invariants,
fact/canonical-pointer and documentation gates passed. Gates and their fixture
self-tests ran sequentially; full Jest runs did not overlap fixture-writing gates.
Three existing external-materials guard-recognition warnings remain advisory.

Earlier broad `npm run test:ci` used unrestricted workers/coverage and hit an
adjacent test's missing session mock plus timing flakes in unchanged suites.
The adjacent test fixture was updated for the new authenticated actor hook;
the overparallelized process alone was stopped (exit 130). Isolated adjacent
recording/pages tests passed 175 tests; the entire isolated full rerun passed.
Do not count the aborted run as passing or silently omit it.

## UI and Impeccable

Impeccable context loaded PRODUCT.md/DESIGN.md; no design-context repair was
needed or made. Real webpack-compiled components were exercised in a local-only
rehearsal, with fake auth/Next shell modules, synthetic in-memory API responses,
unknown/external fetches denied and no application server/env file.
Desktop 1440px and narrow 390px views were inspected. Empty personal opening
Save leaves current copy untouched; one-send empty-opening preview contains
resolved date and generated agenda; disclosure and independent raw fields are
visible and narrow controls remain usable. The shared Button ref warning found
in the first pass was corrected; initialization Close/focus is pinned by tests.
Rehearsal does not establish authenticated backend/persistence or real delivery.
Fixture: `scripts/rehearse-meeting-agenda.js`. Final desktop evidence:
`/tmp/slice6-agenda-desktop-final.png`; narrow evidence:
`/tmp/slice6-agenda-narrow-final.png`. All owned rehearsal servers were stopped.

## OAuth review and corrections

Host `claude auth status` reported loggedIn=true, authMethod=claude.ai,
apiProvider=firstParty, subscriptionType=team before review. Both ordinary
Claude Opus 5.5 processes ran outside the Codex filesystem sandbox to access the
Keychain-backed session. API-key and alternate-provider override variables were
removed; external MCP disabled; tools limited to Read/Grep/Glob. No API-key agent
authentication, direct model API or metered review product was used. Any CLI
list-price usage estimate is not a billing receipt.

Initial receipt `SLICE6_OPUS_BUILD_REVIEW_2026_10_24` returned PASS WITH NAMED
FIXES. Required and recommended findings were incorporated:

| Finding | Corrected behavior |
| --- | --- |
| Conflicting shared Button styles | Explicit primary/outline variants, no competing foreground/background classes |
| GET link outage hides receipts | Only link-read outage becomes unknown drift; defaults, sent receipt and unresolved original remain visible |
| Old snapshots lack link ID | Compare ID only when persisted property exists; exact URL and other facts remain authoritative |
| Initialization traps Close | Close/Escape cancel initialization, reset busy and ignore late responses; focus tested |
| Source label changes after Save | Separate loaded-draft origin from future default cache; explicit unchanged-email feedback |
| Corrupt JSON classified unavailable | Invalid row/409 repair, distinct from read failure |
| Duplicate/disabled-save feedback | Clear-to-repair guidance and field-linked validation text |
| Changed-then-restored preview revives confirmation | Schedule change clears nonpending preview/confirmation; reverted props still require review |

Recheck `SLICE6_OPUS_BUILD_RECHECK_2026_10_24` returned **PASS**, all eight fixes
confirmed with no new merge blocker. Parent confirmed reviewed HEAD and SHA256
fingerprints of every reviewed file unchanged immediately after completion.
Opus did not execute tests, build, lint, live probes or Production checks.
The minor source-label test weakness and panel/parser coverage notes were then
addressed with test-only changes, independently run by the parent. Cosmetic
control alignment and brief loading-copy observations are nonblocking; no broad
UI cleanup was added.

## Contract reconciliation and remaining boundaries

Trace: authenticated Meeting Tracker actor → exact-owner preference service /
independent shared read → raw local one-send draft → strict fresh session/link
snapshot → resolved validated frozen PostgreSQL email → original-sender dispatch /
reconciliation → truthful receipt/UI. No caller-selected identity; both generic
preference private-read/reserved-write guards include the agenda key.

Partial success: Save readback and complete Clear absence checks; partial deletes
return removed IDs and unconfirmed outcome. Duplicate rows surface as invalid,
not arbitrary selection. Async: independent status, initialization, operation
and disclosure controllers/generations; defaults generation prevents stale status
from undoing Save/Clear; Close is allowed for initialization and locked for writes;
actor/session remount and stale-result checks prevent draft leakage. Helper scope:
agenda validator changes only agenda family; general session reader stays fail-open
while prepare/send use strict link reads. Source, template key, statuses, route,
GET consumer and reset paths were checked. Existing stores only; no migration.

Sweep Mode A updated plan, inventory, suite to-do, session, security matrix,
service catalogue, Atlas and generated route counts for branch-built status.
Historical September baselines and original review receipts remain historical.

No push/merge/deployment or live configuration/personal-default/business-record
write occurred. The subsequent owner-authorized release preflight below created
one standalone email; it did not execute the session/ledger workflow. Production
briefing-flag state remains unprobed. Published Microsoft Email entity reference
supports Subject MaxLength 800; the agenda's 500-character limit is stricter,
without claiming a fresh tenant metadata probe.
The cross-record session/link-read-to-transport race and concurrent-save possibility
remain named residuals; no atomic uniqueness or cross-record transaction is claimed.
Unrelated critique and output/ items remain untouched.

## Owner-authorized release preflight — 2026-10-24 PDT

[VERIFIED via exact Production reads, candidate renderer and email readback.]
Owner requested Production wording verification and isolated delivery. Target:
`wmkf.crm.dynamics.com`; local controlled Production rehearsal, interlock on.
No seeding was needed. Existing `email.deliberation_agenda.subject` was
`Discussion Agenda`; opening was:

> Dear Colleagues,
>
> Please find the agenda to discuss the upcoming research presentations.
>
> Each item contains a link to the materials.

Both exact keys existed, passed the candidate raw and resolved validators, and
read back unchanged after delivery. SHA256 over JSON-encoded values:
subject `130f5bc23906010ab98e96716f153b205c3b8044701b44d50abc50c174c99a92`;
body `be9f8aeb15b175206cf21a02be1676834705bb2b5b6711276a28a30fb5326661`.
Receipt: `/tmp/slice6-production-wording.json`.

One standalone message from `jgallivan@wmkeck.org` to the previously approved
staff-controlled `funeral.candor_0r@icloud.com` used the candidate's actual
`computeAgenda` / `renderAgendaEmail` and current shared opening, with subject
`[TEST ONLY — Slice 6] Discussion Agenda`. Synthetic Monday October 26, 2026,
10–11 AM America/Los_Angeles session, two 30-minute items, example.org meeting /
briefing links and a clearly labeled test location; no actual session, proposal,
briefing token, agenda ledger or preference was read/written. Candidate empty
opening retains generated agenda and `{{sessionDate}}` resolves correctly in
additional local assertions; that empty-opening variant was not a second send.

Strict sender impersonation/no fallback; short-lived interlock grant limited to
POST emails, narrowed to the exact created activity before dispatch. A process
fetch fence enforced one exact content/party/correlation create and one exact
SendEmail action; all other Dataverse writes were denied. Journal reserved before
create and send intent. No attachments or Cc/Bcc. Activity:
`986dffdc-15d0-f111-a05b-6045bd04539e`. Dynamics accepted dispatch and later
reported Sent (status 3), Completed (state 1), senton `2026-10-25T01:46:54Z`.
Readback HTML matched exactly, SHA256
`0340617c53606cfa00774ca8eaa2999d25e76ee9f957f2c6de6627fd138473b5`.
Sender/recipient parties matched; Dynamics also records its normal Owner party
(mask 9), which is not an additional recipient. No regarding record. Dynamics
appended its CRM tracking suffix to the subject. Receipts:
`/tmp/slice6-production-delivery-run2.json` and
`/tmp/slice6-production-readback.json`.

The first scratch process stopped on a Node extension-resolution import error
before any network call or email creation; receipt
`/tmp/slice6-production-delivery.json` records no activity/send attempt. A
process-only extension resolver allowed the unchanged candidate module to load.
The first readback checker incorrectly counted Dynamics' Owner party as a mail
recipient; it was corrected to check sender/To/Cc/Bcc masks, then passed. No mail
retry or duplicate create occurred. Scratch scripts remained outside the repo.

[OWNER-CONFIRMED via conversation reply: “Looks good to me.”] Inbox receipt and
opening, Monday October 26 agenda times and two synthetic items displayed correctly.
The selected wording and isolated delivery prerequisites are complete. This isolated check establishes
candidate rendering plus real Production mail transport, not authenticated
session prepare/send, live briefing links or personal preference persistence.
Those branch behaviors retain the automated evidence above. Runtime remains
unreleased; do not treat the test as authorization to promote it.

Sweep Mode A: changed fact is Production wording/delivery verification, scoped
to this audit, slice-6 plan, inventory, suite to-do and session. Source/readback
establish wording validity, unchanged settings, exact content/parties and Sent;
owner confirmed inbox receipt and correct appearance. Original review receipts below are HISTORICAL.
Current no-send/unprobed-transport statements were replaced; unrelated families
and historical baselines are excluded. Disconfirming readback checked settings,
recipients, regarding and exact body: all passed. No claim of UI/persistence
end-to-end live verification is made.

## Initial Opus report — historical verbatim receipt

SLICE6_OPUS_BUILD_REVIEW_2026_10_24

# Slice 6 build review: candidate `736df83d34d6d1a3121ff7966f1581d1bb7643e3` (base `88fdb03b6`)

**Verdict: PASS WITH NAMED FIXES.** The send safety contract holds: identity, privacy, the validator, raw→resolved prepare, both freshness checks before transport, reconcile-before-freshness and duplicate-aware Save/Clear. The build needs fixes in four places before merge: the "Send agenda again…" button styling, how the status GET handles a briefing-link outage, older stored snapshots that lack a link ID, and closing the composer while it loads.

This was a read-only review of the diff, the changed source and tests, and their direct callers. I did not run any tests, builds or gates, and I did not look at production. Test results below are as you reported them, and the full suite is not counted as passed.

## Required fixes

**1. "Send agenda again…" probably renders dark text on a dark background; directory rows turn into dark filled buttons.**
- **Evidence:** `SessionAgendaPanel.js:457-462` uses `<Button>`, which defaults to `variant="primary"` (`bg-gray-900 text-white`, `Layout.js:491-492`). It adds `className` `bg-white text-gray-900` when `lastAgenda?.sentAt`. `Layout.js:508-514` concatenates the classes, so the stylesheet decides which wins. Tailwind 3.4 emits the default palette with `white` before `gray`, so `bg-gray-900` and `text-gray-900` both win.
- **Confidence:** [ASSUMED from Tailwind's emission order; high confidence]. The rehearsal starts with `lastAgenda: null` (`meeting-agenda-entry.jsx:20`), so a desktop/narrow pass would likely not have shown this state.
- **Same problem elsewhere:** directory rows (`SessionAgendaPanel.js:89-98`) now get the primary dark style plus conflicting `inline-flex` / `justify-center` / `items-center` layout classes.
- **Fix:** use `variant={lastAgenda?.sentAt ? 'outline' : 'primary'}` and remove the colour classes. Use `variant="outline"` for directory rows, or keep native buttons there.
- **Scope:** this Button migration is outside the plan, which says suite-wide interface harmonisation stays in a separate review (plan contract 10). Only the composer Close focus needed changing.

**2. The agenda status GET now fails completely during a briefing-link outage.**
- **Evidence:** the strict `getSession` wrapper (`agenda-service.js:17-29`) is also used by `getAgendaStatus` (`:438-442`) inside a single `Promise.all`. One unreadable or thrown link read turns the whole GET into a 503.
- **Effect on the panel:**
  - The last receipt, the unresolved-send banner and the "Review unresolved send…" entry all disappear (`:443-456`).
  - `openComposer`'s catch path (`:239-242`) loads empty defaults. The amber notice then wrongly says wording "could not be loaded" (`:470-473`).
- **Safety:** not a safety problem. The server still refuses prepare while a send is unresolved (`:405-408`). It does break plan item 8's "absence vs failure, not false state" and your "no change to fail-open session-page semantics" constraint for this card.
- **Fix:** in `getAgendaStatus`, catch `agenda_links_unavailable` (or read the session non-strictly). Still return receipts, pending send and defaults, with `scheduleChanged: null` and `linksUnavailable: true`. Keep the strict reads for prepare and send only.
- **Related (low severity):** a non-GUID slot request ID makes `getLiveBriefingLink` throw 400 (`briefing-link-service.js:233`). The wrapper turns that into a retryable 503 instead of `agenda_slot_invalid`. Skip the link lookup for non-GUID values so `computeAgenda` (`:218-224`) reports the real error.

**3. Snapshots stored before this change will look like drift whenever a live link exists.**
- **Evidence:** `briefingLinkId` is new in `computeAgenda` (`:245`) and in the comparison tuple (`:325`). Older stored snapshots have no such key, so they compare `null` against the live ID.
- **Effects:**
  - The GET shows "Schedule changed since the last agenda" for every agenda sent before deploy (`:446`, panel `:446`).
  - Older prepared rows, and older `send_requested` rows that reconcile to Draft, get `agenda_operation_stale` at `:627`.
- **Safety:** fails safe. Reconciliation still runs first (`:567-613`), and stale rows are not terminal (`agenda-store.js:186-200`).
- **When it matters:** only where `DELIBERATION_BRIEFING_SCHEMA_READY=on`. The Atlas (`APPLICATION_STATE_ATLAS.md:135`) still says PLANNED, which may be stale, so live exposure is unknown.
- **Fix:** compare `briefingLinkId` only when the stored slot actually has that property. The token URL is still compared either way. Add a test with an older snapshot.

**4. Close is locked while the composer loads, and the code that aborts the load can never run.**
- **Evidence:** `openComposer` sets `busy='initialize'` (`:230`), so `locked` is true (`:164`). That disables Close and Escape (`:120`, `:133`, `:137`), and `closeComposer` returns early (`:261`). Its `initController.abort()` (`:262`) is therefore unreachable. A slow GET (strict link reads, `maxDuration: 300`) traps the user in the dialog.
- **Second problem:** if close were allowed, the catch/return paths (`:240`, `:243`) skip `setBusy(null)`.
- **Fix:** let close through when `busy === 'initialize'` (still block prepare, send and defaults writes), and reset `busy` inside `closeComposer`.

## Recommended fixes

5. **The wording-source line describes future defaults, not the open draft.** "Using your saved wording" / "Using shared wording" (`:496`) and the amber notice (`:470`) both read `defaults`, and Save/Clear updates `defaults` (`:497`). After a Save, the label says the draft uses your saved wording when the draft didn't change. Keep the source of the draft that was loaded on open or reset separately from the future-defaults value.
6. **A corrupt saved row is reported as "unavailable" instead of "invalid".** In `agenda-personalization.js:23`, a `JSON.parse` error falls into the outer catch (`:25`). The GET then returns 503 instead of the 409 repair status. Parse inside its own try and classify the result as `invalid`.
7. **The default-wording editor's feedback is unclear.**
   - **Duplicate rows:** a Save 409 shows "could not be confirmed. Reload…" (`AgendaWordingDefault.js:39`), but the actual fix is Clear.
   - **Disabled Save:** Save is disabled with no visible or `aria-describedby` reason for a blank subject or a bad token (`:56`).
   - **Fix:** map `preference_invalid` to "Clear my default, then save again". Add inline validation text tied to the field.
8. **A hidden preview can come back already confirmed.** When the session props change, `previewState` and `confirmed` are kept (`:175-178`). If the props change back, the preview reappears with Send enabled and no new review. The server freshness check still blocks a truly stale send. Clear `confirmed` (or a non-pending `previewState`) whenever `currentScheduleKey` changes.

## Test gaps (error paths are thin)

- **Missing editor and panel error-path tests:**
  - PUT returning 400, 409 or 503, and DELETE partial failure, as seen in the UI.
  - A status load already in flight while Save completes. The guard at `:191` exists but nothing tests it, even though the acceptance table names this case.
  - Unmount or actor change during Save (busy is released at `AgendaWordingDefault.js:17`).
  - Close during initialisation, and a late initialisation response.
- **Missing service tests:**
  - GET during a link outage.
  - Older snapshots.
  - A corrupt stored JSON value.
  - The concurrent-Save leftover (list returns 0 rows, readback finds 2).
  - Partial Clear after at least one row has been removed (non-empty `removed`).
  - The 256kb body limit.
- **Existing tests are meaningful, not decorative.** Examples:
  - The empty-opening "no could-not-be-loaded" check (it would fail under the old `!defaults.message` warning).
  - Triple and malformed tokens.
  - Each drift field at send.
  - Late drift after the activity is created.
  - Duplicates and Clear.

## Contract audit coverage

**Checked and holding [VERIFIED]:**
- **Sender and header provenance:** the sender address comes from `azureEmail` and the actor from `actorRefFromSession`. The body allowlist is checked before `...req.body`, and identity fields are written after it (`agenda.js:55-79`).
- **Original-sender binding:** retained (`:593-596`, `:615-618`).
- **No profile-identity fallback:** confirmed in `actor-ref.js:71-77`, the preference route's GUID gate, and `ownAgendaTemplate(null)` returning `identity_unavailable`.
- **Private preference guards:** the key is in both sets (`user-preferences.js:34`, `:46`), with per-key read and write tests.
- **Validator:**
  - The same validator is used at Admin PUT, shared read, own read and write, and prepare.
  - The regex consumes only exact `{{sessionDate}}`, so triple-brace forms are rejected.
  - Values are re-validated after resolving.
  - The date format is identical to the old resolver.
  - The seed values pass.
- **Shared defaults:** a missing key gives `missing`, and a null shared opening becomes `''`.
- **Raw input resolved from the same snapshot:** `:409-412`.
- **Freshness:** both points before transport (`:627`, `:668`) use the strict reader. Reconciliation runs before freshness, and the full tuple now includes end, zone, location, meeting link, title, number, institution, lead PD and link URL/ID.
- **Strict link reader:** absent, expired or flag-off returns null; a throw or an unreadable token returns 503. It never creates a new link. The general session reader stays fail-open (`session-service.js:347-358`).
- **Duplicates:** full enumeration with a cap check. Save refuses multiple rows and reads back after writing. Clear enumerates, verifies absence and reports what it removed.
- **Async ownership:**
  - The panel is remounted on any session or actor change (`:144-148`).
  - Status loads use their own sequence and no longer abort the operation controller.
  - The editor has its own controller and generation counter.
  - Save/Clear sets the panel lock, and prepare/send disable Save/Clear.
- **Recovery:** an unresolved send reopens frozen and the editor is hidden. Stale or terminal recovery re-reads the current defaults (`:328-338`).

**Not applicable:** schema, migration, cron and seed (none were added). The route matrix, counts and Atlas were updated.

## Residuals

- Whether the briefing feature flag is on in Production is unknown, so the real exposure of finding 3 is unknown.
- Existing Admin agenda copy in Production has not been checked against the new validator. If it fails, staff will see the empty-fields notice instead of shared wording. A read-only check needs authorisation.
- The race between reading the session and transport cannot be closed with Dataverse and is still open, as the plan says.
- Concurrent Save can still create duplicate rows, which are then surfaced as invalid with Clear as the repair; this is as designed.
- `resolveAgendaDefault` (`:178`) no longer has a production caller. Removing it is optional.

## Corrected Opus recheck — verbatim receipt

SLICE6_OPUS_BUILD_RECHECK_2026_10_24

# Slice 6 build recheck: corrected candidate `693e637d1` (original `736df83d3`)

**Verdict: PASS.** All four required fixes and all four recommended fixes are in the current source, and each has a test that exercises it. I found no new problem that should block merge. Three low-severity notes and one test that doesn't actually check its fix are listed below; none needs to be fixed before merge.

## Required fixes

**1. Button styling — fixed.**
- "Send agenda…" now uses `variant={lastAgenda?.sentAt ? 'outline' : 'primary'}` with only `className="mt-4"` (`SessionAgendaPanel.js:475-481`). The colour classes that conflicted are gone.
- Directory rows now use `variant="outline" size="sm"` (`:89`). The outline style is `bg-white text-gray-700` (`Layout.js:494`), so rows no longer render as dark filled buttons.
- Close keeps focus on open: `ComposerDialog` passes `busy={defaultsBusy || (busy && busy !== 'initialize')}` (`:487`). Close is therefore enabled when the dialog first renders, so the focus call at `:115` succeeds. The test checks both `toBeEnabled()` and `toHaveFocus()`.

**2. The status GET during a briefing-link outage — fixed.**
- `getAgendaStatus` turns only `agenda_links_unavailable` into `current = null`; every other error is still thrown (`agenda-service.js:444-447`). It still returns the last receipt, the pending send and the defaults, with `linksUnavailable: true` and `scheduleChanged: null` (`:454-455`).
- Prepare (`:409`) and both send-time freshness checks (`assertAgendaCurrent`, `:533`) still use the strict reader.
- The GET route passes the result through unchanged (`agenda.js:71`). The panel stores the flag and shows an amber notice (`:193`, `:473`); because `scheduleChanged === true` is false, no drift message appears.
- A missing session still returns 404 before the link-read `try` (`session-service.js:342-343`), so it is not hidden as an outage.
- Non-GUID slot IDs are filtered before link lookup (`agenda-service.js:22`), so `computeAgenda:218-223` reports `agenda_slot_invalid`.
- Tests: `meeting-tracker-agenda-service.test.js:752-761` and `agenda-strict-briefing-read.test.js:17-21`.

**3. Older snapshots without a link ID — fixed, on both the status and send paths.**
- `agendaScheduleChanged` drops the current `briefingLinkId` only when the stored slot has no such key (`:303-305`). The briefing URL and every other field are still compared.
- `assertAgendaCurrent` goes through the same function (`:535`), so older prepared and `send_requested` rows are covered too.
- New snapshots always contain the key, so link-ID checking stays strict for them.
- Test `:762-768` covers both cases: no drift when only the ID is missing, drift when the URL changes.

**4. Closing while the composer loads — fixed.**
- `closeComposer` now lets close through when `busy === 'initialize'`. It resets `busy`, increments `openSequence` and cancels the load (`:275-281`).
- The success path (`:248`), the error path (`:254`) and the final step (`:257`) all stop once `openSequence` has changed, so a late response is ignored.
- Escape uses the same `busy` value.
- While loading, the fields stay disabled through `locked`, and Save/Clear are disabled too (`disabled={Boolean(busy)}`).
- Test `meeting-tracker-agenda-panel.test.js:507-519` covers close, the late response and reopening.

## Recommended fixes

**5. Wording-source label — fixed.** `draftDefaults` is set on open (`:240`, `:259`) and on recovery reset (`:353`). Save/Clear only update `defaults` (`:517`). The label and the amber notice read `draftDefaults` (`:490`, `:516`). See the weak-test note below.

**6. Corrupt saved row — fixed.** `JSON.parse` now has its own try and returns `invalid` (`agenda-personalization.js:23-26`). The route turns that into 409 (`agenda-email-preferences.js:26`). Tested.

**7. Default-wording editor feedback — fixed.**
- A `preference_invalid` result now shows "Clear my default to remove duplicate saved wording, then save again." (`AgendaWordingDefault.js:41`). The service returns that reason only when it finds more than one row (`agenda-personalization.js:49`).
- When Save is disabled, the reason appears inline and both fields point to it with `aria-describedby` (`:54-56`). The text matches what the validator checks: one-line subject up to 500 characters, opening up to 20,000, and only the `{{sessionDate}}` placeholder.
- Tests cover 400, 409, 503 and a partial Clear.

**8. A hidden preview coming back already confirmed — fixed.**
- An effect on `currentScheduleKey` and `pendingSend?.operationId` (`:215-220`) clears `confirmed`. It also drops the preview unless that preview was already sent or belongs to the unresolved send.
- I traced the prepare, unresolved-send, unconfirmed-send, successful-send and stale/terminal outcomes; each keeps or clears the preview correctly.
- The test now changes the schedule back and asserts that Send is still absent (`:503-504`).

## Test gaps from the first review
- **Now covered:** close during initialisation, a late initialisation response, a status load overlapping Save, actor change and unmount during Save, every editor error result, partial Clear with a non-empty `removed` list, the concurrent-Save duplicate (two rows → `persistence_unconfirmed`, never success), the link outage, older snapshots, corrupt JSON and the invalid-GUID slot path.
- **Still not covered:** the 256kb body-limit check, and rendering of the `linksUnavailable` notice in the panel. Neither blocks merge.
- **Duplicates stay truthful through the whole flow:**
  - A concurrent Save returns "could not be confirmed. Reload…".
  - Reloading returns 409 with status `invalid`, and the Clear option appears.
  - Saving again returns `preference_invalid` with the "Clear my default" message.
  - A partial Clear never claims success.

## New observations (none block merge)
1. **Low — copy:** `SessionAgendaPanel.js:490`. If the cached defaults are empty (after a failed status load), the "could not be loaded" notice shows during "Loading current wording…" before the fresh read finishes. Optional fix: add `busy !== 'initialize'` to the condition.
2. **Test doesn't check fix 5:** `meeting-tracker-agenda-panel.test.js:478` asserts "Started from your saved wording", but that draft was already personal when it opened. The old code would pass it too. A test that checks the fix would open with shared wording, Save a personal default, and assert "Started from shared wording".
3. **Cosmetic:** the directory rows' `className` still conflicts with the Button's built-in classes. Vertical alignment and vertical padding come out as `items-center` and `py-2` rather than the row's `items-start` and `p-3`, and the email line inherits `font-semibold`. It looks fine; this is just leftover cleanup. The main button also grows to the default `md` size, which is the shared Button's standard.

## Testing and limits
- This was a read-only source and test review using Read, Grep and Glob. I ran no tests, build, lint or gates, and made no live, Dataverse, mail or Production checks.
- The pass counts you gave (192 tests in 12 focused suites; the earlier isolated full run) are yours, not mine.
- The corrected full suite and the production build are not verified here, so they are not counted as passed.
- I did not check that the review fingerprint is unchanged; that is left to you.
- **Residuals that still apply:**
  - The race between reading the session and sending to Dataverse is still open.
  - Concurrent Save can still create duplicate rows. Detection and repair are truthful.
  - Whether the briefing flag is on in Production is unknown.
  - Production Admin agenda copy has not been checked against the new validator.
  - `resolveAgendaDefault` is still unused.
