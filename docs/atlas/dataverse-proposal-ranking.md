# Proposal Ranking storage and activation

Date: 2026-10-07. Status: **Production deployed and enabled**, with schema, dedicated
role and four participant grants verified. Justin is the temporary default facilitator
for the owner-approved trial; Beth must be restored before colleague handoff.
[VERIFIED via Vercel and Chrome] Current Production source is PR #462 merge
`f7a75fc5358649ab30765504ea6e6b35cdf00bb4`, deployment
`dpl_FNFvVWUzPaiNgdQ7Uh1DgK526hHx`, READY with live aliases. Justin's refreshed
D26 facilitator preview displays all 23 institution names. The upper-right rating
dot / lower-right E/W marker placement is built on the feature branch but is not
deployed. The full multi-identity lifecycle remains unverified. The initial PR
#457 deployment is a historical checkpoint; trial reset requirements are below.
Initial activation and rollback receipt: `docs/audits/PROPOSAL_RANKING_PRODUCTION_RELEASE_2026-10-07.md`.
Earlier dated sections below retain historical setup checkpoints; disabled-state
statements in those checkpoints are superseded by this release.

## Isolated local UI and service rehearsal — 2026-10-07

[VERIFIED via source, final 42 focused tests, API-route and route-lifecycle-auth
gates with sequential self-tests, types and Chrome] The standalone command
`node scripts/rehearse-proposal-ranking.js` runs at `http://127.0.0.1:3133` on
loopback only. Its webpack build replaces persistence, source, identity and access
dependencies with temporary in-memory adapters while
using the real Proposal Ranking UI and service. The fixture has six fictional
proposals (three SE and three MR) and three fictional PDs, including the
facilitator. The page supports simulating the other two submissions and switching
role views. Reset clears rehearsal memory after any lifecycle state; a generation
fence rejects actions delayed from before reset. It loads no environment file or
live Dataverse/API service and creates no real staff votes.

Chrome verified opening a synthetic round; simulating both other PDs' submissions;
moving R002 above R001 and submitting the facilitator's SE list (3/3); generating
and publishing the SE composite; and moving R003 above R002 in the meeting list
and saving. The composite showed ranks 1.33, 1.67 and 3.00 and a full requested
total of $457,500. PD A's view showed the published named ranks and saved meeting
order R001, R003, R002. MR remained private, with fictional Casey's own list
locked and program progress at 2/3 submissions. Reset after publication returned
to a clean preview with the acknowledgement unchecked and Open disabled. Desktop
and 390px DOM checks showed
the 24px colored dot above the 24px E/W marker, aligned right with no horizontal
overflow.

Sol identified a reset-generation race and a broken synthetic workbench link.
Corrections make reset fence delayed actions and the linked page explain its fictional
content. A bounded OAuth Opus source review found no blockers and noted only
limitations; it preceded the reset correction. The final 42 focused tests in three
suites passed. API-route and route-lifecycle-auth gates with their self-tests, and
types, passed sequentially. Atlas and documentation-currency gates, plus
fact-consistency checks and their self-tests, passed sequentially. No Production
data, settings, deployment or real staff rankings changed during the rehearsal.
Promotion remains pending owner approval. This does not complete the separate Production blank-slate
requirement: before colleague use, cancel any unpublished trial, restore Beth as
default facilitator, open a fresh round and verify only initial seed orders with
no submissions, composites or meeting edits. Preserve source reviewer scores.

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
not total project expenses. For the owner-approved D26 trial only, the shared
`lib/services/proposal-ranking/trial-cutoff.js` also excludes numeric request numbers
1003220 and higher before downstream reads/new snapshots. Missing/malformed D26
numbers abort; other cycles and existing frozen snapshots are unchanged. The verified
`akoya_requestnum` is a string (metadata receipt in
`docs/plans/evidence/test-request-factory/metadata-2026-09-20.json`), so comparison
is numeric after validation. Both readiness probes share this additional exclusion.
The source adapter paginates and rejects capped reads.
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

## Historical sandbox activation checklist — before Production setup

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
It does not prove authenticated meeting behavior. Sandbox staff grants/default identity,
isolation/runtime flags and browser rehearsal remain open. The selected-staff
direct-table denial proof is limited to the sandbox identity and retained records
in the linked sandbox receipt; the four-participant Production proof is recorded below.
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
because Production reads were outside that run's authorization. The later narrow
owner-approved Production inventory is recorded below.

The browser lifecycle remains unperformed: private rankings, locked submission,
composite publication, meeting reordering and full-requested budget totals. Participant
grants and verified Beth Pruitt facilitator selection in the sandbox remain open per the prior
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


