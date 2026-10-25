---
title: Personal defaults for deliberation-distribution emails
domain: workbench
kind: plan
status: draft
summary: "Draft slice 7: own-sender subject/message defaults before the existing frozen distribution preview, with explicit future-only Save/Clear, strict owner isolation and bounded recovery. Owner selected non-empty messages and fresh reopen with discard warning; revised for Claude findings; independent re-review pending. No implementation authorized."
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
planned requirements, not implemented behavior. The first independent review returned named changes. This revision addresses
them; independent re-review is pending before any coding (see §9).

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
6. **Fresh ordinary reopen (owner-confirmed).** A new ordinary open fetches
   current defaults and reseeds recipients. Close buttons and Escape go through
   one guarded close handler. Edited To/Cc/subject/message or unsaved default
   editor text produces an inline discard confirmation within the existing
   dialog: **Keep editing** / **Discard edits and close**. Cancel or Escape while
   that confirmation is shown returns to editing, without changing the form,
   preview or confirmation. Only confirmed discard clears edits. An unchanged
   draft closes without a warning. Successfully saved default-editor text is no
   longer unsaved; changed one-send text remains dirty independently.
   Background regeneration, source changes and temporary panel ineligibility
   pause actions and retain edits instead of forcing a discard; §4D specifies
   lifecycle ownership. No silent forced-close exception is adopted.
7. **An issued send remains unresolved until positively resolved.** Just before
   posting Send, record an actor/request-scoped local recovery envelope containing
   the original operation/hash, frozen preview, sender and compose snapshot. Keep
   it until that same operation returns `transportAccepted === true` or satisfies
   the exact no-activity proof below. HTTP success
   alone, a Failed label, an error code or absence of a client receipt never
   clears it. There is deliberately **no error-code allowlist** for resetting an
   issued attempt in this slice: stale/identity errors on later retries do not
   prove an earlier call never transported. `persist_failed`, `lease_lost`, network,
   unknown 5xx and in-progress outcomes all retain the envelope.
   Reopen and Resend resume that envelope rather than initialize a new compose;
   block Create preview/new-operation actions and editable one-send fields while
   it exists. Close hides the recovery view without discarding its frozen state.
   Unsaved default-editor edits still require the discard warning; their discard
   never discards the envelope. Retry uses only the original operation/hash and
   actor. If neither exact retry nor the no-activity proof resolves it, show an actionable
   reconcile-the-original-email notice; do not unlock a new send. This is a
   conservative client policy, not a new transport or recovery API.
   **No-activity proof:** keep an attempt-local ledger of all issued Send calls.
   Release an unsent envelope only after every call for it has settled with a
   complete, structurally valid server response and none ever had a network
   rejection, abort, unreadable/malformed response, in-progress or unconfirmed
   outcome. This uncertainty latch is permanent for that envelope. Then fetch
   history freshly (no browser cache); the exact request/operation row must be
   present with `transportAccepted === false`, `dynamicsEmailId === null` and
   `sendRequestedAt === null`, with all three fields explicitly present. Missing
   row/fields, failed history, a pending call or any earlier uncertainty retains
   the envelope. This is evidence of no transport because send persists the email
   ID before send intent/transport; it is not an error-code allowlist. On proof,
   clear envelope/preview/confirmation, preserve editable wording/recipients and
   show the relevant refused/stale notice. Allow an explicit new preview, never
   create one or send automatically. Test first-call stale refusal and
   regeneration-refusal → later stale refusal; both can recover when proof holds.
   The envelope is memory-only. An intentional page/request departure warns of
   losing local retry state before allowing navigation; after an actual page
   reload/unmount no attempt is automatically rehydrated. Current history may
   show an unconfirmed attempt as Failed and offer Resend as a new compose. That
   pre-existing cross-page duplicate-send gap remains explicit, not solved by
   personal defaults. Session/actor replacement must never expose the prior
   actor's envelope to a different user; see §4D.
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
  history responses. Replace the existing seven-setting aggregate compose notice
  with the new pair-specific source/status notice. Omit briefing-copy status from
  compose in this slice; prepare still reads and freezes all five fields and the
  exact preview shows their resulting content. Keep history DTO unchanged.
  Resolve `{{requestNumber}}` using current request props;
  keep raw future templates in separate state.
- Add a small family editor such as
  `shared/components/workbench/DistributionWordingDefault.js`, patterned on the
  agenda editor. Reuse established layout controls, not its optional-body/token
  validator. Prefer local family code over changing every sibling editor.
