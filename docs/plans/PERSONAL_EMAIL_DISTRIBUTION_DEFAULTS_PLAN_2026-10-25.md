---
title: Personal defaults for deliberation-distribution emails
domain: workbench
kind: plan
status: draft
summary: "Draft slice 7: own-sender subject/message defaults before the existing frozen distribution preview, with explicit future-only Save/Clear, strict owner isolation and bounded recovery. Owner selected non-empty messages and fresh reopen with discard warning; independent plan review pending. No implementation authorized."
owner: product-engineering
related:
  - docs/plans/PERSONAL_EMAIL_DEFAULTS_TODO_2026-09-20.md
  - docs/plans/PERSONAL_EMAIL_DEFAULTS_INVENTORY_2026-09-24.md
  - docs/plans/PERSONAL_EMAIL_MEETING_AGENDA_DEFAULTS_PLAN_2026-10-24.md
  - docs/API_ROUTE_SECURITY_MATRIX.md
  - docs/APPLICATION_STATE_ATLAS.md
---

# Personal defaults for deliberation-distribution emails — draft

## Status and boundary

[PLANNED — owner requested flow review and a bounded plan, 2026-10-25.]
This is inventory slice 7, not the earlier conversation's option number. Plan
branch: `codex/distribution-email-defaults-plan`, based on `1bb87c418`.
No runtime changes, preference writes, schema probes, migrations, seeds, sends,
environment edits or deployments are authorized by this planning task. Claude
owns separate database work; its checkout and live operations remain untouched.
The owner confirmed both §3 choices on 2026-10-25: keep non-empty messages
and reopen with fresh defaults, warning before discarding edits. These are
planned requirements, not implemented behavior. Independent plan review is
required before any coding.

Source and mocked tests establish the baseline below. Live preference contents,
duplicate-row prevalence and tenant permissions were not probed. No claim of
current Production configuration or live delivery is made by this plan.

## 1. Job and audience

[PLANNED.] Staff with the existing `reviewers` app access can save their own
reusable subject and introductory message for **Share for the deliberation
session**. A new email starts with that sender's wording, remains editable for
one send, and still requires the existing frozen preview and explicit confirmation.
This is an Operate surface: preserve the established desktop density, dialog,
recipient picker, control hierarchy and wording pattern. No terminology redesign.

## 2. Current flow and evidence

[VERIFIED via source inspection at the branch base and the baseline test command
in §7.] File references below name the logical regions inspected; future code
must be re-read rather than trusting these as immutable line offsets.

| Hop / fact | Producer, persistence and consumer | Evidence |
| --- | --- | --- |
| Entry and lifecycle | `StaffDeliberationsTab` opens a dialog while keeping the panel mounted as `hidden` after Close. Request + current brief artifact form the panel's React key; merely reopening does not remount it. | `shared/components/workbench/StaffDeliberationsTab.js`, `openComposer` and `PreSiteDistributionPanel` invocation |
| Initial wording | Panel starts from code seeds, then its history response seeds shared wording once per request only if `composerTouchedRef` is false. Any field edit marks the entire composer touched. No personal preference read is on this path. | `shared/components/workbench/PreSiteDistributionPanel.js`, form initialization, `loadHistory`, `edit`; `lib/services/pre-site-visit/distribution/history.js` |
| Shared fallback | Two subject/message and five briefing-copy settings are read independently. Blank or failed reads use code fallback. Aggregate `configured`/`unavailable` currently combines all seven, so it cannot describe only the personalizable pair. | `lib/services/pre-site-visit/distribution/context.js`, `readDeliberationShareDefault` / `readDeliberationShareDefaults`; `shared/config/deliberationShareEmail.js`; `shared/config/editableTextDefaults.js` |
| Raw versus rendered | `{{requestNumber}}` is substituted in the subject when initializing compose. Body is plain text, HTML-escaped by the server. Generated session details and briefing/review-bundle link sections are appended separately. | `renderDeliberationShareSubject`; `lib/services/pre-site-visit/distribution/composition.js`, `distributionBodyHtml` |
| Editable one-send draft | To/Cc are editable and directory-assisted, with attendees/site-visit suggestions. Subject and message are editable. Field changes invalidate preview, confirmation and stale-input acknowledgement. The UI fixes calendar inclusion off and offers no material/brief attachment selection. | Panel `applyFormPatch`, recipient-seeding ownership, composer controls; parent recipient props |
| Prepare — not read-only | App gate is `requireAppAccess('reviewers')`; sender email and Dynamics system ID come from session. Exact body allowlist excludes client identity. Service validates recipient/subject/body, current brief and input drift, then can mint/bind a briefing link, create a PG attempt and retain SharePoint/Dataverse snapshots and the review bundle. | `pages/api/workbench/pre-site-visit/distribution/prepare.js`; `distribution/prepare.js` and `composition.js` |
| Frozen preview | `pre_site_distribution_attempts` stores actual subject/body/recipients/sender, source and extension snapshots. Hashes bind actual reviewed wording and generated copy. | `distribution/prepare.js`, draft/preview hashes; `distribution/model.js`, `projectDistributionAttempt`; `docs/atlas/postgres-infra-tables.md`, distribution section |
| Send / recovery | Only request ID, operation ID and preview hash are posted. Server reloads the attempt, checks exact sender, claims a lease, rechecks current source/extensions, and creates/recovers a correlation-bound Dynamics activity. Already accepted send retries return the same receipt. No template is re-rendered from a personal preference at send. | `pages/api/workbench/pre-site-visit/distribution/send.js`; `distribution/send.js` |
| Existing preference substrate | Existing Dataverse `wmkf_appuserpreferences` stores owner/key/value rows. Complete exact-owner/key enumeration detects duplicates. The old broad reader instead turns errors into `{}` and must not establish confirmed absence for this slice. | `lib/dataverse/adapters/user-preference.js`; `lib/services/dataverse-prefs-service.js`; Atlas `user_preferences` section |
| Usable sibling precedent | Agenda personalization uses exact session system-user identity, strict owner/key enumeration, validated raw pairs, Save readback and duplicate-aware Clear. Its editor keeps future wording independent from one-send form. Its optional body and session-date token rules differ from this family. | `pages/api/meeting-tracker/agenda-email-preferences.js`; `lib/services/meeting-tracker/agenda-personalization.js`; `shared/components/meeting-tracker/AgendaWordingDefault.js` |

