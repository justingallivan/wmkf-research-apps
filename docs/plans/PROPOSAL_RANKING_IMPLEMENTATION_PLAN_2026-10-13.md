# Proposal Ranking — implementation plan

Date: 2026-10-13. Status: **IMPLEMENTATION IN PROGRESS on `codex/proposal-ranking-v2`; UX accepted and app work authorized. Not deployed or enabled.**
Product authority: revision 5 of `docs/plans/PROPOSAL_RANKING_DESIGN_2026-10-07.md`.
API boundary: `docs/plans/PROPOSAL_RANKING_API_CONTRACT.md` §§1–5 are existing;
§6 is the replacement contract. Storage inventory: `docs/atlas/dataverse-proposal-ranking.md`.

## Current implementation receipt — 2026-10-13

The owner accepted UX brief revision 3 and requested implementation including smooth
dragging and all-stage resets. [VERIFIED via branch source] The build adds private
MR/SE assessment, explicit per-grade paired combined merge, confidence/confirmation,
ready/reopen, immutable all-ready reveal, collective edits, non-destructive resets,
paged history, authorized group sentiment and a saved-revision two-sheet workbook.
The original version-1 path remains separate. No deployment or Production writes occurred;
owner-authorized sandbox setup and retained synthetic writes are recorded below.

Selected persistence: additive wave33 `wmkf_workflowjson` (65,536) and
`wmkf_assessmentjson` (524,288), using existing round/list entities. Current read keys
are bounded to active preparation/reveal; history pages contain at most ten entries.
Immutable operation receipts use `o:<UUID>` list keys and bind the original request.
A supported opening is capped at 100 proposals and 12 distinct PDs; serialized field
limits are checked before changeset dispatch. The supported maximum still needs live capacity rehearsal; the six-proposal/four-persona
sandbox run below proves only its bounded Dataverse changesets. Resets retain old rounds/reveals and never DELETE.

New creation requires both `PROPOSAL_RANKING_WORKFLOW_V2=on` and
`PROPOSAL_RANKING_V2_SCHEMA_READY=on`, in addition to existing ranking readiness.
Unset/other values do not enable v2 creation. Neither flag was enabled by this task.
Once v2 data exists, keep a v2-aware reader as the rollback floor.

[VERIFIED via sandbox setup/readback and saved rehearsal, October 13] Both wave33
fields are now applied with exact metadata and Beth is the sandbox default facilitator.
Thirteen retained D98 service-persona checks passed with six fictional proposals and
four enabled sandbox identities, including all-stage resets, stale writes, replay,
preserved reveals and two-sheet workbook export. This supersedes the earlier absent
fields/setting probe. The eligible source pool remains empty. Independent SSO/app-grant
acceptance, live sentiment and saved-browser acceptance are not established; Chrome
blocked port 3136 with `ERR_BLOCKED_BY_CLIENT`. The retained fixture's numeric review
distribution keys also prevent using it as reviewer-badge visual proof. See the
[bounded sandbox receipt](../audits/PROPOSAL_RANKING_V2_SANDBOX_REHEARSAL_2026-10-13.md).
`probe-proposal-ranking-readiness.mjs --workflow-v2` checks additive attributes.

Local verification: 19 ranking suites / 134 tests pass; the production Turbopack build,
type check and scoped lint pass (the build retains four unrelated document-renderer
tracing warnings). The 100-proposal / 12-PD reveal fits the additive field cap in a
serialized fixture. Tests cover pure calculations, atomic adapter simulations, stale writes,
replay after later edits, immutable history, restart, workbook types/provenance, and
sentiment batching/access loss/reveal races. The isolated browser rehearsal renders
the actual React component against fictional in-memory workflow state; it is not an
alternative live backend. Keyboard movement across the funding bar, tally changes,
collective reset, dialog focus return, reopening and a narrow 390px layout were checked.
Fresh review found StrictMode refresh, restart-tab and numeric-history ordering bugs;
all three were fixed with regressions. Full multi-person saved-data acceptance,
long-list drag/autoscroll and final release review remain open. Client edits are
serialized by disabling movement during saves; failed/uncertain operations retain
an explicit recovery action rather than replaying a drag automatically.

Documentation updates cover current Ranking status in the design, brief, API/Atlas,
service catalogue, route matrix, sentiment plan/Atlas and session routing. This is a
bounded changed-surface update, not an exhaustive audit of unrelated session history.

