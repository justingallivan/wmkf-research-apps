# Proposal Ranking workflow reconciliation — 2026-10-13

Status: source comparison and documentation reconciliation; revision 4 is **PLANNED**.
Owner authorized design/docs only. No app, schema, role, grant, live data, branch
merge, push, or deployment change is part of this task.

## Scope and evidence boundary

Sweep Mode B: Proposal Ranking workflow, implementation-versus-design status, and
its sentiment/funding/export consumers. Contract-reconcile Mode A: compare the whole
flow and preserve required invariants before any implementation plan.

Entry points: ranking page/client and authenticated route; sentiment consumer reader.
Persistence: existing Dataverse coordinator/round/list rows; sentiment's separate
Postgres store; Markdown documents changed by this task. Consumers: private PD and
meeting views, future workbook, design/API/Atlas/catalogue/overview/session handoff.
Prior findings: October 7 design predates October 11–12 discussion and October 13
owner decisions; paused branch work must not be described as released or as the
newly agreed combined-individual workflow.

Authoritative evidence:

- Owner's current conversation for intent. Earlier assistant proposals (ties, second
  individual assessment round, optional passes, points, notes/rationale controls)
  do not override the final decisions. No new notes/rationale feature is required.
- Main source at `b3219f4aa9a8924eb656693f2b8ce54e490bd901`.
- Read-only local branch inspection at `0d161d60f` in
  `/Users/gallivan/Code/WMKF_Apps-codex-proposal-ranking`; clean at inspection.
  Historical handoff names draft PR #463; no fresh remote PR/deployment check here.
- Existing release/privacy receipts are historical evidence, not fresh live probes.
  Current live grants, facilitator, rounds, flags and reset completion are UNKNOWN.

CodeGraph was consulted first; broad queries missed the ranking service and returned
unrelated symbols, so targeted source reads filled those gaps. The page query did
return its client state machinery. No index or application source was changed.

## Whole-flow evidence and comparison

Paths below refer to main unless explicitly labelled branch. Line references bind
to the source commits above, not future edits. "Planned change" never means built.

| Claim | Producer / persistence / consumer evidence | Existing behavior | Revision-4 disposition |
|---|---|---|---|
| Reviewer seeds and money | `lib/dataverse/adapters/proposal-ranking-source.js:61`; `lib/services/proposal-ranking/preview-service.js:42`; `calculations.js:90,111`; frozen round snapshot → cards | VERIFIED: exact pool, complete source reads, saved rating scale, descending mean, unscored last, common currency and incomplete totals | Keep source safeguards; add initial roughly-third grade separators. |
| Private state and authorization | `pages/api/proposal-ranking.js:27`; `service.js:231` buildRoundResponse; `proposal-ranking.js:103` patchRoundAndList | VERIFIED: session-derived actor, app grant, roster/facilitator filtering; whole-order writes and round/list ETag changeset | Keep protections; extend to grade/confidence/boundary and combined data, not client-only hiding. |
| Individual assessments | `service.js:27` ACTION_FIELDS, `:683` mutateOwnList; `shared/components/proposal-ranking/ProposalRankingApp.js` SubmissionLists | VERIFIED: per-program orders; submit locks permanently; no durable A/B/C/confidence/boundary/readiness fields | PLANNED: grades/confidence, ready/reopen, individual combined order. |
| Pairwise merge | Main calculations and branch `calculations.js:168` combineMeetingOrders; branch `service.js:1019` combineMeeting | VERIFIED: branch interleaves already published program meeting lists using program averages; no individual combined list | Replace that product flow with per-PD within-grade pairs, reviewer ordering inside each pair, leftovers, then explicit PD reordering. |
| Group calculation and ties | Main `calculations.js:137` calculateComposite; `service.js:158` buildCompositePayload | VERIFIED: program rank averages, equal sums ordered by seed, tied badges in response/UI | Average confirmed combined PD ranks; unique positions with reviewer/request-number fallback, no tied badges. |
| Reveal and immutability | Main `service.js:720` mutateMeeting and `:683` mutateOwnList | VERIFIED: separate generation/publication; immutable submitted individual orders and composite versus mutable meeting order | PLANNED: all-PDs-ready single reveal preserving grades/confidence/combined ranks. Ready/reopen is not the existing submit lock. |
| Participation | Main `service.js:874` excuseParticipant; branch ACTION_FIELDS and hasLegacyExcusal | VERIFIED: main still allows excusal; branch disallows new excusal and blocks new partial-roster generation | All PDs respond; no coded pass/recusal. Keep old data readable, no retrofit or deletion. |
| Collective boundaries | Existing card order/cumulative helpers on main and branch | VERIFIED: running totals, no persisted recommendation sections | PLANNED: two movable Recommend funding / Alternates / Do not recommend separators, E/W award counts for slate; no automatic budget assignment. |
| Institution history | Branch `research-funding.js:1–79`; source adapter `readInstitutionFunding`; preview snapshot → ResearchFundingContext | VERIFIED branch-only: qualifying Research scope, count/total/latest cycle, availability and provisional classification; UI displays dollars/latest month-year | Adapt to award count/latest year, no weighting. Confirm coverage/label; missing/provisional must not mean never funded. Main has no history producer. |
| Sentiment | `discussion-sentiment-reader.js:35,62`; accepted store row → source/prompt currentness → map; no ranking caller | VERIFIED producer; PLANNED ranking consumer. Live Meeting Tracker access, 50-ID cap, current/none/out_of_date and infrastructure failure separation | Group cards only after reveal, optional authorized enrichment, no copied stale result or scoring/export use. |
| Export | Branch `shared/components/proposal-ranking/model.js:107` buildRankingCsv; ProposalRankingApp exportOrder | VERIFIED branch-only CSV from saved published meeting list, escaped cells; main no ranking export | PLANNED two-sheet workbook: collective + immutable individual assessments. No new finalization workflow. |
| Source/schema compatibility | `lib/dataverse/schema/wave32-proposal-ranking/`; main service parseRound/parseList, adapter ROUND_SELECT/LIST_SELECT | VERIFIED version-1 snapshots and five existing list status values; branch uses `co` meeting discriminator | New assessment/reveal storage, reader compatibility and payload/version mapping are NOT designed/provisioned by prose. Additive implementation planning required. |