- Separate generations/controllers for history, compose initialization and
  preference editing, and **separate prepare, send and link-reissue lanes**.
  Section 4D defines their owner and invalidation rules. Source/history changes
  must not abort Send, discard its response or leave its busy flag stuck. Gate
  send/envelope responses and finally cleanup by exact operation + stable actor
  scope + send-call token, not the history/source generation. A late accepted
  receipt resolves its original envelope even after a source change; it cannot
  rebase the current source's compose or sent flag. Prepare/reissue keep their
  own source/request generation checks. Test source change during Send, including
  a history reload, then accepted/error/finally results.
  A profile-context refresh is only a client invalidation signal, never the
  authority for the stored owner.
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

### D. Explicit client lifecycle ownership

All changes here are [PLANNED]; existing server/store/send contracts stay intact.

**Owner and open signal.** `StaffDeliberationsTab` owns a monotonically increasing
`composeOpenVersion`, advanced by every Share/Resend/open action. The panel consumes
it once, including its first eligible open. Ordinary versions start a fresh draft;
versions received while a recovery envelope exists only reveal that envelope.
Do not derive an open solely from component mount or a changed recipients array.
Inline compatibility mode initializes once per scope; it does not invent repeated
opens during renders.

**Retention signal.** Panel reports
`onRetentionChange({ draftDirty, editorDirty, mutationPending, recoveryPending })`
to `StaffDeliberationsTab`. Parent retains the panel when any flag or `composerOpen`
is true; initial new-Share eligibility is still checked separately. Reset this
signal on actual scope teardown, not on background source pause. The navigation
hook lives inside the retained panel, so no page-level guard registration is needed.

**Keep the same request/actor panel alive.** Replace the artifact-keyed remount
with a stable request + confirmed authenticated sender key. After its first eligible mount,
keep the panel mounted while it has an open/dirty draft, pending preference
mutation or recovery envelope, even when `showDistributionPanel` becomes false.
The original condition still controls new-Share eligibility and public record
cards, not ownership of pending draft state. Replace the parent's unconditional
regeneration force-close with a `sourceUnavailable`/`sourceChanged` pause signal.
A source/artifact change explicitly increments the source/history generation,
reloads source-scoped history, clears the parent's cached current-source sent flag,
and invalidates ordinary preview/confirmation/acknowledgement without discarding
text or unsaved default-editor edits. This replaces the old remount's freshness
purpose; test it rather than simply deleting the key. No preparing or new sending
from a stale source. An issued envelope remains frozen; its exact server retry
may reconcile an already accepted send, and otherwise remains unresolved unless §3.7's complete-response/no-activity proof
permits an explicit new preview. Never rewrite its original source identity.

**Ordinary reset and dirty baseline.** On an approved ordinary open reset
`seenSeed`, `autoOwnedRef`, `composerTouchedRef`, preview, confirmed, staleInputs,
error, notice, sendFeedback, recipient-picker state, editor disclosure/read state
and all corresponding generations/busy flags. Reapply current To/Cc suggestions
even when their value did not change. Fetch fresh raw defaults and render the
subject for this request. Baseline is the loaded wording plus latest auto-filled
recipient values. A later automatic recipient fill updates only baseline fields
still auto-owned; it does not make the draft dirty, and it never changes a
staff-owned field or its baseline. Compare actual current editable values against
that baseline; returning to the baseline removes dirty state. Track editor dirty
state separately against the last verified loaded/saved template. Saving a future
default does not change the current compose baseline.

**Close-path matrix.**

| Path | Required behavior |
| --- | --- |
| Header/footer Close; outer Escape | Same guarded handler; inline discard confirmation if dirty. While recipient picker is open, its Escape closes only the picker. Busy preference/prepare/send blocks close without showing discard. Escape within discard confirmation means Keep editing. |
| Issued-send recovery view Close/Resend | Preserve envelope and one-send values; only unsaved future-editor text may require a discard choice. Resend never increments a new attempt or rebases wording. |
| Regeneration discovered; artifact replaced; eligibility becomes false | Keep draft/editor/envelope mounted. Pause new actions and show why. Offer the same guarded close/discard choice. No reset or silent discard from a status refresh. |
| User switches tab/request or follows another in-app route | Panel-local route guard runs before unmount. Dirty draft/editor: confirm discard or cancel navigation. Issued envelope: warn that navigation loses local exact-retry state and that the original email must be reconciled; cancel keeps it. Confirmed departure may clear memory, never send or auto-retry. |
| Browser reload/close | Install `beforeunload` only while unsaved edits, an unresolved mutation or envelope needs retention; use browser-provided warning. The browser may suppress it; crashes/forced browser termination have no preservation guarantee. No new storage persistence. |
| Session expires or authenticated actor changes | Immediately disable actions and invalidate async updates. Do not render old content to the new actor; clear old actor memory. Where the old authorized session is still present, warn before user-triggered departure/logout. External revocation/replacement cannot be vetoed and is not permission to reveal content or retry as the new user. |

