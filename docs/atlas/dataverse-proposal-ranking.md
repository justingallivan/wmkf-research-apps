# Proposal Ranking storage and activation

Date: 2026-10-07. Status: source implemented; sandbox schema and application-role
provisioning and bounded persistence rehearsal verified. Runtime activation and
multi-identity browser rehearsal remain pending. Direct-table denial is verified
for the tested sandbox staff identity.
Production has not been provisioned or enabled. Evidence:
`docs/audits/PROPOSAL_RANKING_SANDBOX_SETUP_2026-10-07.md` and
`docs/audits/PROPOSAL_RANKING_PERSISTENCE_REHEARSAL_2026-10-07.md` and
`docs/audits/PROPOSAL_RANKING_STAFF_PRIVACY_2026-10-07.md`.

## Source and persistence

[VERIFIED via source] `/proposal-ranking` calls `/api/proposal-ranking`, which
requires an explicit `proposal-ranking` grant and a session-derived Dynamics actor.
`lib/services/proposal-ranking/service.js` authorizes the round/list operation;
`lib/dataverse/adapters/proposal-ranking.js` persists it through ETag-conditional
changesets under trusted DAL context and the existing target interlock.

| Logical entity | Entity set | Durable contract |
|---|---|---|
| `wmkf_proposalrankingcycle` | `wmkf_proposalrankingcycles` | One coordinator per cycle, unique cycle key, active-round UUID text and version. Initial creation is POST, not upsert. |
| `wmkf_proposalrankinground` | `wmkf_proposalrankingrounds` | Frozen proposal cards, score basis, seed orders and roster; facilitator, policy revision, active/canceled state, action receipts and administration events. Unique creation-operation key. |
| `wmkf_proposalrankinglist` | `wmkf_proposalrankinglists` | One complete order per PD/program or meeting/program. Unique round/list key, ETag, immutable submitted inputs/composite beside mutable meeting order, terminal operation receipts. |

Schema source: `lib/dataverse/schema/wave32-proposal-ranking/`. Application-only
Create/Read/Write role: `lib/dataverse/schema/roles/proposal-ranking-app.json`.
There are no application lookup relationships on these tables; UUID text does not
remove Dataverse's implicit audit relationships. Generic query privacy must also
cover those relationships. Ordinary staff must receive no privileges on these
three tables. Tenant administrators remain privileged.

Snapshots are bounded to 512 KiB, orders/composite JSON to 64 KiB, and administration
logs to 128 KiB. Exceeding a bound rejects the write. Canceled rounds and submitted
inputs are retained; this feature exposes no deletion or submission reopening.
No Postgres migration, Blob store, AI call, funding decision writeback, or realtime
synchronization service is introduced.

[VERIFIED via source] The frozen inputs come from exact current-cycle, SE/MR,
`Phase II Pending` ordinary requests; `akoya_request` supplies full requested amount,
not total project expenses. The source adapter paginates and rejects capped reads.
External received nonsynthetic answer snapshots supply the saved overall-assessment
scale. Lead PDs must resolve to enabled staff with app access. Missing assignments,
invalid saved scales and mixed currencies block opening; unscored proposals and
missing amounts remain visibly incomplete. `config.js` stores the default facilitator
GUID in shared `wmkf_appsystemsetting` under
`proposal_ranking.default_facilitator_systemuser_id` using conditional settings writes.

## Consumers and privacy

[VERIFIED via source] The app receives filtered private/no-store responses. Before
publication, each PD sees their own orders, the facilitator sees all, and a
nonparticipant superuser receives only transfer metadata. Publishing one program
reveals only that program's shared order and named submitted ranks. Excused PDs
remain meeting participants but do not vote. A non-roster facilitator's successful
handoff returns a receipt without private data; subsequent access is denied.

The UI serializes saves, retains the latest queued order, shows unconfirmed edits,
reconciles uncertain outcomes, and invalidates stale responses on scope/access
changes. Cumulative requested amounts use frozen integer minor units and update
with the visible order. No automatic budget cutoff is applied.

## Activation checklist — sandbox setup partially complete

1. [VERIFIED via sandbox apply and readiness probe] Wave `32-proposal-ranking`
   is applied on `orgd9e66399.crm.dynamics.com`; all three entity identities, expected
   fields/Memo bounds and active alternate keys passed readback.