## Owner-approved Production read-only inventory — 2026-10-07

[VERIFIED via `scripts/probe-proposal-ranking-production-readiness.mjs` against
`wmkf.crm.dynamics.com`] The owner explicitly approved eligible-source counts and
ranking-table/application-role presence checks. All Dataverse operations were GETs;
the target interlock remained on. This inventory was read-only; the later owner-approved
three-record marker correction is recorded below. No ranking activation occurred.

| Source cycle | Science & Engineering | Medical Research | Total |
|---|---:|---:|---:|
| D26 (December 2026), after trial cutoff | 11 | 12 | 23 |
| J26 (June 2026) | 1 | 0 | 1 |

The source scan returned HTTP 200, completed all pages, and had zero unmapped meeting
dates. It used the canonical ordinary/test exclusion, Phase II Pending and research
program filters plus the owner-approved D26 request-number cutoff. The complete
scan after the legacy flag correction found 26 rows; two additional D26 requests
numbered 1003220 or higher were excluded, leaving 24 across both cycles. Before
that correction the scan found 29 rows and excluded five. The D26 total stays 23.
It selected only request number, meeting date and program; no proposal titles,
institutions or business rows were printed. These counts do not establish review
completeness, full snapshot eligibility, participant grants or facilitator readiness.

The initial inventory found all three ranking tables and the dedicated role absent.
That pre-provisioning result is superseded by the owner-approved setup below; the
current probe exits 0 with full schema/key and role-privilege/assignment verification.
Activation flags were not inventoried or changed.

Validation of the trial cutoff: 134 tests across 13 ranking/Explorer suites passed,
including the threshold boundary, malformed D26 input and exclusion before downstream
reads. Types and Dataverse/OData/Atlas/documentation gates and self-tests passed
sequentially. Luna implemented; Sol and bounded subscription-OAuth Opus source
reviews found no substantive bug. The orchestrator ran the tests and live probe.
Opus noted the intentional strict failure for malformed D26 numbers, including
nonpending rows in the app's cycle scan; no change was required. Local review receipt:
`/private/tmp/ranking-cutoff-opus-review.txt` (nonportable); this paragraph retains
its verdict and scope. No Production write was part of cutoff implementation; the subsequent exact-row
marker correction below was separately authorized. Ranking setup was pending at that checkpoint; later setup is recorded below.

Production's D26 source pool resolves the sandbox-only zero-proposal concern, but
Production schema, role, participant grants and facilitator configuration are now
complete. Activation still requires separate owner approval. Source proposals stay read-only; ranking workflow actions
write dedicated ranking tables. The source-backed in-app lifecycle remains unverified.

## Production schema and role setup — 2026-10-07

[VERIFIED via existing apply scripts and final GET-only probe] Owner-approved Wave
32 and role setup completed in Production. All three table identities, every declared
attribute/type/bound/option and all three Active keys passed. The verified enabled
Research Review App Suite application user is the sole direct assignee of
`WMKF Proposal Ranking Application User`; no teams hold the role. The role has the
nine specified Global ranking privileges plus nine documented Dataverse defaults,
reported separately. Exact privilege readback rejects unknown extras.

Durable command scope, identity/role IDs, reviews, default-privilege reference and
sanitized successful inventory:
`docs/audits/PROPOSAL_RANKING_PRODUCTION_SETUP_2026-10-07.md`.
This supersedes the earlier absent-schema/role inventory. No source records, ranking
business rows, participant grants, facilitator setting or activation flags changed
in this setup. Subsequent Production direct-table denial and search exclusion passed
for four participants; populated audit/navigation and multi-identity in-app acceptance
remain unverified. The app remains disabled;
promotion/activation are still the owner's separate decisions.

## Legacy test-marker correction — 2026-10-07

[VERIFIED via `scripts/maintain-proposal-ranking-d26-test-markers.mjs --apply`]
The owner explicitly authorized setting only `wmkf_istestrequest=true` on Production
requests **1003220, 1003221, 1003222**. Each conditional PATCH succeeded and exact-row
GET readback verified true plus unchanged null `wmkf_testcreationrunid`. No other
request fields, factory ledger/provenance, ranking schema/roles or activation were
changed by the command. Under the existing classifier these marker-only legacy rows
are anomalies, display as tests and are excluded from ordinary flows; no fake run
ID was assigned. The subsequent complete source count is recorded above. Two other
rows still need the owner-approved D26 numeric exclusion; the cutoff remains.