[VERIFIED via bounded symbol/caller search.] Existing registry, distribution
leaves, panel and relevant routes contain no distribution-specific personal key
or preference route. New names below are proposed, not installed infrastructure.
Some Atlas/route-matrix entries retain older deployment descriptions; this plan
uses current source for flow claims and does not broaden into their historical
status reconciliation.

## 3. Product contract — owner choices recorded, review before coding

All items here are [PLANNED], not implemented behavior. Items 2 and 6 include
explicit owner decisions; the remaining implementation proposals await review.

1. **Save only subject and message.** A personal pair belongs to the actual
   authenticated sender, applies across requests, and is distinct from agenda,
   reviewer and other email families. Do not store To/Cc, request numbers, links,
   session data, generated briefing copy, signatures or attachment choices as
   separate preference fields. Text may contain a staff-written closing; this
   slice does not introduce a signature service.
2. **Preserve the current non-empty message rule (owner-confirmed).** Keep
   nonblank subject and message for both saved defaults and one-send compose.
   Existing compose validation requires them; optional/empty bodies would be a
   separate product change. Clear means remove the override, never save an empty
   pair. Keep subject maximum 500 characters and message maximum 20,000.
3. **Raw template editor, separate from current email.** Add the collapsed
   **Your default wording** disclosure below Message. Fields: **Default subject**
   and **Default message**. Actions: **Save as my default**, **Clear my default**,
   and local retry. Explain: “Used for future emails. The current email is
   unchanged.” Save raw `{{requestNumber}}` only in subject; no message tokens.
   Reject unknown/malformed/doubled-extra-brace placeholders in personal pairs.
   Render the raw subject for the current request only when creating a new
   compose; never infer a reusable template by reversing a rendered number.
4. **Precedence and visible fallback.** Valid personal pair → available shared
   values (with the existing per-field built-in fallback) → built-in seeds.
   Personal absence, invalid/duplicate/encrypted data, failed read and missing
   identity are distinct states. Warn on failed/invalid reads and identify the
   actual source. Personal fallback never performs a write. Keep the five
   Admin-owned briefing-copy fields separate from the subject/message source
   notice; a briefing-copy outage must not claim the personal pair is absent.
5. **Future-only writes.** Loading/editing/saving/clearing defaults must not
   change an open one-send form, recipients, prepared preview, confirmation,
   operation ID, stale-input acknowledgement or recovery snapshot. Success
   notices require a confirmed write; a read-after-write failure cannot relabel
   a confirmed write as failed, nor can an uncertain write be reported saved.
