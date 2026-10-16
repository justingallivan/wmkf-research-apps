# Proposal Ranking — D26 production release and storage history

**Released to production 2026-10-15 (Session 609)**: D26 v2 round `49279ac7-3ab9-41d8-b2d6-5aaf4085e642` is open; see the receipt in `../plans/PROPOSAL_RANKING_D26_RELEASE_2026-10-14.md`. Candidate and branch statements below are dated pre-release history. Production wave33 fields `wmkf_workflowjson` (65,536) and `wmkf_assessmentjson` (524,288) were applied and read back 2026-10-15.

Current local candidate: `codex/d26-ranking-release` at `9fe92f0ed`; no production
promotion or D26 live ranking write. See the first section for candidate storage,
facilitation and verification. The remaining sections preserve dated source and live
state history. The October 13 main comparison below is historical, not current branch
behavior. Current product authority: revision 5 of
`docs/plans/PROPOSAL_RANKING_DESIGN_2026-10-07.md` (agreed October 13).
The assessment/reveal/reset workflow was **deployed to the dedicated test Preview from `codex/proposal-ranking-v2`; not Production**. This dated deployment statement does not establish the D26 candidate's deployment.
Implementation stages and proposed durable contracts are in
`docs/plans/PROPOSAL_RANKING_IMPLEMENTATION_PLAN_2026-10-13.md`; sandbox provisioning is recorded below; Production provisioning is not claimed.

## D26 release candidate — local branch source, not deployed

[VERIFIED via local branch source, `codex/d26-ranking-release` at `9fe92f0ed`,
2026-10-15] The compatible D26 candidate adds no table or Dataverse attribute for
dual facilitation. It stores the default member set in the existing
`wmkf_appsystemsetting` under `proposal_ranking.default_facilitators_v1` as JSON
`{version:1,systemUserIds:[...]}` with revision-conditional writes. A missing new
setting can read the legacy scalar as a singleton; a present malformed setting
fails closed. New v2 workflow JSON captures the exact sorted set and source
revision. Existing v2 rounds without that property retain their own scalar as a
legacy singleton during authorization and restart. Existing v1 rounds remain
scalar-authorized. This describes source only; no live setting or production round
was changed by the implementation checkpoint. A separate authorized harness
created and retained two synthetic D96 sandbox rounds; it did not change shared
defaults or D97/D98. See the [D26 release addendum](../plans/PROPOSAL_RANKING_D26_IMPLEMENTATION_ADDENDUM_2026-10-14.md).

The corrected candidate passed 25 suites / 269 tests, type checking, scoped lint
and production build on `9fe92f0ed`. Scoped runtime gates passed on
`a5f4a83d8`; Opus's final review is satisfied with no blocker. A read-only host
Chrome smoke with sandbox personas rendered the 23-card view, readiness/shared
controls, history navigation and workbook download; it does not establish
independent SSO, WebKit/iPad behavior or live D26 eligibility. The D96 receipt records persisted private
order isolation, two-facilitator races, captured membership through restart, and a
23-proposal / 92-assessment workbook. The proposals were synthetic, not the D26
source pool. Independent profile/grant/SSO authorization and WebKit/iPad acceptance
remain open. Prior D97/D98 rehearsal receipts remain unchanged.

## Historical version-1 source and deployment boundary — October 13 main

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

## Historical producer → persistence → consumer on main — October 13

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

## Historical inputs and calculations on main — October 13

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

## Historical privacy and client behavior on main — October 13; superseded for D26 candidate

In the October 13 main baseline, before publication each PD sees their own orders
and the single facilitator sees all. The D26 candidate's current own-only privacy
contract supersedes this behavior; its two captured facilitators see readiness but
not other participants' unrevealed orders. Each program publishes independently. In v1 a nonparticipant superuser gets administration
metadata only. In the D26 v2 candidate, Proposal Ranking grant holders who are neither roster participants nor captured facilitators are read-only observers (owner decision 2026-10-15): before reveal they see the source snapshot and readiness only; after reveal they see the named assessments and collective view, history, workbook and sentiment (sentiment still needs Meeting Tracker readership); every mutation is refused. Main still permits exceptional excusal before generation and retains
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
replacement display is count/latest award year with total USD in an arrow disclosure,
across all recorded qualifying regular Research awards, with no recency window or
quantitative weighting. Zero qualifying awards must not be
labelled never funded by the Foundation; unavailable/provisional coverage stays explicit. These features must be adapted, not assumed
ready to merge as the revised workflow. Branch role/delete behavior is not deployed
by the documentation comparison; no dry-run erase is authorized here.

## Version-2 branch persistence and consumers