The numbered build sequence below remains the acceptance checklist. Historical
pre-build documentation receipts at the end describe their dated scope only.

## 1. Outcome and evidence

Deliver separate score-seeded MR/SE preparation, A/B/C bars and confidence, explicit
paired merging into each PD's combined ranking, all-ready facilitator reveal, one
collective recommendation, authorized discussion sentiment and a two-sheet workbook.
Provide confirmed resets at every stage so PDs can repeat the complete walkthrough.
Keep each revealed version intact; resets create new working versions, not deletions.

[VERIFIED via local source] Main runtime at `b3219f4aa` is unchanged by docs commit
`3025c31d9`: it implements separate program submissions and publication. The source
trace is retained in the explicitly historical revision-4 reconciliation report,
`docs/audits/PROPOSAL_RANKING_WORKFLOW_RECONCILIATION_2026-10-13.md`.
The paused local branch at `0d161d60f` adds group-program interleaving, Research funding
context, CSV and a destructive dry-run reset; it does not implement individual
combined preparation. The original planning comparison did not probe remote PR/deployment/schema/grants.
The later sandbox setup and bounded saved rehearsal are recorded above; Production
and independent participant access remain outside that proof.

Existing seams to extend, subject to implementation tests:

| Flow hop | Existing source | Required change |
|---|---|---|
| UI and asynchronous state | `shared/components/proposal-ranking/ProposalRankingApp.js`, adjacent `client.js` | Stage views, bars, confidence, combined confirmation, ready/reveal/reset, history and workbook; preserve save queues and stale-response guards. |
| Authenticated entry | `pages/api/proposal-ranking.js` | Versioned allowlisted actions and payloads, same session-derived actors/app grant/private no-store/DAL context. |
| Workflow and response privacy | `lib/services/proposal-ranking/service.js` | Version-aware reads, new preparation/reveal/reset transitions, atomicity, durable operation readback, filtered history. |
| Deterministic calculations | `lib/services/proposal-ranking/calculations.js` | Thirds, pair merge, exact combined rank sums, unanimous outer blocks, section totals; no score weighting from grades/confidence/history/sentiment. |
| Source snapshot | `lib/services/proposal-ranking/preview-service.js`, `lib/dataverse/adapters/proposal-ranking-source.js` | Preserve eligibility/roster/scale/currency; adapt qualified Research count/latest year. |
| Persistence | `lib/dataverse/adapters/proposal-ranking.js`, `lib/dataverse/schema/wave32-proposal-ranking/` | Additive versioned fields/keys and conditional multi-row transitions; retain old records. |
| Sentiment | `lib/services/post-presentation-materials/discussion-sentiment-reader.js` | Optional live authorized enrichment of active group cards only, never frozen private data. |
| Export | New ranking workbook helper using an inspected supported workbook dependency | Two sheets from one saved group revision and its matching revealed inputs. Branch CSV is only a formatting/security reference. |

## 2. Proposed storage and transition design

This section is an **engineering proposal**, not a provisioned schema claim. Use the
existing three app-owned Dataverse entities; no new Postgres store, Blob store,
model call or ranking table is proposed. Verify field limits, schema naming and
changeset capacity before implementing this mapping.

- New rounds use snapshot version 2. Keep explicit version-1 readers for old rounds;
  never invent grades/confidence or reinterpret old per-program votes as combined.
  Unknown versions fail closed. Existing version-1 mutation behavior stays separate.
- Add a round workflow JSON field for active preparation version, active reveal
  identity and stage. Add a list assessment JSON field for two boundary positions,
  confidence by request ID, combined source versions/confirmation and ready receipt.
  Selected names are `wmkf_workflowjson` and `wmkf_assessmentjson` in additive
  `wave33-proposal-ranking-assessments`. They are now provisioned and metadata-verified in the sandbox; Production was not changed.
- Keep order in the existing order field. Derive grades from order plus boundaries;
  do not keep a second writable grade map. Validate `0 <= first <= second <= N`,
  integer positions, exact proposal membership and confidence keys/allowed values.
- Use preparation-version-qualified PD list keys for `se`, `mr` and `co`; use a
  reveal-qualified collective key. Keep keys within the existing 100-character
  limit and program discriminators within two characters. Readers query only the
  active version for live calculations, with separate authorized paginated history.