6. **Fresh ordinary reopen (owner-confirmed).** Each ordinary new compose
   fetches current defaults and reseeds recipient suggestions, clearing prior
   preview/confirmation/acknowledgement. Before Close/Escape or another local
   dismissal would discard edited one-send To/Cc/subject/message or unsaved
   default-editor text, show a discard warning. Cancel keeps the dialog, edits,
   preview and confirmation unchanged; confirm discards the unsent edits and
   closes. The next ordinary open loads fresh defaults. Compare edits with the
   loaded/seeded baseline, not simply whether an input ever received an event;
   successfully saved editor text is no longer unsaved. Keep this warning out
   of busy/blocked-close paths. Requirement 7 takes precedence for unresolved
   sends: dismissing their view does not discard or rebase their recovery state.
7. **Unresolved sends are an exception to new-compose refresh.** Never rebase
   locally pending, transport-unconfirmed or in-progress sends onto new defaults.
   Keep their original sender, wording, recipients, operation and preview hash;
   retry/reconcile that same attempt through the existing send route. A defaults
   save/clear cannot convert recovery into a new send. Preserve history warnings
   after full page reload; this slice does not promise new recovery persistence
   or automatic rehydration of historical attempts. Lost prepare responses and
   broader duplicate-send prevention remain existing residuals.
8. **Preserve content authority.** User wording remains an introduction. Session
   facts, generated briefing/review-bundle sections, expiry, URLs, current brief,
   snapshot files and hashes stay server-owned and are reviewed in the existing
   exact preview. To/Cc remain one-send staff choices validated by the server;
   they are not immutable server-selected recipients and are never defaults.

## 4. Bounded implementation outline — not authorization

[PLANNED.] Build one family rather than a suite-wide preference abstraction.

### A. Personal contract and exact-owner API

- Proposed key: `PREFERENCE_KEYS.DELIBERATION_SHARE_TEMPLATE` with storage value
  `deliberation_share_template`, JSON `{ subject, body }`. Add it to both
  `RESERVED_WRITE_KEYS` and `PRIVATE_REMINDER_KEYS` in `pages/api/user-preferences.js`.
  Test single-key and all-key GET plus generic POST/DELETE denial. No profile
  remapping, localStorage fallback, caller-selected key or sender selector.
- Proposed route: `/api/workbench/pre-site-visit/distribution/email-preferences`
  with GET / PUT `{ template }` / DELETE `{}`. Require the existing `reviewers`
  app gate, session-derived GUID owner (`actorRefFromSession`), `withDalContext`,
  exact query/body validation and `Cache-Control: private, no-store`. No tracker
  schema flag borrowed from the agenda family. No request ID is needed to manage
  a sender-wide template. Missing Dynamics identity disables preference access;
  existing prepare/send identity guards continue to apply independently.
- Proposed family service: `lib/services/pre-site-visit/distribution-personalization.js`.
  Use the existing DAL's complete `listByOwnerAndKey`, create/update/remove.
  GET distinguishes zero, one valid, malformed/encrypted and duplicate rows;
  read failure is never absence. For PUT enumerate afresh, reject duplicates,
  validate pair, write only exact-owner rows and read back the exact raw value.
  For DELETE enumerate/remove only that owner/key, then verify no rows remain.
  A partial Clear or lost response is unconfirmed and requires reload; do not
  automatically retry a possibly committed create. No schema uniqueness claim.
- Proposed validator beside `shared/config/deliberationShareEmail.js`: strings
  only, exact pair shape, raw/resolved subject bounds and no CR/LF, nonblank
  message ≤20,000, subject-only exact `{{requestNumber}}`. Retain existing literal
  one-send text semantics; do not impose unrelated token policies on Admin or
  other families. Parser cap 256 KB covers two bounded Unicode/JSON-escaped
  fields; test the worst-size payload and reject larger input before writes.
- Read the shared composer pair through the existing strict setting read/fallback
  semantics without treating the seven-field aggregate as pair status. Proposed
  response includes raw own/shared/effective pair, `ownStatus`, per-field shared
  status, `source`, `configured`, `canSave` and `canClear`. Define these explicitly:
  `configured` only means one validated saved row; duplicate/malformed rows get
  repair status, not a misleading configured template. Invalid single rows may
  be replaced or cleared; duplicates require Clear before Save; unavailable
  enumeration permits neither write in the UI. Revalidate in each mutation.
  If shared text violates this family's existing compose bounds, use valid
  built-in seed fields with a visible invalid-shared notice. No shared write.

### B. Compose initialization and default editor

- Keep history's shared read/DTO backwards compatible. Move this panel's wording
  initialization to the new own endpoint; eliminate the competing history seed
  so it cannot overwrite personal wording. No preference data added to shared
  history responses. Resolve `{{requestNumber}}` using current request props;
  keep raw future templates in separate state.