2. [VERIFIED via role apply and assignment readback] The dedicated role is assigned
   only by this setup to the sandbox application identity, with nine Create/Read/Write
   privileges. Direct-table denial is verified for the tested enabled nonapp staff
   identity: effective-user query matched, three exact rows returned 403, and app
   controls returned 200. This is impersonation evidence, not a staff OAuth login. Sandbox GET on the `searchstatus` platform endpoint (HTTP
   `/searchstatus`) confirms all three entities absent
   from the provisioned search index. Verify indirect audit/navigation paths are denied.
3. Verify test-request and synthetic-reviewer isolation schemas/switches on that
   target. Set `PROPOSAL_RANKING_SCHEMA_READY=on` only after schema/role proof;
   set `PROPOSAL_RANKING_ENABLED=on` only for the approved environment. Missing flags
   block runtime access; no production activation is inferred from a source merge.
4. Grant the app to participants and the administering superuser. Through Admin,
   select the verified active Dynamics identity for CSO Beth Pruitt as default
   facilitator. No name/email guess or hardcoded identity is used by the service.
5. Exercise separate identities and two browser sessions: private draft visibility,
   facilitator-as-PD vote, complete submit/generate/publish, independent SE/MR
   publication, conflict/readback recovery, transfer, excusal and cancellation.
   Verify totals against full requested amounts and that no source request changes.
6. Record exact target, schema/role evidence and runtime test receipt before any
   deliberate production promotion. The current source/test evidence does not
   substitute for this live rehearsal.

Accepted limitation: generating either composite ends excusal; publishing either
program ends cancellation. An unavailable PD may leave the other program blocked.
The facilitator confirms named outstanding submissions before those transitions.

## Evidence boundary

The approved contract is `docs/plans/PROPOSAL_RANKING_DESIGN_2026-10-07.md`;
wire shapes are in `docs/plans/PROPOSAL_RANKING_API_CONTRACT.md`. Local regression
suites cover calculations, preview/schema, service behavior, UI and generic-reader
privacy. Verification and Opus review are recorded in
`docs/audits/PROPOSAL_RANKING_OPUS_IMPLEMENTATION_REVIEW_2026-10-07.md`.
Live setup claims are supported by the historical setup receipt and GET-only
`scripts/probe-proposal-ranking-readiness.mjs`. Its uncapped, all-date eligible
source scan returned zero proposals. The bounded persistence receipt above proves
initialization, conditional save, stale-write rollback, duplicate-key rollback and
current sandbox search exclusion using only new-table synthetic snapshot data.
It does not prove authenticated meeting behavior. Staff grants/default identity,
isolation/runtime flags and browser rehearsal remain open. The selected-staff
direct-table denial proof is limited to the sandbox identity and retained records
in the linked privacy receipt; production permissions require their own verification.
Advanced Find visibility is not proof of relevance-search exclusion.


## Ranking branch continuation — 2026-10-07

[VERIFIED via `scripts/probe-proposal-ranking-readiness.mjs`, GET-only rerun]
The registered sandbox `orgd9e66399.crm.dynamics.com` still passes all three entity
identity/attribute/key checks, application-role assignment and both isolation-marker
schema checks. The uncapped ordinary Phase II Pending SE/MR scan returns **0** eligible
proposals and no cycles. The default-facilitator setting row remains absent.
The four readiness switches are false in the local loaded environment, not an
inventory of hosted Preview configuration. No configuration or data was changed.

[VERIFIED via local tests/gates] The merge of 23 incoming main commits through
`27ed1684d` preserves ranking source and contracts. Ranking/Explorer: 120 tests in
12 suites pass. API routes, Atlas and route lifecycle auth gates and their self-tests
pass sequentially; types pass. All local startup gates pass after repairing this
worktree's memory symlink. The live factory-ledger check was excluded from the run
because Production reads are outside the owner's authorization.

The browser lifecycle remains unperformed: private rankings, locked submission,
composite publication, meeting reordering and full-requested budget totals. Participant
grants and verified Beth Pruitt facilitator selection remain open per the prior
setup receipt; this readiness probe does not inventory participant grants. Owner
choice is required between preparing these prerequisites, resolving the zero-proposal
acceptance-data gap, or deferring live acceptance. Source creation/copy and activation
are not inferred. D99 remains storage-only evidence; test exclusion stays intact.