**Concrete navigation mechanism.** Add a family-local hook, for example
`shared/components/workbench/useDistributionUnsavedChanges.js`, using the existing
`shared/components/board-writeups/useBoardUnsavedChanges.js` as the source-backed
pattern; do not refactor or import the Board-specific wording into this family.
Register it in the retained panel while dirty, mutation-pending or recovery-pending.
It uses `routeChangeStart` to emit `routeChangeError` and throw an error marked
`cancelled`, `beforePopState` to restore the edited URL/history state on cancelled
Back, and conditional `beforeunload`. Destination-scoped approval prevents a
second prompt, then clears on route complete/error. Remove event listeners and
reset `beforePopState(() => true)` on cleanup; Next exposes no public getter to
restore a previous callback. Check for competing registrants before implementation.
Shallow tab pushes must pass through this hook. In request-page `selectTab`, catch
only the expected `cancelled` rejection; surface unrelated navigation failures.
Never rely on unmount cleanup to cancel an already committed route.

Add a fixture-backed Playwright spec under `tests/e2e/` using the real Pages router
and mocked auth/data, with no external writes. It must prove: cancelled shallow
tab click preserves URL/state; cancelled Layout Link does the same; cancelled
Back restores URL/state; confirmed navigation happens once with one prompt.
Include dirty-editor, pending-mutation and recovery wording in unit tests.
Mocked-router Jest tests alone are not browser compatibility evidence. The browser
spec is a planned implementation gate, not a claim of proof in this document.

**Actor identity and mutations.** Read `useSession`; the stable scope is request ID,
confirmed Dynamics system-user ID and normalized sending email. **Do not key by
transient auth status.** Before initial authentication, do not mount editable
personal content. After first authenticated mount, `loading` pauses/hides sensitive
UI and disables actions without remounting or dropping the envelope. Resume the
same mounted scope if the same confirmed sender returns. Real authenticated
identity/email replacement or unauthenticated status invalidates old memory before
rendering another actor. Server send still checks the exact stored email and ID. `pages/api/auth/[...nextauth].js` supplies
the system ID to staff sessions; server session identity still owns every write.
Use panel-owned preference request/result/dirty state; the dialog editor is a
view, so a source pause or dialog hide does not cancel the result. A confirmed
Save/Clear result remains confirmed if a later defaults refresh fails. A request
that may have committed without a response sets a scoped **Reload to confirm**
state, disables repeated mutation and forces a strict read before the next edit.
After any actual owner/request unmount or interrupted mutation, the next editor
open performs that strict read; it never assumes a previous abort rolled back.
No cross-actor draft stash, session storage or localStorage is introduced.

## 5. Expected file surface

[PLANNED; final implementation review may narrow it further.]

| Surface | Expected change |
| --- | --- |
| `shared/config/reviewerFinderPreferences.js`, `deliberationShareEmail.js` | One reserved key; family raw-pair validator |
| Proposed family service and preference route | Exact-owner GET/Save/Clear and effective raw defaults |
| `pages/api/user-preferences.js` | Both privacy/validation bypass guards |
| `PreSiteDistributionPanel.js`, proposed default editor | Panel-owned draft/mutation/recovery state, raw defaults and guarded close |
| `StaffDeliberationsTab.js` | Explicit open version, retention callback, retained paused panel and source refresh |
| Proposed family-local navigation hook; `pages/workbench/[requestId].js` | Board-pattern guard inside panel; expected navigation-cancellation catch in `selectTab` only |
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
| Confirmed mutations | Exact readback, create/update errors, lost response, duplicate first-Save race, partial duplicate Clear, repeated Clear, independent post-write read failure; source pause/hide during Save/Clear retains outcome; interrupted actual unmount requires strict read before another write |
| Future-only actions | Save/Clear/deferred editor loads leave form, recipients, preview/hash and confirmation unchanged; no prepare/link/lock/send callback calls |
| Lifecycle | Explicit open versions; unchanged suggestions reseed; late autofill does not mark dirty; close/escape/picker/inline confirmation; forced source change retains edits; new artifact history/sent flag refreshes; actual tab/router/back cancel/confirm; one prompt; browser warning cleanup; transient auth loading retains scope while real actor change clears it; late success/error/finally |
| Frozen recovery | For persist_failed, lease_lost, network rejection, in-progress and unknown 5xx: Send → Close → Resend preserves operation/hash/sender/wording; later stale/403 error cannot clear earlier uncertainty; only exact acceptance or complete-response + fresh no-activity proof clears it; prior uncertainty permanently blocks proof; editor discard preserves envelope; intentional departure warns; no auto-rehydration after reload |
| Content/transport authority | Generated session/link/bundle/expiry survives arbitrary wording; To/Cc one-send; HTML escaping; existing stale-refusal new-preview scenario remains recoverable after added proof history read (extend fixture); accepted-send tests remain green |
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

