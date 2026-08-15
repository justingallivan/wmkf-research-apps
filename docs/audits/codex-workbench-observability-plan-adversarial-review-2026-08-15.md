# Codex Adversarial Review — Workbench Observability and Read-Coalescing Plan

**Date:** 2026-08-15  
**Reviewer:** Codex  
**Reviewed plan:** `docs/WORKBENCH_OBSERVABILITY_AND_READ_COALESCING_PLAN.md`  
**Reviewed baseline:** local `main` at `6066f578` (one committed housekeeping change ahead of `origin/main`)  
**Mode:** contract-reconcile Mode A, read-only source and durable-state review  
**Production probes:** none; the findings below do not depend on live Dataverse state  
**Verdict:** **NEEDS REWORK**

## Executive assessment

The observability-first direction remains sound, and a local superset-`$select`
merge remains a reasonable follow-up. The current plan is not implementation-ready,
however. Its Graph transport claim is false, its proposed correlation scope begins
too late to observe the authentication lookup it explicitly names, its Stage 2
query-count acceptance mixes incompatible row sets and routes, and its T2 repair is
already implemented and shipped. The final T1 status also contradicts the owner
decision recorded earlier in the same document.

These are plan defects, not implementation defects. No code was changed during this
review.

## Blocking findings

### P1-1 — The named Dynamics transport does not cover Graph/SharePoint

**Verdict:** `[REFUTED]`  
**Plan claim:** Stage 1 says wrapping `lib/services/dynamics/http.js:24` also covers
`graph-service.js` because all Graph calls route through the same helper
(`WORKBENCH_OBSERVABILITY_AND_READ_COALESCING_PLAN.md:64-72`).

**Evidence:**

- `[VERIFIED via lib/services/dynamics/http.js:24-50]` Dynamics exports its own
  `fetchWithTimeout`.
- `[VERIFIED via lib/services/graph-service.js:1154-1173]` Graph defines and uses a
  separate module-local `fetchWithTimeout`; it does not import the Dynamics helper.
- `[VERIFIED via lib/services/graph-service.js:101-135]` Graph token acquisition also
  uses the Graph-local helper.

**Reasoning:** Implementing only the plan's named Dynamics seam leaves every Graph
and SharePoint call uninstrumented while the stage claims both providers are covered.
The generic instruction to derive `entitySet` from a URL path segment is also not a
safe provider-neutral classifier: Azure login paths contain tenant identifiers, and
Graph/CDN paths may contain drive/item identifiers or encoded filenames.

**Required change:** Enumerate Dynamics, Graph, and `lib/dataverse/client.js` as
separate egress seams. Define a host-aware allowlisted classifier that emits a safe
schema such as `{dependency, resourceClass, operation}` and never emits raw URLs,
query strings, arbitrary path segments, tenant identifiers, filenames, or signed-CDN
material.

**Residual risk after change:** Presigned download hosts and unknown future Graph
route shapes must fail closed to a generic `resourceClass: "unknown"`, not fall back
to raw path logging.

### P1-2 — The proposed correlation scope cannot observe the auth-path call

**Verdict:** `[REFUTED]`  
**Plan claim:** The route shell mints a correlation id and `withDalContext` carries it
to the transport (`plan:75-77`), including the `lib/dataverse/client.js` app-access
hot path named at `plan:69-72`.

**Evidence:**

- `[VERIFIED via lib/dataverse/core/context.js:46-54]` `withDalContext` accepts only
  `(scopeLabel, fn)` and forwards directly to `bypassDynamicsRestrictions`.
- `[VERIFIED via lib/services/dynamics-context.js:48-57]` the current ALS store
  contains only `{restrictions, requestId}`; `requestId` is already the scope label.
- `[VERIFIED via pages/api/review-manager/reviewers.js:42-50]` and
  `[pages/api/reviewer-finder/my-candidates.js:46-57]` the routes call
  `requireAppAccess` before entering their route DAL scope.
- `[VERIFIED via lib/utils/auth.js:318-339]` an uncached app-access lookup runs inside
  its own `withDalContext('auth-app-access-lookup', ...)` before the route scope.
- `[VERIFIED via lib/dataverse/client.js:45-68,70-117]` token and Dataverse data calls
  are two different raw-fetch operations at this second egress.

