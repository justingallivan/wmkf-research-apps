# D26 ranking — implementation addendum

Session 608, 2026-10-14. **The D26 code candidate and isolated D96 sandbox rehearsal are built on `codex/d26-ranking-release`; no production release or production ranking write has been executed.**
**Earlier plan review (not implementation code review):** Claude Opus 5.5 reviewed
the plan through subscription OAuth and returned READY WITH NAMED CHANGES. Its
follow-up confirmed the original plan findings resolved and named two final
requirements (safe legacy meeting control handle and pre-publication edit refusal).
Both are incorporated below. The initial code review found no high/medium defects
and recommended three low corrections; commit `69578a397` implements them, and
Sol's narrow review found no actionable defect. Opus's final follow-up confirmed
SATISFIED with no blocker. Final source, test, type, lint and build checks passed.
The review record is
`docs/audits/PROPOSAL_RANKING_D26_IMPLEMENTATION_REVIEW_2026-10-14.md`. Plan receipt:
`docs/audits/PROPOSAL_RANKING_D26_OPUS_PLAN_REVIEW_2026-10-14.md`.
This supplements `PROPOSAL_RANKING_D26_RELEASE_2026-10-14.md` on
`origin/codex/ranking-pd-save-conflicts`, inspected at
`886e194ac1b8fb6707a47c59828a3d3d14edc179`. The implementation branch started
from that candidate and integrated local main in merge commit `74040eba5`.
This file lives on main so the continuation is discoverable.

Owner requirements: exactly 23 D26 proposals, excluding 1003223/1003224; Beth and
Justin both facilitate; everybody sees only their own preparation before reveal;
facilitators may see readiness. These decisions are settled. The contracts below
preserve the requirements and the original pre-build plan. Section 6 and §8 are the
current implementation/evidence record; do not read the pre-build requirements or
observations below as proof of current source or live behavior.

## 1. Pre-build source baseline and scope — historical inspection before D26 implementation

The observations in this subsection describe the candidate before the Session 608
implementation. Section 8 records the implemented D26 contract and supersedes
pre-build statements about scalar-only facilitation and facilitator access to
private lists.

[VERIFIED via candidate source] `config.js` reads a scalar default setting;
`preview-service.js` validates that one facilitator. `service.js` owns preview,
opening, legacy actions and Admin settings. `workflow-service.js` loads v2 state,
projects responses and persists reducer changes. Its `publicView` currently returns
all participants via `facilitatorLists`; its loader, reducer call and restart use
the scalar facilitator. `workflow.js` is the pure transition reducer.
`client.js` already retries definite private conflicts only when scope and own
state are unchanged. The route serializes `error.current` directly, so service
error DTOs are part of the privacy boundary.

Source files above are under `lib/services/proposal-ranking/`, except the client
under `shared/components/proposal-ranking/` and route `pages/api/proposal-ranking.js`.
Branch API contract, implementation plan and ranking Atlas describe existing
persistence; use them alongside this addendum. Production state in the release
plan is a dated probe, not current proof.

| Invariant | Implementation seam | Required evidence |
|---|---|---|
| No other person's unrevealed work leaves the service | Response projector, history, errors/readback, supplements | Populated other-person sentinel tests across each response path |
| Exactly the captured facilitator set authorizes shared v2 actions | Config → preview → workflow JSON → reducer/UI | Beth/Justin allow, Jean/John deny; malformed sets fail closed |
| Only the authenticated actor writes their private preparation | Route identity → reducer → list keys/actor stamps | Forged owner input rejected; facilitator cannot edit another PD |
| Shared changes commit once or not at all | Existing ETag changeset and durable receipt | Real persisted races and retry readback |
| No old payload mutates v2 through legacy code | Stored-version dispatch before mutation | Every legacy action × v2 denied before writes |

## 2. Facilitator configuration and storage

Use existing system-setting storage; no new table or Dataverse attribute for this
membership change. Add key `proposal_ranking.default_facilitators_v1`, whose value
is JSON `{ "version": 1, "systemUserIds": ["<GUID>", "<GUID>"] }`.
The placeholders are documentation only; actual identities are resolved from
active staff records. Permit one or two unique canonical lower-case GUIDs; sort
lexically for deterministic hashing. Reject duplicates, non-GUIDs, unknown
versions, extra properties and empty or oversized arrays. Do not silently discard
invalid members. D26 release configuration must resolve exactly Beth and Justin.