The command defaults to GET-only inspection. The separate local-only client method
accepts only those three request numbers on the registered Production host, internally
resolves each unique GUID and ETag, and permits only the true-only marker PATCH using
a private proof. Normal marker writes remain denied, including generic factory-option
PATCH. The Dataverse interlock and dated write acknowledgement remain required.
Each result is emitted immediately; transport uncertainty triggers readback, not a
blind retry, and confirmed write status is distinct from verified final flag state.

Validation: 81 tests in four client/marker suites, syntax, types and Dataverse/OData
gates/self-tests passed. Luna implemented; Sol and subscription-OAuth Opus reviewed.
Partial receipts, missing run-ID projection rejection, uncertain-write readback and
confirmed-write attribution were corrected before execution. Opus found no blocker;
its nonblocking uncertain-readback message was clarified. Local review receipt:
`/private/tmp/ranking-marker-opus-review.txt`; live receipt:
`/private/tmp/ranking-marker-apply.log` (nonportable). All three durable outcomes:
`verified-marked`, `applied=true`, `patchResponseOk=true`, `patchError=false`,
`runIdPresent=false`. No further write authorization is inferred from this receipt.

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
that field into its fingerprint and frozen snapshot. The initial shared-card
implementation showed a prominent E/W in the upper-right corner with an accessible
East/West institution label. The marker-placement follow-up below moves it to the
lower-right. Unknown/missing values and older snapshots show no letter. Existing snapshots
are not rewritten or live-refreshed; ranking calculations and eligibility are unchanged.
Failed/capped account queries reject the preview through the existing complete-read
contract. No schema, environment, grant or live data changes were made.


Geography validation: 123 tests across 12 ranking/Explorer suites pass, including
raw account choices, unknown values, frozen preview/fingerprint and legacy-card
omission. Changed-file lint, types, Dataverse/OData and Atlas/doc gates pass with
self-tests run sequentially. The actual card component was rendered in isolated
Chrome with synthetic fixtures at 1100px and 390px: markers are 24px, at the upper
right in the original layout, with no horizontal overflow. This is a component
layout check, not live sandbox acceptance; the later marker placement is verified
in the isolated rehearsal section above. Luna implemented; Sol and the orchestrator reviewed without
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

The initial shared-card implementation displayed a 24px lower-right circle using
ten solid colors from red through yellow to green, from the frozen `score.mean`.
The marker-placement follow-up below moves it to the upper-right.
`reviewerScoreIndicator` in
`shared/components/proposal-ranking/model.js` selects
`Math.round(((mean - 1) / 4) * 9)` for finite means in [1,5] with at least one rated
review. Other inputs show gray. The numeric score remains visible and the circle
has a named image role and hover text. Equal colors do not assert exact ties.
This presentation mapping works independently of reviewer count; it does not
change source reads, snapshots, displayed scores, seed ordering or composites.


Validation: 126 tests in 12 ranking/Explorer suites pass; lint, types, Atlas and
currency gates/self-tests pass. Isolated actual-component Chrome renders at 1100px
and 390px verified all ten colors plus gray, 24px circle dimensions, editable and
read-only placement in the original layout, and no overflow. The later marker
placement is verified in the isolated rehearsal section above. Luna built; Sol and one bounded subscription
OAuth-only Opus source review approved. Opus's nonblocking tooltip-rounding note
was corrected to use the same rounding as the visible score, with a regression
for 4.35 → 4.4. No additional review loop or live data access was needed. Local
review receipt: `/private/tmp/ranking-rating-opus-review.txt` (not portable).

## Historical Production access and privacy checkpoint — 2026-10-07

[VERIFIED via live apply and independent GET readback] Beth Pruitt is the configured
default facilitator. Justin Gallivan, John Sader, Jean Kim and Beth have app grants;
other grants are unchanged. D26 remains 23 requests (11 SE / 12 MR). All four
effective staff identities lack ranking Read privileges; 12 collection requests
returned 403, with three app-200/empty controls. Search excludes all three tables.
Receipt: `docs/audits/PROPOSAL_RANKING_PRODUCTION_ACCESS_PRIVACY_2026-10-07.md`.

The app is disabled and tables empty. Git comparison shows origin/main lacks the
branch generic-reader privacy guards: deploy these before opening a live round.
Promotion/activation and full browser acceptance remain owner decisions. Effective
impersonation is not staff OAuth browser proof or populated audit/navigation proof.

## Historical Production activation checkpoint — 2026-10-07

[VERIFIED via full preview builder, single-variable config readback and Chrome]
Both ranking flags are on; both isolation flags and Dataverse controls remain on.
The deployed source includes unconditional generic-reader privacy guards before
activation. D26 full preview passes: 23 requests (11 SE / 12 MR), four grants,
USD with no missing amounts, 9 East / 14 West, no unscored proposals, and 51
outstanding review assignments. Opening freezes the then-current inputs.