**Reasoning:** A correlation id introduced only by the post-auth route DAL wrapper
cannot be present for the auth lookup that precedes it. Adding a distinct field to
the existing Dynamics ALS would also require edits to files that Stage 1's exact
file list omits and risks coupling observability lifetime to a DAL authorization
primitive.

**Required change:** Add an independent request-correlation ALS and establish it at
the first line of each target HTTP handler, outside and before authentication. Carry
at least `{correlationId, routeName}`. Transport emitters read that independent
context; nested DAL scopes must neither replace nor erase it. Enumerate every route
file or a reviewed common handler wrapper in the exact file list.

**Required tests:** two concurrent requests do not leak ids; a nested DAL scope
preserves the outer correlation; the uncached `requireAppAccess` Dataverse lookup
sees the same id as the post-auth service reads; calls outside an HTTP request have a
defined no-correlation behavior.

### P1-3 — Stage 2's fixed 6→3 acceptance target is not a valid census

**Verdict:** `[REFUTED]`

**Evidence:**

- `[VERIFIED via lib/services/review-manager/reviewers-service.js:224-228,498-555]`
  Reviewers has one mergeable pair over the same reviewer ids.
- `[VERIFIED via lib/services/reviewer-finder/my-candidates-service.js:163-180,
  381-430]` Candidates has one mergeable pair for active candidate ids.
- `[VERIFIED via lib/services/reviewer-finder/my-candidates-service.js:434-467]`
  Candidates invokes the same pair again for a distinct removed-candidate id set.
- `[VERIFIED via lib/services/workbench/decline-referrals-service.js:42-56,103-123]`
  decline referrals has one person read, not a sibling pair. There is nothing there
  to coalesce locally.
- `[VERIFIED via repository path]` the plan names nonexistent
  `lib/services/reviewer-finder/decline-referrals-service.js`; the actual service is
  under `lib/services/workbench/`.

**Reasoning:** The plan combines the three mergeable pairs from two services with the
single unmergeable read from a third route, then describes the result as six reads
spread `1/1/1` across three routes. Counts also scale with the existing 25-id chunks
and disappear when a row set is empty.

For `q(n) = ceil(n / 25)`, treating an empty set as zero, the actual contract is:

```text
before = 2q(reviewers) + 2q(active) + 2q(removed) + q(decline)
after  =  q(reviewers) +  q(active) +  q(removed) + q(decline)
```

When all four sets are nonempty and fit in one chunk, this is `7→4`, not `6→3`.

**Required change:** Scope Stage 2 to three sibling pairs across the two services;
explicitly mark decline referrals unchanged and fix its path. Make acceptance
formula-, chunk-, and fixture-aware. Preserve the existing different-id-set boundary
between active and removed candidates.

**Residual risk after change:** A response-equality assertion alone does not prove
the expected call reduction; adapter call-count tests must cover active-only,
removed-only, combined, empty, and more-than-25-id fixtures.

### P1-4 — T2 is already fixed and shipped

**Verdict:** `[STALE/CONFLICT]`

**Evidence:**

- `[VERIFIED via lib/services/reviewer-reminder-sweep.js:110-120,188-205]` both
  reminder queries already include `selectedAndNotRevokedFilter()`.
- `[VERIFIED via lib/dataverse/adapters/reviewer-suggestion.js:98-110]` the helper is
  the required null-safe selected/not-revoked predicate.
- `[VERIFIED via lib/services/reviewer-reminder-sweep.js:280-345]` marker and token
  are already written in one ETag-guarded `mintAndStore` operation.
- `[VERIFIED via tests/unit/reviewer-reminder-sweep.test.js:134-143,439-448]` both
  filters have regression coverage.
- `[VERIFIED via SESSION_PROMPT.md:37-43 and DEVELOPMENT_LOG.md:13-29]` Session 428
  records the fix as tested, merged, shipped, and production-live.

**Required change:** Remove Stage 4 from prospective work. Retain a short completed
history pointer if useful, but do not send an implementer back through the already
secured reminder flow.

## Additional issues

### P2-1 — The telemetry envelope and failure contract are incomplete