- Add a small family editor such as
  `shared/components/workbench/DistributionWordingDefault.js`, patterned on the
  agenda editor. Reuse established layout controls, not its optional-body/token
  validator. Prefer local family code over changing every sibling editor.
- Separate generations/controllers for history, compose initialization and
  preference editing. Key personal state by authenticated actor, request, current
  source artifact and compose generation. A profile-context refresh is only a
  client invalidation signal, never the authority for the stored owner.
- Init must finish or expose an explicit visible fallback before preview. A late
  load must not overwrite staff edits (including To/Cc edits), newer Save/Clear,
  source/request/actor changes, an already prepared preview or a pending send.
  Reopening/future-draft cache must refetch rather than trust old loaded defaults.
  Disable new preview/send/Close during preference mutation, and default writes
  during prepare/send; keep busy cleanup local to its generation. Aborting an
  HTTP request does not prove a preference mutation rolled back.
- Defaults actions never call `beforePrepare`, prepare/send, link mint/reissue,
  document locking, snapshot generation or transport. Check this with negative
  tests that actually provide all of those callbacks and eligible fixtures.

### C. Frozen-preview compatibility

- Leave distribution store/schema and transport/recovery orchestration intact.
  Prepare still receives fully resolved, staff-editable subject/body. Send still
  receives only the exact operation/hash and reads stored wording. A default
  change after preview is allowed because it does not change that preview.
- No send-time personal lookup, hash-template revision field, new migration,
  background sweep, recipient persistence or shared-setting reseed is needed.
  Regression-test source/session/link freshness and existing sent/unconfirmed
  retry outcomes. Broad freshness/recovery redesign is outside this slice.

## 5. Expected file surface

[PLANNED; final implementation review may narrow it further.]

| Surface | Expected change |
| --- | --- |
| `shared/config/reviewerFinderPreferences.js`, `deliberationShareEmail.js` | One reserved key; family raw-pair validator |
| Proposed family service and preference route | Exact-owner GET/Save/Clear and effective raw defaults |
| `pages/api/user-preferences.js` | Both privacy/validation bypass guards |
| `PreSiteDistributionPanel.js`, proposed default editor | Separate raw defaults, compose initialization, reopen and async behavior |
| Focused tests | Contract, identity/isolation, mutations, UI, races and frozen-send compatibility |
| Route matrix, Atlas, service catalog and personal-default inventory/TODO | Add the new surface only when implemented; no claim that the route exists now |

Existing `prepare.js`, `send.js`, ledger, retained-snapshot and briefing-link
services are compatibility-test targets, not planned rewrite targets. If the
implementation needs to change those contracts or schema, stop and revise scope
before coding them. Root instructions, other email families, calendar updates,
J27 decisions and Claude's database surfaces are outside this slice.

## 6. Contract-reconcile audits and remaining risks

[VERIFIED baseline; PLANNED acceptance rules.]

- **Whole flow:** caller → editable compose → authenticated prepare → retained
  attempt/snapshots → fixed preview → exact send → history/UI traced in §2.
  New preference read/write/consumer path is separately specified in §4A–B.
- **Partial success:** one template pair is the Save unit; Clear can partly
  remove duplicate rows and must remain unconfirmed until enumeration proves
  absence. Email outcome is one exact distribution attempt, not a batch result.
- **Async/stale state:** current panel has one shared sequence/controller and
  once-per-request seeding; proposed isolated lanes must not abort sends or
  overwrite current work. Test success, error and finally branches.
- **Helper semantics:** use DAL enumeration and existing shared-setting fallback
  primitives. Do not copy the broad preference reader's error-to-empty behavior,
  agenda optional-body policy, or generic editor DTO assumptions unchanged.
- **Durable surfaces:** existing preference entity and distribution ledger stay
  the stores. Migration N/A under this plan; new route/matrix, key guards,
  source/service catalog and Atlas consumer pointers are implementation tasks.
- **Doc reconciliation:** bounded sweep in §8; unrelated historical deployment
  statements are not adopted as runtime evidence.
- **Symbol fan-out:** proposed key must be searched in both generic guard sets,
  own service and all DTO/source/status consumers. No new persisted enum/column.

Residuals: no atomic unique-key guarantee for simultaneous first Save; duplicate
rows must be detected and repairable, not falsely reported as success. No new
cross-tab edit locking or atomic multi-row Clear. Source/session/link records
are not locked together through transport by this slice. No live preference
permission or tenant-state proof. Unknown send outcomes retain existing limits.

## 7. Verification and execution sequence