Justin's signed-in view is correctly waiting for Beth to open D26. No browser
session for Beth or other PDs was available, so full lifecycle acceptance and
populated indirect-reader verification remain open. No source or ranking rows
were written during release. See the current release receipt above for exact
artifacts, CI, review, authorization and the disabled-with-privacy rollback.

## Temporary facilitator and mandatory clean-start handoff — 2026-10-07

[VERIFIED via existing Admin-service conditional write and readback] Owner approved
Justin Gallivan (`29b0de0d-4ff7-ee11-a1fd-000d3a3621c7`, profile 2) replacing Beth
as default facilitator for testing. Enabled identity, active profile and ranking
grant were revalidated by the service. Setting revision changed from
`W/"103053119"` to `W/"103053545"`. No other setting, grant, round or source data
was changed. This is Justin acting as himself, not impersonating Beth.

[OWNER REQUIREMENT] Trial PD rankings must not carry over to colleague use. Preserve
source reviewer scores. Keep any trial round unpublished, then cancel it, restore
Beth's default GUID `b6f1cd38-0973-f011-bec3-6045bd0510d4`, and open a fresh round
with current source inputs. Canceled history is retained. Confirm no submissions,
composites or meeting edits in the fresh round. The existing service blocks cancellation
after either program is published; do not cross that boundary for this trial without
a separately agreed reset-safe path. This reset is still pending, not completed.
Production activation and all four grants remain on; colleague access is not isolated.

[VERIFIED via signed-in Chrome after the facilitator change] Justin now sees the
D26 facilitator preview: 23 proposals, four PDs, 51 outstanding reviews, zero
unscored. The Open round acknowledgement remains unchecked; no round was opened.
The institution-name defect observed here is addressed by the correction below.

## Institution-name source correction — 2026-10-07

[VERIFIED via Production metadata and GET-only D26 account probe] The request
`akoya_applicantid` lookup targets `account`; entity metadata declares
`PrimaryNameAttribute=name`, `PrimaryIdAttribute=accountid`, `EntitySetName=accounts`.
All 23 eligible applicant accounts have names. The request-side
`wmkf_organizationname` cache was null for 14 and “N/A” for one. Examples: request
1002852 resolves to Johns Hopkins University; 1003034 to University of Texas
Southwestern Medical Center; 1003074 to Regents of the University of California
at Santa Barbara. No source data was changed.

The adapter now selects `accountid,name,wmkf_eastwest` in the existing paginated
applicant query and maps organization from that account's name. It removes the
request cache from its projection and does not fall back to stale request text.
Missing accounts/names retain the honest unavailable display. Name and geography
share the applicant record; scores, eligibility and budget calculations are unchanged.
Preview fingerprints already include names; new rounds freeze the corrected value.
Existing frozen snapshots are not rewritten. Keep the owner trial unpublished and
reset it before colleague use as required above.

Validation: 28 tests across source, preview, preview service and page suites pass;
lint, types, Dataverse/OData and Atlas/currency gates with sequential self-tests pass.
The full live read-only preview reports 23 names, zero missing/placeholder names,
`canOpen=true`, four PDs, 11 SE / 12 MR and unchanged 9 East / 14 West. Luna built;
Sol and one bounded subscription-OAuth Opus review found no substantive blocker.
No source writes, new round, score edits or snapshot backfill occurred.

[VERIFIED deployed and browser-checked] PR #462 merged as
`f7a75fc5358649ab30765504ea6e6b35cdf00bb4`; Production deployment
`dpl_FNFvVWUzPaiNgdQ7Uh1DgK526hHx` is READY with live aliases. Justin's refreshed
D26 facilitator preview displays names on all 23 cards, no unavailable/N/A labels,
including Johns Hopkins, UT Southwestern and UC Santa Barbara. Open acknowledgement
remains unchecked; no round was opened. Full CI passed on `e9d40cfc5`; the final
merge `cc6ef1823` changed only SESSION_PROMPT.md to retain the concurrently restored
main handoff, passed documentation gates, and had identical runtime/test source.
The mandatory unpublished-trial reset before colleague use remains in force.

## Card marker placement — 2026-10-07

[VERIFIED via current feature-branch source] `ProposalRankingApp.js` now places
the 24px colored reviewer-rating dot at the card's upper right and the accessible
East/West initial at the lower right. Both keep their existing size and named
image role/label/title. This is a source-only UI change: it has not been deployed
to Production, and Production cards continue to show the previously deployed
placement. It changes no score, ordering, eligibility, snapshot or persisted data.
