# Proposal Ranking — storage, implementation, and planned workflow

Last source comparison: 2026-10-13, main `b3219f4aa`; paused local branch
`codex/proposal-ranking` at `0d161d60f`. **Incumbent source baseline; later sandbox-only v2 evidence is below.**
Current product authority: revision 5 of
`docs/plans/PROPOSAL_RANKING_DESIGN_2026-10-07.md` (agreed October 13).
The assessment/reveal/reset workflow is **branch-built on `codex/proposal-ranking-v2`, not deployed or enabled**. The owner accepted UX revision 3 and authorized implementation.
Implementation stages and proposed durable contracts are in
`docs/plans/PROPOSAL_RANKING_IMPLEMENTATION_PLAN_2026-10-13.md`; sandbox provisioning is recorded below; Production provisioning is not claimed.

## Incumbent version-1 source and historical deployment boundary

[VERIFIED via main source] The existing app still stores separate individual SE/MR
orders, locks each on submission, and generates/publishes separate program composites.
The source trace and branch differences are in
`docs/audits/PROPOSAL_RANKING_WORKFLOW_RECONCILIATION_2026-10-13.md`.

[HISTORICAL — October 7 receipt] Production deployment and enablement, schema/role,
four participant grants and a signed-in waiting-state smoke were recorded in
`docs/audits/PROPOSAL_RANKING_PRODUCTION_RELEASE_2026-10-07.md`. The receipt is not
fresh proof of today's flags, facilitator, round data, grants, or full multi-identity
acceptance. Do not repeat earlier "Production untouched" or "activation pending"
checkpoints as current state. Detailed dated setup history is preserved in
`docs/audits/PROPOSAL_RANKING_ATLAS_HISTORY_2026-10-07.md`.

## Producer → persistence → consumer on main

[VERIFIED via source] `pages/proposal-ranking.js` renders
`shared/components/proposal-ranking/ProposalRankingApp.js`; `client.js` calls
`pages/api/proposal-ranking.js`. The route enforces an explicit ranking app grant,
session-derived identity, private/no-store headers and trusted DAL context.
`lib/services/proposal-ranking/service.js` owns authorization, lifecycle, validation,
response privacy and operation readback; `lib/dataverse/adapters/proposal-ranking.js`
uses ETag-conditional changesets, application-owned writes and explicit actor columns.

| Logical entity | Entity set | Existing durable contract |
|---|---|---|
| `wmkf_proposalrankingcycle` | `wmkf_proposalrankingcycles` | Unique cycle coordinator and active-round UUID text; POST on initial creation. |
| `wmkf_proposalrankinground` | `wmkf_proposalrankingrounds` | Frozen cards, pool, reviewer scores, seeds and roster; facilitator, policy revision, active/canceled state, bounded administration log and operation identities. |
| `wmkf_proposalrankinglist` | `wmkf_proposalrankinglists` | Whole per-PD/program or meeting/program order; unique round/list key, ETag, draft/submitted/collecting/composite-draft/published state, immutable composite beside mutable meeting order. |

Schema source: `lib/dataverse/schema/wave32-proposal-ranking/`; main application role:
`lib/dataverse/schema/roles/proposal-ranking-app.json` (Create/Read/Write).
Snapshots are bounded to 512 KiB, order/composite JSON to 64 KiB, administration log
to 128 KiB. Main retains canceled rounds and locked submissions, with no erase/reopen
operation. No ranking-specific Postgres table, Blob store, or model execution is used.

Ordinary staff must not gain direct privileges on these tables. Existing generic
Explorer/export/search/navigation exclusions remain required, including implicit
Dataverse relationships. Tenant administrators remain privileged. The readiness
probe reads the Dataverse `searchstatus` platform endpoint (HTTP `/searchstatus`)
to inspect search-index exclusion; it is not a ranking storage table. Historical
search-exclusion receipts are in the dated Atlas history, not a fresh probe here.

## Inputs and calculations on main

[VERIFIED via source] `proposal-ranking-source.js` completely paginates ordinary
exact-cycle SE/MR requests at `Phase II Pending`; `trial-cutoff.js` excludes D26
request numbers 1003220 and higher and rejects malformed D26 numbers. Request amount
is `akoya_request`, not total project expenses. Applicant `account.name` supplies
institution text; `account.wmkf_eastwest` maps 100000000/100000001 to East/West, unknown
to null. Neither fields nor old snapshots are silently backfilled.

`preview-service.js` resolves enabled/granted lead PDs and configured facilitator,
validates saved nonsynthetic received-review overall-assessment scales, freezes the
snapshot and fingerprints the preview. Invalid identities/scales/currencies block
opening; unscored proposals remain included and missing amounts remain incomplete.
`config.js` stores the default GUID in `wmkf_appsystemsetting` under
`proposal_ranking.default_facilitator_systemuser_id` with revisioned writes.

`calculations.js` seeds by descending reviewer mean (unscored last), averages PD
positions within each program, stabilizes equal sums by seed order, and calculates
integer-minor-unit cumulative totals. Existing responses/cards mark equal composites
as tied. That presentation differs from the new no-ties decision.

## Privacy and client behavior on main