Verdict: **REVISED FOR INDEPENDENT RE-REVIEW — NOT IMPLEMENTATION APPROVAL.**
Owner choices remain unchanged. Required review findings have concrete proposed
contracts in §§3–4D and acceptance cases in §7; none are implemented. Live
permission proof, visual validation and independent implementation review remain
future obligations.

## 9. Independent review disposition — 2026-10-25

[VERIFIED via first read-only OAuth Claude review.] Reviewed HEAD `f3d9a908c`;
original plan SHA256 `144bdf426152e5fa7bc8bd5bd4d267538ee31892d3334ef603cc4b1108bc0e00`.
Historical full report: `docs/audits/DISTRIBUTION_DEFAULTS_PLAN_CLAUDE_REVIEW_2026-10-25.md`.
First verdict: READY WITH NAMED CHANGES. Claude ran nine existing suites / 345
tests successfully; baseline compatibility is not proof of planned behavior.

| Finding | Resolution specified in this revision (PLANNED) |
| --- | --- |
| H1 — exact unresolved-send rule | §3.7 retains an issued-operation envelope until exact acceptance or an uncertainty-free fresh no-activity proof; no error-code reset allowlist; ordinary reopen bypassed; explicit tests for persistence/lease/network/unknown errors and later retries |
| M1 — reopen/reset ownership | §4D names parent open version, complete reset, value-independent recipient reseeding, separate auto-fill and staff dirty baselines, parent/page file surface and tests |
| M2 — close paths and mutation outcomes | §4D lists all paths, chooses inline modal confirmation, retains drafts during forced source pauses and removes artifact/eligibility teardown of owned state; navigation warns before discard; panel owns mutation outcome |
| L1 — actor scope | §4D names useSession/client key, verified server session projection and privacy-first invalidation; no retry under another actor |
| L2 — historical recovery limit | §3.7 explicitly retains the existing Failed/Resend-after-reload gap, not an assumed warning or cross-page recovery implementation |
| L3 — fallback notice source | §4B replaces aggregate compose notice with pair-specific status and omits briefing-only compose status; history DTO and server frozen generated copy remain unchanged |

Silent discard on forced lifecycle transitions is not adopted. The owner-required
warning remains for voluntary discard; same-actor/request background source
transitions preserve text and pause actions instead. Browser termination and
external authentication revocation have explicit limits rather than a false
preservation promise. No database, runtime, release or live action is authorized.

### Second review and final-recheck target

[VERIFIED via read-only OAuth Claude re-review of `85ad11acf`, plan SHA256
`1dd0610427ea3ee5ee849e8f3580b3a19503fef055cec84a92e11b9b72f5a89b`.]
Claude confirmed the six original findings addressed in substance, with owner
choices intact. It returned READY WITH NAMED CHANGES for four refinements. No
new tests or live operations were run. Historical full report:
`docs/audits/DISTRIBUTION_DEFAULTS_PLAN_CLAUDE_REREVIEW_2026-10-25.md`.

| Refinement | Contract in this final-recheck revision (PLANNED) |
| --- | --- |
| N1 — avoid trapping provably unsent attempts | §3.7 selects source-backed no-activity proof, not an owner escape: all calls terminal/complete with no uncertainty ever, then fresh exact-row explicit null ID/intent and false acceptance. Stale-refusal baseline fixture gains the proof read; no automatic new send. |
| N2 — navigation signal/mechanism/proof | §4D names panel retention callback, family-local Board-pattern hook, allow-all cleanup, expected cancellation catch and real-router mocked-data Playwright gate. |
| N3 — transient auth scope | §4D excludes status from mount key; loading pauses an existing confirmed sender without remount; actual identity replacement clears old private state. |
| N4 — async request lanes | §4B names history/init/preferences/prepare/send/reissue separately; exact operation/actor/call gates send result and finally; source change cannot cancel or erase it. |

Independent final recheck of these refinements is pending before coding.