- Missing new key: read the old scalar as a singleton. Present malformed new key:
  configuration error (503), never scalar fallback. Missing both: unconfigured,
  preview cannot open. Admin must still be able to read eligible staff and repair
  invalid configuration, including malformed legacy fallback; expose a bounded
  configuration error, not raw stored data. Always return the new-key revision
  (null plus an explicit missing-key marker if absent), even on invalid fallback.
- Admin GET adds `facilitatorSystemUserIds`, eligible names and new-key `revision`.
  PUT accepts only `{ facilitatorSystemUserIds, revision }`; reject old scalar
  payloads with 400 so an old tab cannot silently replace two selections with one.
  Validate each enabled Dataverse user, active mapped profile and explicit ranking
  grant before revision-conditional save. Do not dual-write the old key.
- For new v2 rounds, store
  `workflow.facilitation = { version: 1, systemUserIds: [...], source, settingRevision }`
  inside existing
  `wmkf_workflowjson`. Preserve the exact set during all transitions and restart.
  The legacy scalar is the lexically first member, for compatibility/display only;
  actual actor stamps always identify the person who acted. No membership in
  `snapshot.roster` is added merely because somebody facilitates. Omit the obsolete
  `snapshot.facilitatorSystemUserId` on new v2 snapshots; the helper never reads it.
  `source` is `set`, `legacy-scalar` or `legacy-round`; `settingRevision` is the
  revision of the setting actually read, or null for a legacy round fallback.
  Validate these provenance fields along with the set; never use them as authority.
- For existing v2 rounds, missing `facilitation` falls back to that round's scalar,
  not today's defaults. Restart of such a round writes an explicit singleton
  `facilitation` with source `legacy-round` and null settingRevision to its successor.
  Present malformed `facilitation` fails closed with 503;
  never reinterpret it as legacy. Existing v1 rounds retain their scalar authority.
- Active-round facilitator changes are out of this release's scope. Admin defaults
  affect future opens only. Restart preserves captured membership, even after
  defaults change; it does not silently substitute a currently eligible person.
  Disabled/revoked actors still fail route identity/grant checks.

Resolve these rules in one small pure helper used by loading, authorization,
response capabilities and restart. Separate default-setting parsing from persisted
round parsing so absence cannot accidentally become fallback to current defaults.

Preview returns the resolved set and names and includes set, setting revision,
readiness results, pool and roster in its fingerprint. Either configured
facilitator can preview/open; open recalculates and requires the same fingerprint.
A changed setting, membership eligibility or source pool invalidates confirmation.
Every member must be enabled, map to an active profile and have an explicit ranking
grant at preview/open; any failed check is a named blocking problem. Never silently
drop a member or capture an ineligible set. Restart retains its captured set;
revoked actors remain denied, and no default membership repair happens on restart.

One-winner cycle-coordinator behavior remains atomic. Configuration is captured as
of open's fresh configuration read; a concurrent Admin save after that read applies
to later opens, not this one. No cross-record settings transaction is claimed.
Fingerprint and persisted provenance include the revision of the actual source key,
including legacy fallback. Test both Admin-save-before-read (stale preview rejects)
and Admin-save-after-read (captured configuration wins) orderings.

If the new key is present and v2 creation is disabled, refuse v1 preview/open with
409 `configuration_requires_v2`; do not show two selected people while silently
opening with one. If the present key is malformed, use the configuration error
instead. V1 creation uses the legacy scalar only while the new key is absent.
Existing v1 round reads, own saves and retained cancellation remain available.
Configure the new key only at the reviewed v2 cutover, after the compatible rollout.

## 3. Response visibility contract

Use one explicit v2 response projector for normal GET/POST results, exact-operation
replay and any `error.current`. Never serialize internal `state.participants` or
spread an internal aggregate into a public DTO. Emit `facilitatorLists: null` for
v2 in every stage; the UI must stop using it. Use an explicit workflow metadata
allowlist (version, preparationVersion, stage, revealId, historyCount,
previousRoundId, supersededBy, facilitation); participant state never belongs there.

| Response content | Private/reopened preparation | Revealed discussion |
|---|---|---|
| `own` | Actor's SE/MR/combined preparation only, or null if not a participant | Actor's own preparation, read-only |
| `progress` | Existing names/readiness booleans; no ranks, boundaries, grades, confidence, timestamps or list versions | Same readiness-only projection |
| `collective` and totals | null | Saved collective and immutable named combined assessments from that reveal |
| History | Prior revealed records only, explicitly labelled prior versions | Prior revealed records only |
| Workbook/sentiment | Denied by stage guard | Existing revealed-round supplement rules and sentiment authorization |
| Nonparticipant superuser | Administration metadata and readiness-only `progress`; no own or collective content | Same |