`{correlationId, entitySet, operation, ms}` cannot distinguish Dataverse, Azure AD,
Graph, or CDN calls, and it cannot separate success, non-2xx, timeout, abort, and
network failure. `lib/dataverse/client.js` token requests do not have a Dataverse
entity set. The test phrase "swallows on error" is ambiguous: only telemetry emission
failures may be swallowed; dependency failures must propagate unchanged.

**Required change:** Specify an event contract including version, correlation id,
route name, dependency, safe resource class, operation/HTTP method, duration,
outcome, and status class where available. Emit in `finally` or equivalent across
success, non-2xx, and thrown-error paths. Tests must assert the original `Response`
object and original thrown error identity/shape are preserved when telemetry works
and when telemetry itself fails.

### P2-2 — The sink and usage window are unresolved

The plan leaves "`api_usage_log`-style sink or structured console" as an implementer
choice. The existing `api_usage_log` is the LLM token/cost ledger
(`docs/atlas/postgres-infra-tables.md:147-153`), not a dependency-event table. A
durable sink would also contradict Stage 1's stop condition unless explicitly
re-scoped through migration and Atlas contracts.

**Required change:** Choose one sink in the plan. For structured platform logs,
define event name, log level, sampling, retention/query instructions, and how the
owner will obtain route-level counts and latency distributions. For a durable sink,
add the migration, retention, Atlas, privacy, and failure-isolation contracts instead
of calling it "style."

### P2-3 — The evidence gate cannot currently falsify Stage 2

"One real usage window" has no duration, minimum sample size, target environment,
baseline routes, percentile, or go/no-go threshold. A separate correlation id for
each of three HTTP requests also cannot directly prove one client tab action without
an action-level id; route-level measurements can still work, but the acceptance
language must say so.

**Required change:** Define a minimum route-level sample and comparison method, or
add a bounded action-correlation contract. State whether Stage 2 proceeds because
duplicate work is source-certain regardless of latency, or state the measured
threshold that must be met. Do not claim "measurement-gated" while providing no
decision rule.

### P2-4 — The final T1 verdict contradicts the owner decision

The T1 section says the issue is accepted by design and closed
(`plan:147-156`), while the final paragraph says "T1 stays owner-blocked"
(`plan:187-195`). `SESSION_PROMPT.md:29-35,99-104` independently records the
2026-08-15 owner decision not to reopen T1 without a new decision.

**Required change:** Remove the owner-blocked statement and restate T1 as closed,
accepted by design, and not part of the implementation stages.

## Prior Opus findings re-evaluated

| Prior finding | Current verdict | Evidence and residual risk |
|---|---|---|
| P1-1 request-cache mechanism | **PARTIAL** | The local sibling merge is correct, but the revised denominator and third-route distribution are not. |
| P1-2 transport seam | **REFUTED** | The Dynamics seam is correct for Dynamics; the assertion that it also covers Graph is false. |
| P1-3 `withDalContext` scope | **CONFIRMED, unresolved** | The plan removed the cache but still incorrectly says `withDalContext` carries a new request correlation field. |
| P1-4 T2 live exposure | **CONFIRMED historically; now stale** | The exposure was real, but the repair has since shipped. |
| P2-5 T2 predicate details | **CONFIRMED and implemented** | Current source contains the exact null-safe predicate and atomic ETag write. |
| P2-6 decline-referrals omission | **REFUTED remedy** | It was added under the wrong path and has no sibling read to merge. |
| P2-7 measurement scope | **PARTIAL, unresolved** | The claim was narrowed to external dependencies, but the named implementation still omits Graph. |
| P3-8 T1 placeholder | **CONFIRMED resolved** | The owner decided; the final paragraph is the remaining stale contradiction. |
| P3-9 rollback flag | **CONFIRMED resolved** | Stage 2 now correctly names plain revert. |

## Recommendation evidence