- A reveal's immutable composite contains the contributing PD identities, orders,
  boundaries, confidence, source versions, exact rank sums, baseline order and
  initial collective bars. Mutable collective order/bars are stored separately.
  Preserve each reset's replaced collective revision in a distinct history record.
- Reuse existing status values only under an explicit version-2 interpretation:
  draft PD rows plus version-bound readiness metadata; a revealed collective is
  published. Do not make old `submitted` or `composite-draft` values mean new readiness.
  Every status map, reverse map, projection, privacy filter and export must dispatch
  on snapshot version before interpreting these rows.
- Record each reset/reveal outcome with operation UUID, actor, originating version,
  resulting version and timestamp in retained records. Do not rely solely on the
  existing last-operation field or bounded administration log for replay safety.
  Choose an immutable operation-receipt row key within the list entity for transitions
  that have no newly created round/reveal record; explicitly distinguish it from
  list rows in queries/parsers. Store only bounded metadata, not a duplicated pool.

Capacity is a build gate: existing snapshot cap is 512 KiB, order/composite 64 KiB,
and admin log 128 KiB. Test maximum supported roster/proposal payloads with confidence
and provenance included. If immutable reveal exceeds its cap, add an explicitly sized
memo field or split per-PD revealed copies before shipping; never truncate or quietly
omit PDs. Establish a tested supported maximum and reject over-cap opening/reveal
before any write. Repeated resets must not increase the current response size without
bound: page history and retain it without loading it into every active read.
No retention deletion is authorized; future retention policy is separate work.

All assessment writes also conditionally touch the round, retaining main's shared
serialization point. A transition reads and validates the whole required set, then
one Dataverse changeset fences the round, relevant lists and coordinator when used.
No participant loop with partial commits. A schema/capacity/transaction-limit failure
blocks the operation before publication; it does not reveal a partial roster.

## 3. Reset semantics and races

| Operation | Stored result and invalidation |
|---|---|
| Reset own MR/SE | New saved version of selected program at frozen reviewer seed/thirds, confidence unanswered; invalidate readiness and combined confirmation. Preserve the other program. Available in private preparation; ready PD first reopens. |
| Rebuild own combined | Explicitly replace combined order/bars/confidence from latest saved program versions. Clear readiness; require combined review/confirmation. Program edits mark the existing combined draft out of date but never overwrite it automatically. |
| Reopen own ready state | Keep work, clear version-bound readiness. Subsequent edits cannot race a reveal unnoticed. |
| Reopen after reveal | Facilitator creates next preparation version by copying the preserved individual combined assessments and source program lists; clears all readiness and active collective pointer. Prior reveal/group revisions remain read-only history. New private edits stay private. |
| Reset collective | Facilitator snapshots current group revision, then restores the same reveal's calculated order and unanimous-A/C bars. Original individual inputs and reveal identity do not change. |
| Restart walkthrough | Facilitator creates a new version-2 round from the same frozen source pool/roster/seeds, with thirds, confidence unanswered, no confirmed combined lists or ready PDs. Atomically supersede the old run and update cycle coordinator. Retain old run and outcome receipt. |

Engineering default for restart: use the frozen source snapshot to make rehearsal
repeatable. A fresh source pool requires separate preview/open review. Keep current
facilitator authority when restarting; preserve old actors/history. Use the existing
canceled state plus explicit superseded reason/link for old runs only if all readers
handle that distinction; otherwise add a reviewed explicit state before enabling it.
Do not reactivate historical rounds by merely replacing the coordinator pointer.

Every operation includes round identity, preparation/reveal scope, expected ETags,
policy revision and operation UUID. Server-issued reset confirmations bind exact
scope and impact to those versions. The service computes authority and scope; client
flags never waive readiness, privacy or lifecycle rules. Facilitator-only shared
resets remain available after reveal, group editing and export, without a dry-run flag.
A facilitator cannot reset someone else's individual draft in place.

If save/reopen wins the round fence, reveal revalidates and fails as stale; if reveal
wins, the late private write fails. If reset wins, a late collective edit fails against
the old active version. Retrying an already completed transition returns that exact
recorded outcome, even after subsequent transitions; it never repeats a reset.
Timeout/ambiguous changeset results require readback before another operation. Readback
and conflict bodies apply the same authorization and privacy filters as normal reads.

Client scope includes actor, round, preparation version and reveal identity. Invalidate
queued saves, loads and optional sentiment requests on a transition; guard every
post-await success and error state update. Disable ready/export/reset submission
while local changes are pending or uncertain, and resolve the saved revision first.
Server checks remain authoritative even if controls are bypassed.