[VERIFIED baseline run, 2026-10-25.] Five suites / 180 tests passed:
`pre-site-distribution-panel`, `pre-site-distribution-panel-t5-matrix`,
`pre-site-distribution-service`, `workbench-pre-site-visit-distribution-prepare-route`
and `workbench-pre-site-visit-distribution-send-route` under `tests/unit/`, using
`npm test -- --runInBand` with those explicit files. Mocked dependencies only;
this proves existing behavior, not planned personal defaults or live delivery.

[PLANNED acceptance matrix.]

| Invariant | Discriminating tests |
| --- | --- |
| Exact sender isolation | A cannot read/change B via query/body, generic endpoint, profile remap, missing identity or wrong app grant; response is not public-cacheable |
| Reusable raw wording | Raw subject token survives Save/load; request A/B resolve differently; current email text is never reverse-saved; rendered/raw bounds and malformed tokens |
| Honest fallback | Absent vs unavailable vs invalid/encrypted/duplicate; partial shared config; valid personal over shared outage; briefing-copy status independent; no fallback writes |
| Confirmed mutations | Exact readback, create/update errors, lost response, duplicate first-Save race, partial duplicate Clear, repeated Clear, independent post-write read failure |
| Future-only actions | Save/Clear/deferred editor loads leave form, recipients, preview/hash and confirmation unchanged; no prepare/link/lock/send callback calls |
| Lifecycle | Fresh reopen; discard confirm/cancel via Close/Escape; edited recipients/wording/default-editor text; unchanged drafts do not warn; latest defaults, fresh recipients, source/request/actor switches, unmount, late success/error/finally, concurrent lanes |
| Frozen recovery | Change defaults after prepared/confirmed preview and during unresolved send; original payload/sender/hash retained; exact retry reuses activity; no new default write |
| Content/transport authority | Generated session/link/bundle/expiry survives arbitrary wording; To/Cc one-send; HTML escaping; existing stale-input and transport-acceptance tests remain green |
| Desktop interaction | Keyboard disclosure/labels/focus, busy/validation/notices, desktop density plus zoom/narrow regression; preserve existing dialog |

Execution after independent plan review and coding authorization: (1) strict key/service/API + tests; (2) independent
editor and initialization + race tests; (3) compatibility regression and source
review; (4) bounded visual inspection and independent implementation review.
Run scoped lint/types and affected API-route, route-lifecycle, DAL/context,
privacy/DTO, Atlas and documentation gates with each self-test sequentially.
Confirm relevant CI jobs and a Production-mode build before Tier 2 promotion.
Live preferences/seeds/sends and release require separate task authorization;
prefer fixture/browser mocks for concurrency evidence.

## 8. Bounded planning sweep / recommendation evidence

Sweep mode B, domain: distribution personal-default readiness, source-only.
Authoritative sources: §2 current source and §7 baseline tests. Persisted/live
rows and tenant permissions excluded to keep Claude's live database work isolated.
Durable surfaces searched: personal-default inventory/TODO, Atlas, route matrix,
work queue, agent memory/wiki, session/root guidance, plus distribution/preference
symbols in runtime/tests. Direct slice-7 guidance agrees that this is plan-first;
September case table is explicitly historical. Existing shared-send/recovery
references agree with preserving those seams; other families' status work and
older deployment wording are outside this plan's narrow fact change. Added this
plan and a TODO pointer only. No existing implementation is relabeled shipped.

| Recommendation | Available prerequisite | Evidence tested / disconfirming check | Status |
| --- | --- | --- | --- |
| Apply defaults before prepare | Editable resolved subject/body already posted and frozen | Existing 180-test baseline; prepare/send allowlists and hash inputs inspected; send cannot accept replacement template | VERIFIED prerequisite; feature PLANNED |
| Existing preference entity, no migration expected | Exact-owner/key DAL and agenda readback/Clear precedent | Source/Atlas inspected; duplicate/capped enumeration branches inspected; no live permission probe | VERIFIED source contract; live readiness UNKNOWN |
| Independent future-default editor | Agenda and shared editor patterns exist | Source examined; no distribution editor/route found in bounded search; no new UI rendered | VERIFIED precedent; UX PLANNED |
| Refresh ordinary reopen | Parent keeps panel mounted on Close | Parent/panel lifecycle inspected; fresh reopen is owner-confirmed planned behavior, not current behavior | Owner decision recorded; implementation PLANNED |

Verdict: **DRAFT FOR OWNER REVIEW, NOT IMPLEMENTATION APPROVAL.** The source
review and baseline tests support this bounded approach. Owner choices are recorded. Independent plan review, live permission proof,
visual validation and independent implementation review remain.