| Recommendation | Evidence verdict | Basis |
|---|---|---|
| Observability before a broader Workbench Data Plane | **SUPPORTED** | Current shared Workbench dependency transports have no request-correlated timing stream; broad invalidation changes carry known correctness risk. |
| Instrument `lib/services/dynamics/http.js` | **SUPPORTED for Dynamics only** | It is the shared Dynamics transport, including Dynamics token cache misses. |
| Instrument `lib/dataverse/client.js` | **SUPPORTED** | It is a second runtime egress used by app-access; correlation must begin before auth. |
| Instrument Graph through the Dynamics helper | **REFUTED** | Graph has its own transport helper. |
| Merge sibling person reads locally | **SUPPORTED for three pairs across two services** | Same entity, same id filter, disjoint selects; no cache or DAL change required. |
| Expect `6→3` across three routes | **REFUTED** | Decline has one unchanged read; Candidates has two distinct sibling pairs; counts are chunk/data dependent. |
| Defer the full Data Plane | **SUPPORTED as a risk-minimizing inference** | Its return is unmeasured and its invalidation semantics could reopen prior correctness bugs. |
| Implement T2 as future Stage 4 | **REFUTED** | Current source, tests, handoff, and milestone log show it shipped in Session 428. |

## Narrow durable-state sweep

**Sweep mode:** Mode B — disputed implementation-readiness/current-state claims  
**Domain:** the Workbench observability/read-coalescing plan and its current handoff  
**Authoritative evidence:** current transport/context/route/service/reminder source,
current reminder tests, the 2026-08-15 owner-decision handoff, and the milestone log  
**Claims:** 5 → VERIFIED 5 / PARTIAL 0 / PLANNED 0 / ASSUMED 0 /
STALE-CONFLICT 0 / UNKNOWN 0  
**Durable surfaces searched:** `docs/**`, `.claude-memory/**`,
`docs/agent-wiki/**`, `SESSION_PROMPT.md`, `CLAUDE.md`, and `AGENTS.md`  
**Restatement files classified:** 8 → AGREE 1 / STALE 2 / HISTORICAL 5 /
UNRELATED 0

- **STALE:** `docs/WORKBENCH_OBSERVABILITY_AND_READ_COALESCING_PLAN.md` — current
  draft containing the false Graph seam, invalid correlation trace/count target,
  prospective T2 stage, and T1 contradiction.
- **STALE:** `SESSION_PROMPT.md` — current handoff still calls Stage 1 fully specified
  and repeats the fixed six-query denominator; its T1 and shipped-T2 statements agree
  with current truth.
- **AGREE:** `DEVELOPMENT_LOG.md` — correctly records T2 as shipped and the broader
  Data Plane as deferred pending observability.
- **HISTORICAL:** the dated Fable performance evidence, Opus review, Opus
  disposition, Fable final handoff, and current-state-evidence audit remain explicit
  point-in-time records. They may preserve what was believed on 2026-08-14 and must
  not be silently rewritten as current guidance.
- No matching current restatements were found in `.claude-memory/**`, the agent wiki,
  `CLAUDE.md`, or `AGENTS.md`.

**Semantic omissions found:** no provider-specific endpoint classifier; no
pre-auth correlation owner; no sink/query contract; no measurement decision rule;
no chunk-aware Stage 2 count contract.  
**Disconfirming checks:** direct inspection found a Graph-local transport helper;
direct route traces place `requireAppAccess` before route DAL scopes; the decline
service contains only one person read; reminder source/tests contain the proposed T2
repair.  
**Remaining live STALE:** 2 files, intentionally assigned to Claude for revision.  
**Verdict:** **CLAIM NOT RECONCILED** — this artifact establishes and preserves the
review evidence; the current plan and handoff still require the named structural
repairs.

## Required revision checklist

1. Replace the false shared-Graph seam with an explicit egress inventory.
2. Define an independent request-correlation scope established before auth and list
   every route/wrapper it changes.
3. Define the versioned, redacted event schema, exact failure-preservation behavior,
   and provider-specific endpoint classifier.
4. Choose the sink and make its retention/query/sampling contract executable.
5. Replace fixed Stage 2 counts with the chunk-aware formula and correct service
   scope; mark decline referrals unchanged.
6. Define a measurable Stage 2 go/no-go rule or state that the source-certain read
   reduction proceeds independently of latency magnitude.
7. Move T2 to completed history and reconcile the final T1 verdict.
8. Update `last_verified`, the plan's contract-reconcile verdict, and any live
   handoff restatements that call the current plan fully specified or ready.

## Final verdict

**NEEDS REWORK.** Do not authorize implementation from the current document. After
the eight named revisions, repeat contract-reconcile Mode A against the plan, the
three transport seams, the target route shells, both read-coalescing services, and
the current durable handoff.