## 4. Calculation and enrichment details

Proposed deterministic thirds: distribute the remainder from A to B to C. For N,
A gets `floor(N/3) + (N%3 > 0)`, B gets `floor(N/3) + (N%3 > 1)`, C gets the rest.
This yields N=1 → 1/0/0, N=2 → 1/1/0, N=4 → 2/1/1; empty lists have 0/0 bars.
These are editable defaults, not quotas or already-confirmed grades.

Merge independently within each grade: paired MR/SE positions, reviewer mean within
the pair, complete the pair, then leftovers. Equal/missing score fallback is numeric
request number then GUID; known score precedes missing. The merged bars count the
source grades, not thirds. Once confirmed, the combined assessment is the sole vote.
Average exact combined ranks equally across all PDs. Resolve equal sums by reviewer
mean, numeric request number, GUID; display distinct positions without tie badges.

For initial collective bars, scan the calculated list from the front while every PD
says A, and from the back while every PD says C. Do not move any card to enlarge those
blocks. No A prefix means first bar 0; no C suffix means second bar N. Confidence does
not change unanimity. All-A/all-C/empty middle/no consensus cases must remain valid.

Research history: adapt the branch classifier and complete all-history source read,
retaining qualifying Research exclusions and provisional/unavailable distinctions.
Expose count and most recent qualifying award year, omitting funding dollars. Verify
the year derivation (fiscal-year field, then meeting/decision date fallback) against
source before settling the display; label any uncertain year rather than inventing it.
Capture history with opening source provenance; resets do not refresh or alter it.

Sentiment: enrich only the active revealed group view after ranking authorization and
live Meeting Tracker authorization. Batch up to 50 IDs through the existing reader.
Recheck on group-view load, refresh, return to the tab and opening expanded details;
clear previously shown enrichment before refreshing and on stage/auth changes. A
withdrawal is removed at the next check; do not promise push-based instant withdrawal.
No cross-request cached quotes, frozen ranking sentiment or historical quote export.
Distinguish Not available from access denial and temporary dependency failure; all
remain optional and never block saving, ranking, resetting or exporting.

Workbook: read one confirmed group revision plus its matching immutable reveal.
Include round/reveal/revision and export time as provenance so old downloads remain
identifiable after resets. Use numeric cells for amounts/ranks and safe text cells
for untrusted titles/names; prevent formula injection. Export fails clearly on a
stale requested revision or unavailable source, never mixes two revisions. No new
finalization lock and no sentiment. Inspect the installed workbook dependency before
choosing reuse or adding one. The branch reuses the existing ExcelJS dependency.

## 5. Build sequence and acceptance gates

Begin with the documentation-only UX phase below; subsequent implementation phases
are reviewable increments on a feature branch. Bring the
current design into the paused branch deliberately or start a clean branch; do not
merge its incompatible combine/reset/CSV behavior wholesale.

| Phase | Deliverable | Required proof before advancing |
|---|---|---|
| 0. Impeccable shape — before app code | Review the agreed workflow and incumbent interface; produce a concise UX brief with screen sketches and interaction specifications. | Owner confirms the brief or supplies one correction round. Keep agreed ranking rules, privacy and reset semantics intact; no app code. |
| 1. Baseline and compatibility | Inspect current main/branch changes, live test-environment schema/role, source eligibility and existing rounds. Finalize versioned field/DTO mapping and caps. | Old-round fixtures readable without fabricated assessments; raw persisted field/status fan-out audit; unknown versions fail closed. |
| 2. Pure assessment calculations | Thirds, boundaries, pair merge, exact combined aggregation, unanimous bars and section totals. | Adversarial short/unequal/empty lists, alternate pair winners, equal/missing scores, strict permutation, no weighted confidence/history/sentiment. |
| 3. Additive persistence and private preparation | New schema/readers/writers, own program/combined edits, explicit rebuild, readiness/reopen and own reset. | Actor isolation, combined invalidation, transactional order/bars/confidence saves, cap tests, replay and stale-write cases. Probe schema after approved application. |
| 4. Reveal and shared resets | Atomic all-ready reveal, collective edits, reopen after reveal, collective reset, full restart, read-only history. | Two-identity concurrent saves/reveal/reset; all-or-nothing failure injection; retry after later edits; coordinator conflict; no deleted reveals or cross-version votes. |
| 5. Complete interaction | Private MR/SE and combined views, draggable/keyboard bars/cards, ready progress, reveal, group comparisons/totals and clear reset confirmations. | Browser walkthrough with separate PD/facilitator identities, focus/keyboard accessibility, pending-save and stale-response behavior, private payload inspection. |
| 6. Context and workbook | Research count/year, optional authorized sentiment, two-sheet saved-revision XLSX. | Missing/provisional history, present-but-unauthorized sentiment, withdrawal/currentness, >50 IDs, dependency failure, workbook cell types/provenance and reset/export race. |
| 6a. Impeccable critique and audit — working interface | Review the complete built flow, including context-rich cards and reset/export states, for usability, visual hierarchy, accessibility and responsive behavior. | Record prioritized findings, fix the agreed batch, and verify once more. No unresolved blocking usability/accessibility defects before rehearsal/release review. |
| 7. Rehearsal and release review | Repeatable local/sandbox walkthrough at every stage, source/Atlas/API/catalogue updates and scoped gates. | Complete acceptance matrix below, independent whole-flow review, sandbox receipt and deliberate promotion/rollback plan. No production changes inferred from test success. |

