# Autonomous memory and documentation cleanup — 2026-10-22

**IN PROGRESS.** The owner authorized the remaining four areas together:
documentation verification, compression, runtime follow-ups and read-only live
evidence. Sol investigates, Luna implements, and the parent reviews and runs
checks. Work is isolated on `codex/memory-audit-followups`; no push, deployment,
live record mutation, environment change or worktree operation is authorized by
this report. The unrelated critique/output files and owner-review-burden memory
remain untouched.

## Work ledger

| Area | Evidence / disposition | Remaining execution |
|---|---|---|
| Enforcement coverage | Sol traced selected gates, CI and configured Claude hooks. Luna repaired CI inventory, Stop-mode distinctions, startup law-mode/ledger guidance and two gate memories. | Parent review, scoped gates and commit. Configured Claude hooks do not establish Codex invocation. |
| Prompt/output contracts | Sole-current lookup is name + iscurrent, not a prompt-status predicate. Shared create-only seeds and legacy reviewer in-place seeds are separate contracts. Executor rejects incomplete output before business persistence. | Luna clarified Executor wording; preserve existing governance policy. |
| Tool/local guidance and exports | Tools now live in extracted modules; DVX uploads before token mint, so a late failure can leave an object without a usable download. Token TTL does not establish Blob cleanup. | Repair current prose and preserve local-machine historical limits. |
| Compression | Large reviewer lifecycle hub needs capability routing with preserved anchors/history. Grantee note mixes current copy decisions with dated observations; Site Visit history already split. | Whole-read, mechanically extract with byte/hash proof, keep owner decisions active, run wiki/memory gates. |
| PI role source | Luna removed Research Leader fallback; only Project Leader can seed PI identity. Missing Project Leader returns inert before contact/provider reads. | Parent and Sol review; 34 mocked tests across resolver/projection suites passed. Reconcile durable current claims; local branch only. |
| Shared-person binding/write ordering | Sol confirmed three automated siblings can overlay global fields before decision checks; Workbench can back-propagate incoming ORCID after conflict. A simple reorder does not close ETag retry races. | Owner decided to withhold automated global person updates until continuity is established, preserving manual Add/Refer. Luna is implementing a binding-aware mutation boundary across the three automated siblings; meaningful stateful conflict/race tests are required. |
| Authorization continuity | Due-date route discards authorized request identity before service re-read. | Implemented server-derived expected request pin for save/retry; focused route/service tests passed, including no-write/no-notify parent drift. Concurrent PD reassignment remains a separate atomicity limit. |
| First-access timestamp | Snapshot-presence gate followed by unconditional timestamp PATCH permits competing first loads. | Implemented fresh read + conditional write + bounded conflict reread preserving winner; trigger remains portal context load. Parent also refreshes the response ETag after failed attempts because a concurrent writer may have won. |
| Awardee/output/preflight | Late async browser effects, omitted cycle rows and unavailable-versus-empty listing are source-confirmed boundaries. | Luna implemented action generation guards, explicit bounded omission warnings and separate preflight availability; five focused suites passed 174 tests, with source review preserving send-with-confirmation policy. |
| Roster concurrency / export lifecycle | Finalizer guards status, not timestamp, and may recreate missing rows; no universal warm snapshot contract. | Characterize boundaries before proposing policy changes; do not recreate reverted warm architecture. |
| Live evidence | Read-only SQL and Dataverse GET probes completed; metadata-only Vercel variable listing completed. | Reconcile scoped dated observations into active notes; remaining limits below stay explicit. |

## Live evidence and limits

The retained redacted artifact is
`docs/audits/memory-live-state-evidence-2026-10-22.json`.

- App database selected by local configuration: **1,975,975 IRS rows**, all with
  refresh date **2026-10-15**; one recorded completed refresh ran 06:00:07–06:02:39
  UTC that day. SQL used a read-only transaction, bounded queries and rollback.
  This does not prove the deployed app uses that connection or independently
  verify the source CSVs.
- Registered production Dataverse hostname: **39 current prompt rows / 39
  distinct names**, all observed status `682090001`; complete bounded paging.
  Only metadata was retained, with no prompt bodies or execution.
- **123 visible cloud-flow definitions**, no literal IRS endpoint/BMF match in
  the inspected definitions. This does not establish absence of external callers,
  hidden flows or indirect integration.
- **Eight direct app-user role assignments** were returned. They include the
  previously retained elevations; role names do not establish effective/team
  privileges or organizational authorization. No role changed.
- Vercel Production metadata lists presence for the allowlisted flag names.
  No values were exported; presence is not effective deployed configuration.
- The only POST was application OAuth token issuance. Dataverse requests were
  GETs; no provider processing, refresh/import, export or application mutation
  was used as a probe. Service access/audit logs can still occur. Requested
  Dataverse URLs and next links were origin-bound; default redirect following
  remains a limitation of this temporary probe.

