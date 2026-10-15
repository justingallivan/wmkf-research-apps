# D26 ranking — implementation addendum

Session 608, 2026-10-14. **PLANNED engineering contract; no implementation or production release executed.**
**Independent review pending:** Claude subscription OAuth was confirmed, but
automatic approval review blocked the requested Opus launch pending explicit
acknowledgment of usage consumption. No Opus verdict has been obtained.
This supplements `PROPOSAL_RANKING_D26_RELEASE_2026-10-14.md` on
`origin/codex/ranking-pd-save-conflicts`, inspected at
`886e194ac1b8fb6707a47c59828a3d3d14edc179`. That candidate, not the older ranking
branches or local main, is the starting point. Integrate current main only when
implementation starts. This file lives on main so the continuation is discoverable.

Owner requirements: exactly 23 D26 proposals, excluding 1003223/1003224; Beth and
Justin both facilitate; everybody sees only their own preparation before reveal;
facilitators may see readiness. These decisions are settled. The contracts below
are proposed implementation details for review, not claims of existing behavior.

## 1. Source baseline and scope

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
  invalid configuration; expose a bounded configuration error, not raw stored data.
- Admin GET adds `facilitatorSystemUserIds`, eligible names and new-key `revision`.
  PUT accepts only `{ facilitatorSystemUserIds, revision }`; reject old scalar
  payloads with 400 so an old tab cannot silently replace two selections with one.
  Validate each enabled Dataverse user, active mapped profile and explicit ranking
  grant before revision-conditional save. Do not dual-write the old key.
- For new v2 rounds, store
  `workflow.facilitation = { version: 1, systemUserIds: [...] }` inside existing
  `wmkf_workflowjson`. Preserve the exact set during all transitions and restart.
  The legacy scalar is the lexically first member, for compatibility/display only;
  actual actor stamps always identify the person who acted. No membership in
  `snapshot.roster` is added merely because somebody facilitates.
- For existing v2 rounds, missing `facilitation` falls back to that round's scalar,
  not today's defaults. Present malformed `facilitation` fails closed with 503;
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
One-winner cycle-coordinator behavior remains atomic. A v1 creation path continues
using the legacy default; the new setting is used only when v2 creation is enabled.

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
| Nonparticipant superuser | Administration metadata only; no own or collective content | Administration metadata only |

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
raw request hashes or assessment payloads.

**Legacy transition:** do not convert or rewrite v1 lists. In the compatible release,
unpublished v1 individual lists become own-only too (`facilitatorLists: null`);
submitted is not published. Existing program publication controls when its named
submitted orders may be shown. Preserve v1 generation inputs on the server and its
published-history contract. Test the incumbent UI still supports readiness and
generation without the private facilitator list. This closes the privacy gap while
the retained v1 trial awaits separately approved cancellation.

## 4. Actions, versions and conflicts

Resolve the actor from authenticated identity; load the stored snapshot version
before selecting a mutator. Unknown version → 409 `unsupported_version`, no write.
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
published-round refusal. A v2 restart is the supported reset; do not add a v2 cancel
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
3. Wire preview/open, reducer, restart and stored-version dispatch. Parameterize
   actor tests for Beth/Justin versus Jean/John and nonparticipant superuser. Assert
   original actor on every persisted operation; no writes on denied legacy action.
4. Replace public projections and UI consumers. Seed distinct sentinel orders,
   grades and confidence for another PD. Assert absence in full serialized GET,
   POST, conflict, retry, history, restart/old-round and supplement responses for
   both facilitators. Assert prior reveal remains available but new preparation
   does not leak. Cover v1 unpublished/submitted/published program combinations.
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

## 6. Release boundary and review obligations

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
`wmkf_facilitatorsystemuserid`, `facilitatorLists`, `state.participants` and all action
names across the integrated candidate before implementation sign-off.

Author-side disconfirming review: inspected current `publicView` (privacy exception
exists), `handleProposalRankingAction` (legacy dispatch needs explicit v2 denial),
`preview-service` fingerprint (single identity, no new-key revision), restart
(scalar copied), and client retry (private-only unchanged-state guard exists).
No prerequisite is claimed implemented merely because this addendum specifies it.