### Impeccable review scope and limits

Phase 0 draft: [Proposal Ranking UX brief](PROPOSAL_RANKING_UX_BRIEF_2026-10-13.md),
revision 3, with four sketches including a movement storyboard. The earlier cards
serve as a content checklist, not a fixed visual design; retain their smooth dragging
using the branch's existing `@hello-pangea/dnd` integration. Reviewer grades and named
PD comparisons remain visible by default, with restrained grade colors, confidence
symbols and an aligned amount column. The owner confirmed shared-screen discussion plus PD
laptops and accepted revision 3; app implementation is now authorized. See the current receipt above.

**Before implementation — shape:** use the installed Impeccable skill's context and
shape workflow, in Operate mode. Read the existing product/design context and inspect
the incumbent interface; preserve its established visual language unless a change is
explicitly agreed. Treat the revision-5 product decisions as settled inputs, asking
only about material interaction gaps. Focus the brief and sketches on:

- Navigation between MR, SE and combined preparation, including out-of-date combined
  work, explicit rebuild, readiness and the move into group discussion.
- Card and separator movement, confidence controls, keyboard alternatives, focus and
  feedback; distinguish A/B/C assessment from collective funding sections.
- Group-card hierarchy: proposal/reviewer information, individual disagreement,
  Research history and optional expandable sentiment, without crowding the list.
- Reset confirmations that explain scope, replaced work and preserved history;
  private versus shared versions, pending/uncertain saves, and read-only past reveals.

Deliver one concise brief with representative screen sketches and interaction/state
specifications, including empty/loading/error/permission states and realistic long
lists. Present it for owner confirmation or one correction round, as shape requires;
then stop. This is a bounded UX planning step, not a second product-policy negotiation
or authorization to implement. Record the confirmed brief beside this plan and link
it here before building; do not claim that it already exists.

**After phases 5–6 — critique and audit:** inspect the working UI using realistic
proposal content and separate PD/facilitator roles. Critique task clarity, hierarchy,
card density and reset language; audit keyboard operation, focus, accessible names,
contrast, drag alternatives, responsive layouts and material error/permission states.
Check desktop and narrow-screen layouts together. Produce one prioritized findings
list, fix in one batch, then perform at most one confirmation pass. Record any deferred
nonblocking issues explicitly; do not expand into open-ended visual polishing.
The UX review complements, and does not replace, transaction/privacy tests or the
multi-person acceptance walkthrough. Phase 0 is complete and accepted. The current implementation receipt records the
bounded local UI checks and remaining phase-6a/7 acceptance work.

Do not split phase 4's durable reveal/reset safety across releases where an incomplete
transition becomes callable. UI can follow durable service tests, but new public
workflow remains disabled/unavailable until its complete contract is ready.

Acceptance walkthrough: seed → reset a program → grade/confidence → merge → reorder →
edit a program → explicit rebuild → ready → own reopen → ready all → reveal → group
edits → collective reset → group edits → export → reopen private preparation → new
ready/reveal → full restart. Exercise full restart at private, ready, revealed and
exported stages. Verify prior reveals and group revisions remain readable but never
contribute to active calculations. Repeat with two browsers and delayed/failed writes.

