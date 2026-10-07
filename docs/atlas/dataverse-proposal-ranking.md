# Proposal Ranking storage and activation

Date: 2026-10-07. Status: source implemented on the feature branch; integration
review in progress. No live Dataverse schema, role, app grant, setting or deployment
has been applied or probed for this feature.

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

## Activation checklist — not yet performed

1. Authorize and run schema dry-run/apply against the intended rehearsal target
   using the existing `apply-dataverse-schema.js` workflow and wave
   `32-proposal-ranking`; verify exact fields, Memo bounds and active alternate keys.
2. Apply the dedicated application-user role only to the application identity.
   Verify ordinary PD direct table reads fail, and confirm these tables are excluded
   from Dataverse relevance search. Verify indirect audit/navigation paths are denied.
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
privacy. Final verification and Opus implementation-review results are pending.
No live-state claim is made by this page.