Readiness remains visible to the existing participant audience as well as the
facilitators; no new readiness restriction is introduced. Facilitation alone grants
no extra assessment content. A facilitator who is not a participant can see common
proposal material and, after reveal, the same revealed content as participants.
No private source-program list becomes public merely because combined work revealed.

Reopening increments preparationVersion and clears active collective visibility;
new edits stay private. Previously revealed immutable history remains readable and
clearly labelled with its reveal/version. Restart keeps the old round readable
under this same privacy policy, including a never-revealed old round. History
serialization allowlists reveal/collective records and rejects unknown kinds;
operation receipts expose status/outcome only to their authenticated owner, never
raw request hashes or assessment payloads. Strip `individuals[].ready` from all
revealed and historical projections: another actor’s operation ID is not public
assessment content. Retain only explicitly required assessment/version fields.

**Legacy transition:** do not convert or rewrite v1 lists. In the compatible release,
unpublished v1 individual lists become own-only too (`facilitatorLists: null`);
submitted is not published. Before publication, `meeting` is null even for the
facilitator: no draft order, `composite.ranks[].participants`, source-submission IDs
or other draft composite detail is exposed. Generation remains server-side;
publication is the v1 reveal point. Keep safe meeting status/readiness/confirmation
metadata so Generate/Publish can operate without rendering a draft composite.
After publication preserve the existing published composite contract.

Before publication, expose `meetingControl: { listKey, status, etag, version }`
only to the facilitator, alongside the safe confirmation metadata. Allowlist these
four fields: no order, totals, composite, owner or timestamps. The handle's ETag
is the meeting-list ETag required by the existing generate/publish payloads, not
the round ETag. `onGenerate`/`onPublish` use this handle and do not require `meeting`.
Refresh it through the same privacy-filtered conflict/readback response.

Refuse legacy `edit` on a v1 `composite-draft` with 409 `invalid_transition`, before
any write. `editMeetingOrder` is false until a program is published; mixed program
states also need a per-program UI check and server enforcement on the target list.
Post-publication edits retain the existing facilitator/participant authorization.

The v1 UI shows `ownList` to every roster participant, facilitator included, with
save/submit/readback available under the existing lifecycle rules. Its facilitator
panel shows readiness, not private lists. Drive Generate/Publish buttons from
server capabilities/confirmations and meetingStatus, not the presence of meeting
content. Update transfer copy to describe authority without promising private-list
visibility. Test collecting, submitted, composite-draft and published combinations,
including Justin as both facilitator and participant. This closes the privacy gap
while the retained v1 trial awaits separately approved cancellation.

## 4. Actions, versions and conflicts

Resolve the actor from authenticated identity; load the stored snapshot version
before selecting a mutator. Unknown version → 409 `unsupported_version` on read
and write, no mutation. V2 action/history/workbook/sentiment against a v1 round
also returns 409 `unsupported_version` before the v2 loader or any write; it must
not surface as an unrelated capacity/storage error.
The v2 reducer receives the resolved set (not a client set or substituted primary
actor); its internal checks remain authoritative even if UI controls are absent.

| Action on v2 | Allowed actor | Preconditions |
|---|---|---|
| preview/open | Configured facilitator | Valid current source/config fingerprint; open eligibility and coordinator fence |
| saveAssessment/buildCombined/confirmCombined/ready/reopenOwn/resetProgram | Captured participant, own preparation only | Private stage and existing editable/complete/version checks |
| reveal | Either captured facilitator | Private; all four PDs ready; fresh confirmation |
| editCollective | Either facilitator or captured participant | Revealed; exact collective version |
| resetCollective/reopenPreparation | Either facilitator | Revealed; fresh confirmation |
| restartWalkthrough | Either facilitator | Active round; fresh confirmation; preserve source pool and facilitator set |
| read/history | Participant or facilitator; superuser metadata-only | Current route identity/grant; privacy projection above |
| exportWorkbook/sentiment | Participant or facilitator | Revealed; exact round/reveal/list scope; existing sentiment reader guard |
| legacy save/submit/generate/edit/publish/transfer/excuse/cancel | Nobody | 409 `unsupported_version` before any legacy mutation or legacy replay |

Existing v1 actions remain versioned, including retained cancellation and its
published-round refusal, with the explicit pre-publication edit refusal above.
A v2 restart is the supported reset; do not add a v2 cancel
or membership-transfer feature. No superuser-only bypass of facilitator actions.