Review: Luna reconnaissance and Sol merge review found no substantive blockers.
One bounded `claude-opus-5-5` subscription-OAuth source review returned **APPROVE**;
API-key environment variables were removed, and review tools were read-only.
Opus did not run tests or live probes. Its only nonblocking note was the Admin
route's matrix wording: `handleProposalRankingAdminSettings` permits guarded
facilitator configuration before activation. The matrix now reflects that source;
no runtime check was added. No second review loop was run. The full local review
receipt is `/private/tmp/ranking-opus-merge-review.txt` (not portable); the verdict,
scope and disposition here are the durable receipt. The fresh probe and tests were
run by the orchestrator, separately from the review.


## Institution geography discovery — 2026-10-07

[VERIFIED via sandbox metadata GETs from
`scripts/probe-proposal-ranking-geography.mjs`] The applicant institution relationship
is `akoya_request.akoya_applicantid` → `account`, relationship schema
`akoya_account_akoya_request_applicantid`, navigation property `akoya_applicantid`.
The institution's custom Picklist is `account.wmkf_eastwest` (schema
`wmkf_EastWest`, display label **East-West**). Metadata defines **East = 100000000**
and **West = 100000001**. `wmkf_eastwestname` is a Virtual attribute, not the stored
choice field. These values were read from the registered sandbox metadata, not
inferred from state/address or institution name.

The probe reads metadata only, refuses non-sandbox targets and requires the target
interlock on. It reads no business rows and performs no writes. Institution value
population and Production metadata were not inspected.

[VERIFIED via source and mocked regression tests] The source adapter now batches
reads of eligible requests' applicant accounts and maps only the two verified
choice values to `institutionGeography: 'East' | 'West' | null`. The preview carries
that field into its fingerprint and frozen snapshot. The shared proposal card shows
a prominent E/W in the upper-right corner, with an accessible East/West institution
label. Unknown/missing values and older snapshots show no letter. Existing snapshots
are not rewritten or live-refreshed; ranking calculations and eligibility are unchanged.
Failed/capped account queries reject the preview through the existing complete-read
contract. No schema, environment, grant or live data changes were made.


Geography validation: 123 tests across 12 ranking/Explorer suites pass, including
raw account choices, unknown values, frozen preview/fingerprint and legacy-card
omission. Changed-file lint, types, Dataverse/OData and Atlas/doc gates pass with
self-tests run sequentially. The actual card component was rendered in isolated
Chrome with synthetic fixtures at 1100px and 390px: markers are 24px, at the upper
right, with no horizontal overflow. This is a component layout check, not live
sandbox acceptance. Luna implemented; Sol and the orchestrator reviewed without
substantive blockers. After the owner explicitly authorized further OAuth-only
Opus reviews, `claude-opus-5-5` reviewed `d2cc82fdf` and returned **APPROVE**.
It traced the raw numeric DTO, strict option mapping, complete reads, snapshot,
fingerprint and shared renderer. This was source-only review; it did not rerun
tests or perform live calls. The nonblocking accessible-name note was corrected
with an explicitly named image role for the E/W symbol and a role/name regression.
No second review loop was run. Local verbatim receipt:
`/private/tmp/ranking-geography-opus-review-authorized.txt` (not portable); this
paragraph retains the verdict, scope and disposition. OAuth authentication was
verified as `claude.ai`; API-key environment variables were removed.


## Approximate reviewer-rating color — 2026-10-07

The shared card displays a 24px lower-right circle using ten solid colors from red
through yellow to green, from the frozen `score.mean`. `reviewerScoreIndicator` in
`shared/components/proposal-ranking/model.js` selects
`Math.round(((mean - 1) / 4) * 9)` for finite means in [1,5] with at least one rated
review. Other inputs show gray. The numeric score remains visible and the circle
has a named image role and hover text. Equal colors do not assert exact ties.
This presentation mapping works independently of reviewer count; it does not
change source reads, snapshots, displayed scores, seed ordering or composites.


Validation: 126 tests in 12 ranking/Explorer suites pass; lint, types, Atlas and
currency gates/self-tests pass. Isolated actual-component Chrome renders at 1100px
and 390px verified all ten colors plus gray, 24px circle dimensions, editable and
read-only placement, and no overflow. Luna built; Sol and one bounded subscription
OAuth-only Opus source review approved. Opus's nonblocking tooltip-rounding note
was corrected to use the same rounding as the visible score, with a regression
for 4.35 → 4.4. No additional review loop or live data access was needed. Local
review receipt: `/private/tmp/ranking-rating-opus-review.txt` (not portable).
