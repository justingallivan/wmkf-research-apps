# Autonomous memory and documentation cleanup — 2026-10-22

**Bounded follow-up implementation and evidence review; unreleased local branch.** The owner authorized the remaining four areas together:
documentation verification, compression, runtime follow-ups and read-only live
evidence. Sol investigates, Luna implements, and the parent reviews and runs
checks. Work is isolated on `codex/memory-audit-followups`; no push, deployment,
live record mutation, environment change or worktree operation is authorized by
this report. The unrelated critique/output files and owner-review-burden memory
remain untouched.

## Work ledger

| Area | Original finding / evidence | Current disposition |
|---|---|---|
| Enforcement coverage | Sol traced selected gates, CI and configured Claude hooks. Luna repaired CI inventory, Stop-mode distinctions, startup law-mode/ledger guidance and two gate memories. | Reviewed and committed in `31f5e26b0`; scoped documentation checks passed. Configured Claude hooks do not establish Codex invocation. |
| Prompt/output contracts | Sole-current lookup is name + iscurrent, not a prompt-status predicate. Shared create-only seeds and legacy reviewer in-place seeds are separate contracts. Executor rejects incomplete output before business persistence. | Luna clarified Executor wording; preserve existing governance policy. |
| Tool/local guidance and exports | Tools now live in extracted modules; DVX uploads before token mint, so a late failure can leave an object without a usable download. Token TTL does not establish Blob cleanup. | Current prose repaired; DVX route/client now report no usable download while admitting possible retained object. Local-machine historical limits remain explicit. |
| Compression | Large reviewer lifecycle hub needs capability routing with preserved anchors/history. Grantee note mixes current copy decisions with dated observations; Site Visit history already split. | Nine capability extracts and compact hub committed; exact snapshot plus 23 segment hashes retained. Wiki routing and J27 locator checks passed. Small handoff notes retain their useful owner decisions without forced extraction. |
| PI role source | Luna removed Research Leader fallback; only Project Leader can seed PI identity. Missing Project Leader returns inert before contact/provider reads. | Parent and Sol reviewed; resolver/projection tests passed and active PI guidance follows branch source. Local branch only; affected population unknown. |
| Shared-person binding/write ordering | Sol confirmed three automated siblings can overlay global fields before decision checks; Workbench can back-propagate incoming ORCID after conflict. A simple reorder does not close ETag retry races. | Implemented and independently challenged: strict person-specific anchors, bound decision authority, initial stored-email pin, concrete ETag, one fresh retry and no early existing-person fills. Tests cover protected no-write and compatible/manual positives. Owner decision retained; no population remediation. |
| Authorization continuity | Due-date route discards authorized request identity before service re-read. | Implemented server-derived expected request pin for save/retry; focused route/service tests passed, including no-write/no-notify parent drift. Concurrent PD reassignment remains a separate atomicity limit. |
| First-access timestamp | Snapshot-presence gate followed by unconditional timestamp PATCH permits competing first loads. | Implemented fresh read + conditional write + bounded conflict reread preserving winner; trigger remains portal context load. Parent also refreshes the response ETag after failed attempts because a concurrent writer may have won. |
| Awardee/output/preflight | Late async browser effects, omitted cycle rows and unavailable-versus-empty listing are source-confirmed boundaries. | Luna implemented action generation guards, explicit bounded omission warnings and separate preflight availability; five focused suites passed 174 tests, with source review preserving send-with-confirmation policy. |
| Roster concurrency / export lifecycle | Finalizer guards status, not timestamp, and may recreate missing rows; no universal warm snapshot contract. | Source-characterized status-qualified merge and missing-row recreation; no blanket CAS policy introduced. Existing projection tests passed; real database concurrency remains unproven. DVX failure wording repaired without adding cleanup policy. |
| Live evidence | Read-only SQL and Dataverse GET probes completed; metadata-only Vercel variable listing completed. | Scoped observations reconciled into IRS/prompt/role notes; retained artifact records schema naming correction and metadata-presence limits. |

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

