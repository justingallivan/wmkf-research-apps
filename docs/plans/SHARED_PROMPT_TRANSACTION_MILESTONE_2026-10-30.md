---
title: Shared Prompt Transaction Core and Pre-Site Transition
domain: ai-platform
kind: implementation-record
status: active
summary: Local transaction reference core and offline Pre-Site transition preparation; no live writer cutover or tenant proof.
canonical: false
cataloged: 2026-10-30
owner: product-engineering
related:
  - docs/plans/SHARED_PROMPT_LIBRARY_PLAN_2026-10-29.md
  - docs/plans/SHARED_PROMPT_CONSUMER_COMPATIBILITY_2026-10-30.md
---

# Transaction core and Pre-Site transition milestone

Historical checkpoint at commit `1c3848c8a`, before the local SDK toolchain and
compiled transport existed. See [SDK milestone](SHARED_PROMPT_SDK_MILESTONE_2026-10-30.md)
for current compilation/primitive-parity evidence; the complete SDK port and
tenant proof remain pending.

[PARTIAL / local implementation] Implemented a server-only JavaScript transaction
reference core against an explicit trusted server port. This is not a Dataverse
transaction implementation or a substitute for Connor's .NET plug-in. No route
or existing publisher is switched. Entry points are local tests and offline
transition preparation. Persistence operations are modeled against an atomic
in-memory test port only; no database/schema changes are authorized here.

| Invariant | Files | Verification |
|---|---|---|
| Authorization and durable replay precede fresh policy/state checks | transaction core | Old receipt replays after policy/head advances; wrong actor/reused UUID rejects |
| Budget coordination precedes the per-name head and retains original ETag | transaction core | Call order and both CAS conflict/rollback cases |
| Complete inventory and immutable snapshot govern allocation | transaction core | Incomplete reads, case aliases, duplicate versions/current, reserved high-water gaps and stale draft/catalog reject |
| All lifecycle/head/receipt writes commit together or remain unknown | transaction core + atomic fake port | Fault injection after each mutation, duplicate request race, unknown committed/uncommitted outcomes |
| Transition changes only the exact reviewed old schema | offline Pre-Site planner | Known legacy length-only delta accepted; arbitrary schema/content drift rejected |
| Live cutover requires a drained reviewed operation | transition runbook | Explicit pause/drain, snapshot/rehearsal, same-UUID publish/readback and forward-recovery sequence; no execution switch |

The local core is `lib/prompt-publication/transaction-core.js`. It authorizes via
server context, returns authorized durable replay before fresh checks, takes
budget then head CAS with verified returned revisions/ETags, checks complete history/draft/current/catalog and the persisted draft baseline, allocates
above head high-water (including reserved gaps), and conditionally promotes,
clears, finishes head and creates immutable receipt inside one port transaction.
Promotion clears the stored draft baseline in the same transaction. A missing
or changed stored baseline requires explicit reconciliation; callers cannot
refresh just the wire baseline to overwrite newer catalog values.
An outer post-fault receipt lookup handles racing winners and unknown outcomes
without retrying writes or generating another UUID. Unknown receipt reads never
become absence. No SDK adapter implements this port yet.

The port must provide server authorization/actor/target enforcement, strict
paged reads, real IsInTransaction, Active unique keys, conditional SDK operations,
strict actor attribution, live group/section assignment validation coordinated
with catalog removals, and transaction-wide rollback on any fault. Returning
from withTransaction must mean COMMITTED; callback return is provisional.
The tested fake port proves core sequencing/rollback expectations, not Dataverse
isolation, raw-write guard behavior or a stored cross-writer guarantee.