Keep round, affected list and coordinator ETag checks plus the existing atomic
changeset. Confirmations bind actor, action, round/policy/preparation/reveal scope
and the captured facilitator set. Restart creates its successor, old-round links,
receipt/history and coordinator change in one transaction.

| Concurrent situation | Required outcome |
|---|---|
| Two opens/reveals/resets/restarts | Exactly one shared transition commits; loser sees explicit stale/conflict state, with a privacy-filtered current view |
| Two collective edits | One commits; other keeps unsaved intent visible and must refresh/reapply deliberately |
| Different PD private saves | Existing bounded retry may rebase only a definite rejection, identical own state and identical workflow/policy scope |
| Same PD two tabs | Changed own list/version stops automatic rebase; preserve conflict for explicit resolution |
| Reveal versus reopenOwn/ready/save | One atomic ordering wins; reveal uses all-ready state from its fenced read, never a mixture; loser cannot replay into the new stage |
| Lost network response | Read back or retry identical final payload and operation ID; never auto-create a new identity while outcome is unknown |
| Old tab after reopen/restart | Old scope rejects; it cannot write the new preparation or successor round |
| Exact operation replay after later edits | Original receipt confirms once; return today's authorized projection, never restore the earlier full view |

Keep the existing maximum three private retries after the initial attempt. Only
definite `stale_scope`, `conflict`, `confirmation_stale` rejection can rebase; new
attempt gets a new operation ID only after unchanged own/scope proof. Shared actions
never use that retry. Preserve the final transmitted request for uncertain recovery.
Client state updates (success and error) must match actor/round/preparation generation;
aborted or late responses cannot overwrite a newly selected round.

## 5. Build slices and acceptance

1. Integrate candidate with current main on the implementation branch; preserve
   both workstream handoffs. Run existing ranking tests/build to establish baseline.
2. Add config parsing, Admin selection and pure round membership helper. Tests:
   missing versus malformed setting/round field, one/two/duplicate IDs, invalid
   version, disabled/unmapped/ungranted users, stale Admin revision, defaults
   changing after open, and restart preserving the set. Rehearsal config must
   remain isolated; no fictional identity or sample material in production.
   Replace test mode’s single-facilitator fixture with two approved mapped sandbox
   personas under the existing exact test-policy guard; never read production
   facilitator settings or provision identities for this test. Resolve persona IDs
   from the existing rehearsal mapping, not invented GUIDs. Malformed test
   configuration fails closed; unset/off production paths cannot use this fixture.
3. Wire preview/open, reducer, restart and stored-version dispatch. Parameterize
   actor tests for Beth/Justin versus Jean/John and nonparticipant superuser. Assert
   original actor on every persisted operation; no writes on denied legacy action.
4. Replace public projections and UI consumers. Seed distinct sentinel orders,
   grades and confidence for another PD. Assert absence in full serialized GET,
   POST, conflict, retry, history, restart/old-round and supplement responses for
   both facilitators. Include other actors’ ready/operation metadata and v1 draft
   composite details as negative sentinels. Prove facilitator-as-PD own save, submit
   and readback still work with null facilitatorLists. Assert prior reveal remains available but new preparation
   does not leak. Cover v1 unpublished/submitted/published program combinations.
   Prove Generate then Publish succeed using `meetingControl` while `meeting` is
   null; apply the sentinel check to the control handle too. Prove draft `edit`
   writes nothing and returns 409, while published edits retain their contract.
5. Run persisted two-actor races and 23-proposal/four-PD rehearsal in sandbox;
   service mocks alone do not establish atomicity. Repeat separate authenticated
   sign-ins, saved readback, Safari/iPad interaction, workbook and history.
   Verify accepted/current sentiment through the existing reader or show its
   unavailable state. No new AI generation or paid scan is required.
6. Reconcile candidate API contract, design, implementation plan, Atlas, service
   catalogue and release plan to the final implementation. Run scoped tests/lint,
   types, build, relevant route/Atlas/privacy/DAL/context/status/doc gates and
   sequential self-tests; use the actual package scripts. Bounded independent
   code review precedes the production release proposal.

## 6. Implementation checkpoint and remaining acceptance

**[VERIFIED via local branch source, focused Jest, and final Opus/Sol review]** Candidate
`9fe92f0ed` on `codex/d26-ranking-release` implements the configuration,
preview/open capture, persisted two-member v2 authorization, version dispatch,
response privacy, legacy own-list/meeting-control behavior, and Admin/UI changes
described above. The rehearsal setting resolves the two approved test personas
from enabled Dataverse staff records under the existing fail-closed test policy;
the D96 harness used explicit synthetic membership provenance and did not exercise
preview/open setting capture. This source contract is distinct from service persona
tests or real authenticated route authorization.