Bounded absence check: searched main and paused-branch ranking services, shared
components and route for `confidence`, `reveal`, `separator`, `grade`, `pd:co`,
`researchFunding`, `getDeliberationSentiments`, and export/combined symbols, then read
the enclosing response builders, action dispatch, source projections and UI consumers.
The branch's reviewer-grade display is not a PD A/B/C assessment implementation.
Existing JSON capability is not evidence that the new durable workflow already exists.

## Contract audits and counterchecks

| Audit | Result / implementation requirement |
|---|---|
| Whole-flow | Traced page → client → route → service → adapter/source → Dataverse → filtered response → cards/totals. Branch funding and CSV plus sentiment reader examined separately. New workflow only documented. |
| Partial success | Main changesets bind round/list writes and operation readback. New reveal must atomically include every ready PD, immutable inputs and collective baseline; per-program success cannot stand in for all-PD reveal. Optional sentiment unavailability must not imply a partial ranking save. No new mutation tested. |
| Async/stale state | Main UI scopeRef/loadRef/mountedRef guards, queues and unresolved-save handling are reuse candidates. Reveal/ready/reopen races and sentiment freshness are new requirements, not proven by old autosave tests. |
| Helper semantics | No extraction performed (N/A). Reuse candidates must retain meanings: program-average interleave is not paired PD merge; qualified Research zero is not never funded; confidence is not weight. |
| Durable surface | Docs only changed. Future grades/boundaries/reveal need versioned storage, schema/readers/writers/response/export alignment. No migration, registry, route count, or app grant changed. |
| Doc reconciliation | Rewrote design and Atlas, separated existing/planned API, retained dated history, corrected catalogue/overview and sentiment consumer guidance, and updated session routing. |
| Symbol/consumer fan-out | No runtime enums/columns changed (N/A for implementation). Read current status maps, snapshot version, ACTION_FIELDS, schema/projections and UI. Future enum/field additions must cover reverse maps, privacy projections and export; no arbitrary status values assigned here. |

Disconfirming checks: branch combined-list code requires published program meeting
rows, disproving "PD combined ranking exists". Main strict ACTION_FIELDS rejects new
assessment/reveal payloads, disproving "only a UI change". Reader grant check disproves
"ranking access alone is sufficient". Branch history classifier excludes categories,
disproving "zero qualifying Research awards proves never funded by foundation".
Pair example in design demonstrates no item can pass an earlier pair despite its
higher reviewer mean. These are source/logic checks, not new runtime test results.

## Durable restatement inventory