Policy revision 5 pins the core and transition-preparation sources. The offline
CLI writes a private create-only proposed snapshot artifact and rejects every
unrecognized schema delta. It cannot bind/authorize live row identities.
The [Pre-Site transition runbook](PRE_SITE_PROMPT_READER_TRANSITION_2026-10-30.md)
provides the staged old-reader safety pause, drain, reviewed new-reader/prompt
publication, same-UUID recovery, readback and approved resumption sequence.
The server-only pause guard covers artifact and Executor entry points, ASCII
case/whitespace aliases and the resolved-row identity before model resolution.
It has no request bypass; it does not cancel in-flight work or pause older code.
Scheduled queue claims/status reads can precede the artifact guard and persist
pause-coded blocked receipts; the runbook disables automation first and requires
explicit eligible retries before cron resumes. Same-UUID recovery retains the
original organization/initiating/effective actor tuple.
It is prepared as a separate backportable commit, not deployed here.

Whole-flow audits: local caller → bounded frozen request → server authorization
→ durable replay → explicit transaction → original budget/head fences → full
inventory and draft → complete fresh validation → conditional lifecycle/head/
receipt → committed return. Partial-success faults abort the entire port
transaction; ambiguous outcomes resolve outside it. Async inputs/read results
are copied/frozen across awaits; original ETags are retained. Helper semantics
preserve raw snapshots and source-specific Pre-Site bounds. No new durable
schema, route, persisted status or migration exists. Existing app/budget writers
remain live and unchanged; only the operational pause checks are added to runtime.
New receipt/core errors are local port/test results, not new API response enums.
Current plan/wire/README are reconciled using bounded Sweep Mode A; the previous
consumer compatibility checkpoint remains explicitly historical.

Main remains merge-blocked pending the coordinated transition, SDK solution and
roles/guards, same-target budget/replay integration, .NET parity and tenant proof.
## Independent review and verification

[VERIFIED via host Claude CLI OAuth] Claude Fable (`claude-fable-5-1` only),
session `f82cc5be-c9bd-4567-a531-d88c1bc65e53`, reviewed and rechecked through
WMKF Team subscription OAuth. No API-key agent authentication, metered review
product, live tenant/provider request or deployment was used. Neither review
edited files or reported permission denials.

Concrete findings addressed: automation/cron is disabled before the safety
pause; the runbook distinguishes early worker queue effects and requires
eligible blocked-receipt retries before cron resumes. Same-UUID recovery is
explicitly bound to the original organization, initiating and effective actor.
The budget fence return is now validated for advanced revision, new ETag and
current artifact; budget-CAS/create-head/first-head-CAS fault cases prove modeled
rollback. No worker classifier or Factory mapping change widens the backport.

The claimed verify-only ordering escape was REFUTED by a reproduced regression:
canonical equality identifies a candidate but the final named exact-definition
validator rejects reordered memos before returning. The test also calls the
actual reader and proves the same row is rejected there. Fable independently
reproduced root/nested key reordering negatives and whitespace-only success,
withdrew the finding and accepted the corrected local milestone. Its recheck
ran six scoped suites / 304 tests and the policy drift check; no new concrete
defect remained. No merge or tenant-readiness recommendation was inferred.

[VERIFIED via local commands] Final checks: 30 suites / 1,211 tests passed, types
and lint passed, policy and golden drift checks passed, independent Python
fingerprints passed and whitespace checks passed. Fifteen relevant gates plus
fourteen paired self-tests passed sequentially (29 commands). Policy revision 5
hash: `50bcb07a28fd786b1000e6527bd1b06c34170e0088ede2bc35228ebba1f76c5b`.
New env semantics are recorded in the canonical Credentials Runbook, with no
claim of live configuration. Current plan/wire/README and the historical
consumer checkpoint were reconciled. There are no instruction/skill/database-schema/
route changes; the new operational guard is runtime code and needs deliberate
release. The .NET SDK is unavailable on PATH and common Mac SDK locations;
no .NET build/parity, role, Active-index or tenant transaction proof exists.

The pause-only commit `4fcc0ad86` contains just its module, the artifact/Executor checks
and focused test; it can be reviewed/backported without this branch's new
schema reader. Applicability against current main was source-checked by Fable;
applicability against the actual deployed baseline remains UNVERIFIED. Do not
promote the whole branch merely to obtain that guard. No live state was mutated,
no environment changed, no merge or production deployment performed.