[VERIFIED via branch source and dedicated sandbox deployment `d1b206185`; not Production]
`research-funding.js` returns `researchFunding.totalAmountMinorUnits`, its existing
safe integer USD-cent sum over the same qualifying awards as the count. The source
adapter passes the object through `preview-service.js` into the frozen round snapshot;
`AssessmentWorkflow.js` displays it inside the prior-awards disclosure. Unavailable
history returns null; old snapshots without the field display **Not available**.
Provisional history remains labelled. Scoring, workbook columns, and reset semantics
are unchanged; resets retain the original history and do not backfill this total.

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
other staff sign-ins and live sentiment remain open; Justin SSO and hosted opening passed.
The user confirmed 100-card pointer autoscroll/drop in the memory-only fixture. Basic pointer movement/save is user-confirmed. Ordinary eligibility returned zero; dedicated D97 source preview now passes; a separate
memory-only 100/12 UI fixture passed rendering/navigation/keyboard/reset checks but
does not prove saved maximum-capacity transactions. Retained D98 reviewer-distribution keys do not support
reviewer-badge visual proof. Deliberate promotion remains pending. New creation requires literal-on
`PROPOSAL_RANKING_WORKFLOW_V2` and `PROPOSAL_RANKING_V2_SCHEMA_READY` in addition to
existing readiness. Both are enabled in the dedicated Preview; Production is unchanged. Full multi-identity acceptance is not established
by the historical waiting-state smoke. Only the authorized sandbox schema, default facilitator and retained synthetic ranking
state changed in this follow-up. No Production change, branch cleanup or merge occurred; dedicated Preview deployment is recorded below.

## Dedicated authenticated test Preview — deployed to dedicated Preview; partial acceptance

[VERIFIED via deployment receipt and hosted browser] Source `d1b206185` is deployed
in dedicated READY Preview `dpl_GCjqpVkTNncxSC2kRzByGLbbspyq` at
`https://wmkf-meeting-transcription-test-h2yh5pkf4.vercel.app`, with stable alias
`https://wmkf-meeting-transcription-test.vercel.app`. The compact card refinements
and expandable total Research funding are included. The release passed 179 ranking
tests and Justin's Microsoft SSO/updated-interface check. This is sandbox deployment,
not Production promotion or independent acceptance by the other three PDs.

[VERIFIED via provisioning logs, READY Preview and saved-round readback] The enriched
rehearsal is deployed from `591c3e98e7f24e699f7f83260a16ab1b1a929167` in Preview
`dpl_BcJwMnCKWAQp9RueY2F4hDNjdPb6` at
`https://wmkf-meeting-transcription-test-9qilqb16b.vercel.app`; the stable test alias
points to this deployment. New round `ea3496d5-c105-4e97-95c0-6b13a2e3f2ef` contains
12 realistic fictional proposals (six MR, six SE) and 36 saved synthetic reviews,
three per proposal, with all four PDs in private preparation and nobody ready.
Fictional institutions, geography, award histories and explicitly labelled sample
discussions use a strict dedicated-test projection; they are not real awards or
accepted human discussion analyses. The 182 ranking tests in 20 suites, scoped lint,
types and DAL/reviewer-boundary/script-writer/API/status gate/self-test pairs passed.
[VERIFIED via hosted browser] Signed-in Justin saw six proposals in each program,
distinct institutions/project titles and three review tiles per card, including
E/E/VG and divergent E/G/F. Both programs remained at 0/6 confidence answers.
History opened the original run read-only, and Open replacement run returned to
the enriched round. Anonymous `/api/proposal-ranking` returned 401. No PD assessment
data changed and no live group reveal occurred in this check; other staff sign-ins
and a full group walkthrough remain pending.

The atomic operator upgrade preserved old round `f48741f0-4560-471d-b51f-ef93db48c152`,
its exact frozen snapshot hash and lists, with previous/superseded links. This was a
fresh source-pool replacement, not a normal UI reset. The commit succeeded once;
a readback DTO typo was repaired and exact-hash/link verification completed without
replaying the mutation (`/private/tmp/ranking-rich-round-receipt.json`). Normal resets
continue to retain the current frozen pool. Production is unchanged.

The dedicated test mode requires the exact project/profile/origin, Preview environment,
test Neon database, registered Dataverse sandbox, real authentication and enforced
DAL/target interlocks. Synthetic reviews remain excluded outside that policy.
The current enriched pool contains 12 proposals and the corrected roster
Beth, Justin, Jean and John Sader, all Preparing. The first-D97 scripted fictional
sentiment fixture previously returned current through the real reader; that receipt
does not prove generation or human analysis. Earlier deployment and fixture details,
including four new TEST files in shared SharePoint, remain in the sandbox audit.