Run relevant unit/integration/browser tests plus gates for API security, Atlas,
Dataverse access/context/interlock boundaries, status parity and docs. Pair each gate
with its self-test sequentially. Negative privacy tests must contain actual peer
assessments/quotes that would leak if filtering were broken. Update schema readiness
probe, API security matrix and catalogues if their surfaces change; no new route count
is presumed. Dataverse schema uses the existing schema tooling, not Postgres setup.

## 6. Rollout and rollback

Follow `docs/CAMPAIGN_RELEASE_AND_DATAVERSE_TEST_STRATEGY.md`: runtime work is a
feature-branch/test-environment change, followed by deliberate promotion. Before live
writes, verify current target interlock, app role, grants, facilitator, existing active
rounds and schema. Preserve generic-query/search/export exclusions for all ranking
rows, including receipts/history. Main's Create/Read/Write role is the starting point;
non-destructive resets do not justify adding the branch's Delete privilege.

Apply additive schema first, then establish a tested version-2-aware compatibility
release before enabling version-2 creation. The rollback floor must still read the
new version and fail safely on its writes. Do not roll back to today's version-1-only
parser after creating version-2 active rounds. If rollout fails, stop new writes and
retain rounds/receipts for diagnosis; never erase data or silently restore an old
coordinator pointer. Owner-approved legacy-trial cleanup is a separate operation.

## 7. Historical pre-build contract review and documentation receipt

Contract-reconcile Mode A: whole-flow and durable surfaces are mapped in §§1–6;
partial success and stale async state in §3; helper semantics in §4; status/projection
fan-out and verification in §§2/5. No helper extraction or runtime mutation occurred.
Sweep Mode A: changed facts are rebuilds, unanimous initial bars, qualifying Research
scope, and all-stage resets. The owner's conversation is product authority; the
cited main/branch sources establish current implementation, not live activation.

Engineering recommendations above are **PLANNED / NOT RUNTIME-TESTED**. Disconfirming
checks before implementation: old `parseRound` accepts only version 1; current list
query retrieves all round rows; existing memo caps may reject a multi-PD reveal;
branch reset deletes records and requires a dry-run flag. These prevent claiming
simple reuse or compatibility without the phase-1/3 tests. No remaining product
choice blocks an authorized build; live state and capacity remain verification tasks.

### Documentation verification receipt — 2026-10-13

Independent read-only review approved decision fidelity and plan plausibility, with
no substantive corrections. It spot-checked the version-1 parser and branch dry-run
restriction. This does not validate implemented transactions, schema capacity, live
permissions or deployment; no runtime tests or live probes were performed.

Sweep restatement inventory: design/API were structurally updated; ranking Atlas,
SESSION routing and historical audit boundary were corrected; two sentiment consumer
documents were extended for reopen/reveal privacy. Overview/catalogue remain AGREE
with the broader planned workflow. Prior handoffs/audits are HISTORICAL; unrelated
reviewer-ranking and other revision-number matches are UNRELATED. Searches across
docs, memory, wiki, root instructions and rules found no competing current workflow.
Repeated revision/reset/rebuild/history-scope searches found zero remaining live STALE
claims within this changed-fact scope. Old runtime behavior is intentionally retained
under existing-source headings; historical revision-4 questions do not govern rev5.

All 25 scoped checks passed: Atlas, doc currency, fact consistency, canonical pointers,
docs catalogue, drain-table mentions, prompt-storage mentions, doc-symbol references,
build-claim freshness, agent wiki, memory router, harness framing and scaffolding tokens,
with each defined self-test sequentially. Diff whitespace check passed. Runtime files
are unchanged from the cited baseline. These checks cover documentation integrity,
not correctness of the proposed workflow.

Sweep verdict: **RECONCILED for the bounded changed decisions and documentation**.
Plan verdict: **READY FOR THE PRE-BUILD SHAPE PASS**; app implementation follows a
confirmed UX brief and an owner request for app changes, with the verification gates
above. No ranking-policy choice remains open; live-state and capacity
claims remain UNKNOWN / NOT TESTED until implementation preflight. This receipt is
not implementation acceptance or permission to deploy.

### UX review sequencing amendment — 2026-10-13

Owner requested adding Impeccable reviews to this plan: shape before app code, then
critique/audit against the working interface. Phase 0 and phase 6a above are new planned
gates; the earlier independent review and 25-check receipt cover the preceding plan
revision, not execution of these reviews. This amendment changes no product rule or
runtime behavior.