| Surface searched | Classification and action |
|---|---|
| Three supplied ranking documents | STALE as a future product guide: structurally rewritten current design/Atlas; actual main API retained under explicit existing-baseline headings, planned changes separate. |
| `docs/SERVICE_AND_UTILITY_CATALOG.md` | STALE Production-untouched/activation-pending claim corrected to dated receipt + verified main source + planned redesign. |
| `docs/SYSTEM_OVERVIEW.md` | STALE pause-for-owner-decisions wording changed to agreed workflow awaiting implementation; live status bounded to historical receipt. |
| Sentiment plan §4.6 and sentiment Atlas | STALE unresolved consumer intent replaced by agreed group-only/current/accepted design; wiring remains PLANNED. Pre-build producer observations explicitly historical. |
| `SESSION_PROMPT.md` | Latest routing updated for the agreement; dated prior-session carryovers preserved as HISTORICAL, not implementation authority. |
| Earlier ranking audit/release/privacy receipts | HISTORICAL dated proofs retained; rev3 approvals do not approve rev4. Detailed old Atlas checkpoints moved into an explicit historical record. |
| API route matrix, app registry, Atlas index | AGREE with implemented route/table/app existence; no new route/table/count to register. |
| Service privacy catalogue entry; generic query/privacy source/tests | AGREE with unchanged privacy protections; no product redesign claimed there. |
| `.claude-memory`, agent wiki, CLAUDE/AGENTS and rules | No competing current Proposal Ranking workflow found. Reviewer-finder ranking/recency memory is UNRELATED. |
| Flat-services move notes/ledger and system overview refresh audit | Historical relocation/inventory evidence, not current workflow authority; unchanged. |
| Paused worktree's docs | HISTORICAL branch snapshot at `0d161d60f`, not edited by this task. Before resuming/merging it, bring in this revision-4 reconciliation and resolve old design/Atlas/API versions deliberately. |

No handoff Word file or workbook was modified. No claim is made about current remote
PR state, live schema/data, funding completeness, or participant access. Those need
separately authorized evidence at implementation/release time.

## Verification record and verdict

Initial checkout was clean on main at the cited baseline; paused worktree was clean.
Startup in this chat passed all 71 defined gate/self-test invocations before the docs
change; that is not validation of revision-4 runtime behavior. Documentation checks and independent review are recorded below.

**Product agreement: consolidated. Implementation: READY WITH NAMED CHANGES to the
engineering plan, not authorized to build or release.** Required named changes are
in design §10: versioned storage, atomic reveal, combined-list revision behavior,
separator edge cases, history scope, sentiment access/freshness and workbook consistency.
Recommendations about code reuse are candidates supported by source, not tested
implementation guarantees. No new behavior was implemented or runtime-tested.


### Reconciliation result

- Evidence inventory: 12 source-comparison rows VERIFIED at the cited local commits;
  the target changes remain PLANNED. Live environment/PR state and funding coverage
  remain UNKNOWN within this task; no runtime acceptance inferred.
- Restatement inventory: 11 grouped surfaces classified on entry — STALE 5, AGREE 2,
  HISTORICAL 3, UNRELATED 1. The five stale groups were structurally corrected.
  Repeated bounded searches found **zero remaining live STALE workflow claims in scope**;
  existing API behavior and explicitly historical records retain their old vocabulary.
- Independent read-only adversarial review approved the decision fidelity and
  main/branch comparison, with one P2 wording finding: the sentiment Atlas conflated
  loopback test execution with Production migration execution. Corrected to distinguish
  the automated-test evidence from the dated deployment/application-use receipt.
- Relevant gates: Atlas, doc currency, fact consistency, canonical pointers, docs
  catalogue, drain-table mentions, prompt-storage mentions, doc-symbol references,
  build-claim freshness, agent wiki, memory router, harness framing, scaffolding
  tokens, each with its defined self-test sequentially (25 checks total). The first
  Atlas run exposed lost `searchstatus` endpoint coverage after extracting historical
  material; its current probe-purpose entry was restored and gate/self-test passed.
  Final staged run: **25/25 passed**; `git diff --cached --check` passed.
- Runtime tests: N/A for this docs-only task. No claim that old tests validate the new
  grade/readiness/reveal design. No production probes or mutations performed.

Sweep verdict: **RECONCILED for the bounded design/source/documentation scope**. This is not
implementation or release approval. Engineering prerequisites remain in design §10.