Before publication, each PD sees their own orders; the facilitator sees all. Each
program publishes independently. A nonparticipant superuser gets administration
metadata only. Main still permits exceptional excusal before generation and retains
excluded submissions; the new all-PDs-ready design does not carry that bypass forward.

The UI serializes saves, keeps the latest queued order and visible unsaved/conflict
state, and guards against stale scope responses. Published meeting edits are separate
from individual submissions. Main has no A/B/C separators, confidence collection,
individual combined ranking, ready/reopen/single-reveal flow, funding history,
sentiment enrichment, or ranking workbook export (bounded source search in the audit).

## Paused branch, not main

[VERIFIED via local source at `0d161d60f`] The branch adds a combined **meeting** list
only after the program meetings are published, a funding-history reader, a local
rehearsal, a marked dry-run reset, and browser CSV export. It does not collect each
PD's combined preference or implement revision 5's assessment/readiness model.
Its funding DTO includes qualifying award count, total USD, latest award cycle and
availability; its card displays dollars and latest award month/year. The agreed
replacement display is count/latest award year across all recorded qualifying regular Research
awards, with no recency window or quantitative weighting. Zero qualifying awards must not be
labelled never funded by the Foundation; unavailable/provisional coverage stays explicit. These features must be adapted, not assumed
ready to merge as the revised workflow. Branch role/delete behavior is not deployed
by the documentation comparison; no dry-run erase is authorized here.

## Version-2 branch persistence and consumers

[VERIFIED via branch source] Revision 5 implements grades, confidence, separator positions,
individual combined orders, readiness/reopen versions, immutable reveal revisions and
one active collective recommendation with funding sections. Resets must be available at every
stage for the walkthrough: preserve prior reveal records, require everyone ready plus a fresh
facilitator reveal after reopening private preparation, and make a PD combined-list rebuild
explicit rather than silently overwrite cross-program edits. Future restrictions on those reset
controls remain undecided. Initial collective separators enclose only the unanimous-A prefix
and unanimous-C suffix of the calculated order; the middle is Alternates. Additive wave33 defines round `wmkf_workflowjson` (65,536) and list
`wmkf_assessmentjson` (524,288). Current reads query active keys only; immutable
`o:<UUID>` receipts resolve retries and `h:<ordinal>` history pages are bounded to ten.
All writes use one round-fenced changeset. Opening caps are 100 proposals / 12 PDs.
[VERIFIED via sandbox setup/readback and saved rehearsal, October 13] Both new fields
are applied with exact metadata; Beth is the saved sandbox default facilitator. Thirteen
D98 service-persona checks passed with six fictional proposals/four enabled identities.
See `docs/audits/PROPOSAL_RANKING_V2_SANDBOX_REHEARSAL_2026-10-13.md`. This supersedes
the earlier absent-fields/default-setting probe. Production was not changed.
The API document preserves the incumbent wire contract separately from branch v2
actions. New design does not authorize rewriting old round data.

[VERIFIED via branch source] Accepted/current sentiment already has a
read service, `getDeliberationSentiments`, backed by `staff_discussion_sentiments`
(see `docs/atlas/postgres-staff-discussion-sentiments.md`). The v2 `workflow-service.js` consumer calls it only for active revealed rounds,
in batches of up to 50, and rechecks the round after enrichment.
It requires Meeting Tracker access or superuser authority, caps requests at 50, and
rechecks source/prompt currentness. Only group-discussion cards should consume it;
private preparation and the agreed workbook do not. No ranking AI call is needed.

## Trial and release follow-up

Historical owner requirement: trial PD rankings must not carry into colleague use;
preserve source reviewer scores and restore Beth as default before handoff. The
October 7 history records Justin temporarily replacing Beth. Actual current setting,
round state, completion of reset, and later operational changes are **UNKNOWN here**.
Read current state under separately authorized access before choosing any reset path.
Main prohibits cancellation after either program publishes; branch-only erase is
not authority to delete existing production data.

Implementation is authorized and branch-built; sandbox setup and bounded saved
service-persona rehearsal passed, followed by a saved-D98 browser walkthrough with
four trusted personas in normal Chrome. The earlier port-3136 browser block is historical.
Final full browser restart returned all four participants to Preparing, with confidence
cleared and reveal disabled, after a successful second reveal. Independent SSO/app-grant,
source-eligible opening, live sentiment, pointer smoothness and long-list autoscroll
remain open. The fresh read-only eligibility probe still returned zero; a separate
memory-only 100/12 UI fixture passed rendering/navigation/keyboard/reset checks but
does not prove saved maximum-capacity transactions. Retained D98 reviewer-distribution keys do not support
reviewer-badge visual proof. Deliberate promotion remains pending. New creation requires literal-on
`PROPOSAL_RANKING_WORKFLOW_V2` and `PROPOSAL_RANKING_V2_SCHEMA_READY` in addition to
existing readiness. Neither was enabled by this task. Full multi-identity acceptance is not established
by the historical waiting-state smoke. Only the authorized sandbox schema, default facilitator and retained synthetic ranking
state changed in this follow-up. No Production change, branch cleanup, merge or deployment occurred.