## Verification and decision boundaries

Each completed repair will record its focused checks and local commit here.
Documentation gates are not proof of live behavior. Runtime repairs remain
unreleased until the repository's Tier 2 promotion requirements and explicit
owner release decision are satisfied. Changes requiring new product policy
remain reviewable proposals rather than silently adopted behavior.

Owner decision recorded in this chat: confirmed reviewer records with missing/malformed anchors must withhold automated global ORCID, Scholar, affiliation and metric updates until continuity is established. Staff edits and manual Add/Refer remain available. Compatible confirmed enrichment may retain the existing metric/fill behavior while keeping confirmed decision metadata. No live mutation is authorized.

## Implementation invariants and independent challenge

| Invariant | Entry → durable boundary → consumer | Verification / limit |
|---|---|---|
| Only Project Leader establishes structured PI role | Resolver → request/contact reads → screening/name consumers | Valid-officer fixture must cause no contact/provider calls when Project Leader is absent. |
| Automated person writes require person continuity | Three enrichment/save siblings → researcher conditional PATCH → global person/Contact consumers | No early reuse fills; typed person-specific anchors, decision-bound authority, original owner-email pin, concrete ETag and fresh conflict recomputation. Staff/manual paths retain separate authority. |
| Request identity survives authorization | Due-date route → save/retry loadContext → date/notification | Server-derived request pin; parent drift returns before write/send. Cross-row PD reassignment atomicity remains unknown. |
| First access preserves a competing winner | Context GET → fresh suggestion CAS → portal response ETag | Bounded 412 reread, no unconditional retry; stamp remains best-effort. |
| Stale browser actions cannot own current UI | Awardee and due-date actions → response → browser/callback | Deferred-response fixtures; an already-started OS clipboard or server write cannot be undone by UI cancellation. |
| Incomplete output is visible | Cycle assembly / materials listing → HTML or preflight response → staff | Count plus bounded omitted IDs; unavailable metadata is distinct from empty. Send-with-confirmation policy unchanged. |
| Export failures describe available output honestly | DVX upload → token mint → SSE/client | Token failure can leave a private object; no deletion/retention policy introduced. |

Fresh Sol review found and required repairs for malformed matching anchors,
unbound legacy/seed decision trust, and email-owner drift between lookup and
conditional write. Institution overlap alone is not person identity proof. These
are pre-commit review findings, not evidence of affected live records. A full
stateful service harness across all three automated callers is not claimed;
adapter state/race tests and separate caller-threading tests have distinct scope.

## Prioritized residual backlog

| Priority | Action | Evidence needed / proposed fix | Boundary |
|---|---|---|---|
| P1 release | Review and deliberately promote local runtime repairs | Tier 2 release checks and signed-in scoped smoke on an authorized target; retain exact release receipt | No push, merge to main, deployment or live test is performed here. |
| P1 evidence | Assess possible historical PI/person effects | Authorized read-only population plan: absent-Project-Leader cases, protected person anchors and cross-request use; review exact records before any correction | No automated relabel, deletion or historical COI rewrite. |
| P2 concurrency | Characterize cross-row PD reassignment and roster finalization | Real reachable writer proof, stateful fixtures and a disposable DB concurrency test if warranted; current roster finalizer preserves newer evidence/status-qualified merge and may recreate missing rows | Do not restore reverted warm snapshot architecture or invent blanket CAS. |
| P2 policy | Preserve known unresolved manual/COI/exclusion questions | Broad/HHMI UI/server selectability, sparse manual screening, foundation exclusion breadth and excluded-producer coverage require focused evidence/design | Existing owner decisions are not changed. |
| P2 output lifecycle | Decide proposal public-cache and DVX retention | Inventory authorized store metadata/access/retention; propose exact scope before lifecycle changes | Token expiry is not Blob deletion. No live objects touched. |
| P2 evidence | Verify deployed flags, external callers and effective privileges when needed | Values/effective behavior require a separate authorized evidence plan; metadata presence, direct roles and visible-flow searches are insufficient | IRS local DB counts and current prompt metadata are dated scoped observations. |
| P2 documentation | Refresh stale origination topic and remaining model/output claims | Source/metadata trace per claim, including current model override and prompt contents/schema; topic is explicitly stale, not silently redated | No paid generation, reseeding or publication as a probe. |
| P3 structure | Optional small handoff extraction and remaining non-active inventory | Grantee email and Site Visit notes retain useful owner decisions; 32 non-active leaves remain outside active census | Advisory size/weak-basis flags are not defects and are not suppressed. |

All-claim and whole-live-state verification remains **AUDIT INCOMPLETE**. The
bounded repair/evidence program can close its named findings without claiming
that every repository sentence or deployed behavior has been recertified.