**[VERIFIED via current corrected commit `9fe92f0ed`]** 25 suites / 269 tests,
type check, scoped lint and production build passed. API-route, status-enum, DAL,
OData, Dynamics-context, route-lifecycle, route-service and trust-boundary-GUID
gates passed with their sequential self-tests on the previously checked source
slice. Atlas, doc-currency, fact-consistency, doc-symbol and docs-catalog gates and
their self-tests passed; `git diff --check` is clean. The build reports existing
broad dynamic-filesystem tracing warnings in unrelated renderers. Sol found no
actionable defects; Opus's final follow-up is SATISFIED. See the implementation
review record.

**[VERIFIED via isolated sandbox run, 2026-10-15 UTC]** The bounded rehearsal
created a new synthetic D96 cycle in the registered Dataverse sandbox after
read-only preflight confirmed that D96 and its receipt were absent. It retained
both created rounds (`a2f2e623-2718-4f45-bac4-5e443927cf85`, then successor
`cbd337f2-1cc5-4352-b1ee-a16b221c43f1`) and performed no deletes. Six persisted
checks passed: four distinct private preparations remained actor-only; the two
facilitators raced on reveal and collective edit with one writer each; preparation
reopen and restart races had one winner; captured membership survived restart;
and the revealed workbook contained 23 synthetic proposals and 92 assessments.
Receipt: `/private/tmp/proposal-ranking-d26-d96-sandbox-receipt.json` (local,
not versioned). The receipt records four enabled sandbox Dataverse users (Beth,
Justin, Rob, Jean); Rob is the rehearsal surrogate for production John. The
membership provenance is an explicitly synthetic fixture. This verifies direct
persisted service behavior, not preview/open setting-revision capture, active
profile mapping, app grants, route authorization, independent Microsoft SSO, or
signed-in Safari/iPad browser behavior. D97 and D98 and shared defaults were left
untouched.

**[VERIFIED via one bounded host Chrome smoke, 2026-10-15]** The browser loaded the
23-card sandbox view, readiness and shared controls for the Beth and Justin service
personas, navigated history, and downloaded the workbook without page runtime
errors. The D96 receipt was unchanged. This was a read-only UI smoke, not independent
SSO acceptance, WebKit/iPad testing, or validation of D26 live data.

The corrected implementation and its source review are complete for this local
candidate. The remaining release acceptance is:

- Complete independent staff SSO/profile/grant acceptance and WebKit/iPad
  interaction; the host Chrome smoke used trusted sandbox service personas.
- Re-probe the live D26 proposal pool and retained trial at release time; D96 used
  synthetic proposals, not D26 source records.

This is a local branch checkpoint, not production acceptance. No environment
flags, setting, schema, existing trial, or round were changed.

## 7. Release boundary and review obligations

Implementation acceptance is separate from production approval. Repeat read-only
schema/access/source checks at release time. Present exact additive wave33 changes,
23-proposal roster/pool, effective flags, Beth/Justin configuration, retained old
trial state and a v2-compatible rollback deployment. Existing trial cancellation,
schema/config writes and opening the new round require the explicit cutover decision.
If the trial has since published, stop rather than bypass its cancellation guard.
Sentiment permission expansion is likewise a separate decision; do not silently
add Meeting Tracker grants. The v2 creation flag is not an emergency stop for an
already-created v2 round.

Contract-reconcile: caller → route → service/reducer → changeset/receipt → filtered
response → UI/history/export is covered above. Partial-success must be prevented
by one changeset; async retries distinguish rejection from unknown outcome; helper
semantics preserve absent/malformed and v1/v2 differences; persisted membership
must survive every workflow write and restart. Search raw
`wmkf_facilitatorsystemuserid`, `facilitatorSystemUserId`, `readDefaultFacilitator`,
`round.facilitator`, `facilitatorLists`, `state.participants` and all action
names across the integrated candidate before implementation sign-off.

**Historical author-side pre-build review:** inspected the then-current
`publicView` (privacy exception
exists), `handleProposalRankingAction` (legacy dispatch needs explicit v2 denial),
`preview-service` fingerprint (single identity, no new-key revision), restart
(scalar copied), and client retry (private-only unchanged-state guard exists).
Those findings drove the requirements in this addendum; they were resolved in the
candidate described in §8. They are not statements of current source behavior.