Documentation/evidence is recorded in local commit `31f5e26b0`; runtime repairs and focused validation are recorded in `e86e5f80d` and below.
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
| Incomplete output is visible | Cycle assembly / materials listing → HTML or preflight response → staff | Count plus first 20 affected request numbers and overflow count; unavailable metadata is distinct from empty. Send-with-confirmation policy unchanged. |
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
| P2 live evidence | Establish current model/output configuration only when needed | Origination code claims received a fresh source trace; August model/admin observations remain historical. Current override and prompt contents/schema need bounded evidence before a live-behavior claim | No paid generation, reseeding or publication as a probe. |
| P3 structure | Optional small handoff extraction and remaining non-active inventory | Grantee email and Site Visit notes retain useful owner decisions; 32 non-active leaves remain outside active census | Advisory size/weak-basis flags are not defects and are not suppressed. |

All-claim and whole-live-state verification remains **AUDIT INCOMPLETE**. The
bounded repair/evidence program can close its named findings without claiming
that every repository sentence or deployed behavior has been recertified.

## Parent validation and completion boundary

[VERIFIED via local focused Jest runs] **19 distinct suites / 634 tests passed**:
resolver and roster projection; due-date route/service/editor; first-access adapter
and external-review integration; Awardee browser behavior; materials listing and
preflight; cycle-export service/HTML; shared-person adapter and sticky-confirmed
contracts; early reuse isolation; contact persistence, candidate save, Workbench
enrichment; and DVX export route. Tests use mocks and controlled fixtures, not live
writes. Initial failed runs exposed test-seam/fixture issues; they were corrected
and affected suites rerun. One broad invocation named a nonexistent sticky suite;
the actual `researcher-identity-confirmed-sticky` suite was run separately (32 tests).
The 634 total counts each passing suite once.

[VERIFIED via local checks] Type checking passed. Scoped lint had zero errors;
existing React effect warnings remain in the large panel/Awardee components.
The new due-date render-time ref writes were moved into commit-time layout effects;
the editor now lints clean and its 23 tests passed after that change.
Documentation checks passed for memory routing, fact consistency, canonical
pointers, symbol references, build-claim freshness, currency, wiki routing,
harness framing, Atlas, API matrix, J27 register and catalog. Relevant safety
gates and their self-tests ran sequentially; no checker was weakened. The final safety recheck passed agent invariants, GUID trust boundary, Dataverse
access layer, Dynamics context boundary, route lifecycle/auth, route/service
boundary, reviewer engagement boundary, suggestion-writer and secret-scan
gates with every available self-test run after its gate. Scoped lint completed
with zero errors and nine React effect warnings in pre-existing large component
effect regions. No full-build or hosted verification is inferred.

[VERIFIED via extraction hash comparison] The snapshot SHA and all 23 segment
body hashes match the manifest. Boundary newlines are distinct from source body
bytes. Two documented source corrections are explicit; later due-date branch
notes sit outside the preserved extraction blocks. The topic expiry discovered
for origination was first marked stale, then independently checked against current
source. Sol confirmed disabled Track B, removed query generation, default count
15, route orchestration and recency ranking. Luna corrected fixed-versus-requested
count and the historical next-cycle expectation; scoped verification does not
refresh the August model/admin observation into today's deployed state.

Memory health remains advisory: **16 flags / 304 leaves**, comprising eight
shadow-Atlas, six weak-basis and two oversize-routed flags. The exact weak-basis
membership changed (prompt governance gained scoped evidence; org-open access
still retains dated evidence). No flags/checker were suppressed. Existing owner
holds, unrelated critique/output and the owner-review-burden memory are unchanged.

No full production build, signed-in browser smoke, live mutation, external
provider execution, deployment, push or release is claimed. The named local
repairs and evidence are reviewable; residual policy, concurrency, population and
release work is ordered above. This closes the four-area continuation's local
repair pass, not the whole-repository all-claim audit.
