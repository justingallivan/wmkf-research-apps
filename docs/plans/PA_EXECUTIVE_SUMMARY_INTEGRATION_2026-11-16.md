---
title: Bounded Executive Summary integration
status: sandbox-live-tested
last_verified: 2026-11-16
---

# Executive Summary integration — bounded test Requests

Owner: Codex. Branch: `codex/executive-summary-generation-2026-11-16`.
Worktree: `/private/tmp/wmkf-summary-generation-20261116`.
[OWNER DECISION 2026-11-16] Build on a branch; explicitly enrolled test Requests first.
[VERIFIED via hosted HTTP, ledger and Dataverse readback] The approved bounded
Sandbox trial passed on Request 1000389, including one real model call, audit,
publication, replay and restoration. No Production deployment or cloud migration.
See [live trial receipt](PA_EXECUTIVE_SUMMARY_LIVE_TRIAL_2026-11-16.md). The separately deployed staff editor is documented in
[the narrative handoff](REQUEST_NARRATIVES_HANDOFF_2026-11-09.md).

## Contract and implementation

Connor's accepted intake ordering is: finalize the narrative → run required AI
processing → set `wmkf_readyforreview` last. Any failed processing halts intake and
notifies check-in staff. Power Automate owns that ordering, readiness write and
notification. These routes do not write readiness or send notifications. The
combined Narrative–Bibliography PDF remains reviewer-matching input. Justin accepts
an exceptional broken-intake rerun overwriting later staff edits/clears; a persistent
staff-edited marker is not a prerequisite. Existing ledger duplicate/uncertainty
fences remain; this slice does not add a way to bypass or reset them.

[VERIFIED via branch source and isolated PostgreSQL tests]

| Hop / invariant | Implementation / verification |
| --- | --- |
| Application identity before DAL | Summary routes use the existing Entra application verifier through `requireSummaryPromptAccess`; route tests verify pre-auth has no DAL context |
| One enrolled Sandbox Request/event/task | Separate `PROMPT_JOB_SUMMARY_PILOT`; only `proposal.executive-summary` + `initialize`; no Production scope, bulk intake, caller-selected source/field or Methodology |
| Immutable task inputs | Source adapter pins `Submission-Documents/Project-Narrative_{Request#}.pdf`, SharePoint identity/revision and stored Project Leader name; sealed snapshot and configuration retained in migration 097 ledger |
| No alternate document | Missing/ambiguous/changed/invalid narrative fails; combined PDF and applicant abstract are not fallbacks. PDF ≤20 MiB; existing profile text limits apply |
| Pinned destination-free prompt | Existing v1 Executor declaration, raw `summary` output ≤200 words, prepared `proposal_context` + required frozen `pi_name`; exact prompt/version/hash/profile pins |
| No direct provider path | Shared `executePrompt` performs dispatch, response checkpoint and validation; one deferred audit precedes publication |
| Conditional initialization | Blank field at capture, original concrete Request ETag, uncached Lay Abstract metadata checks, source freshness before dispatch/publication; only `wmkf_layabstract` may be patched |
| Preserve observed staff/source changes | Original-ETag 412 or changed narrative terminates publication as conflict; no ETag refresh or silent fallback |
| No blind regeneration / duplicate write | Same-key replay returns the receipt; second key/cohort cannot evade retained physical-field reservation. Uncertain provider/audit/PATCH outcome requires attention |
| Private status | Polling returns states and safe codes, no narrative, raw response or Summary text; authenticated scope and exact Request checked |
| Bounded worker | POST-only server-selected drain, strict cron secret even in development, one stage per invocation; no detached promise or cron schedule |
| Existing callers | Short Title policy/endpoints and staff destination-free drafts remain separate; real PostgreSQL regressions cover shared store/Executor changes |

The existing store method names `admitMachineTitle` and `verifyMachineTitleDatabase`
are retained for compatibility. Their policy-injected implementation explicitly
recognizes Title versus Summary and rejects any other machine task/scope. Summary
admission uses its own service, policy and runtime pool binding.

No new tables, columns, migration or persisted status values are introduced.
Migration 097's six tables store the job, immutable inputs, attempts, initialization
reservation and audit/publication receipts. Source/response content expires after
24 hours; other job content after seven days. Scoped drain cleanup deletes expired
content, never the receipts. Disabled/expired valid policy permits scoped cleanup;
absent or malformed configuration cannot authorize cleanup. The existing staff
editor reads the same Dataverse field after machine publication.

## API for the bounded flow

`POST /api/automation/summary-jobs`, application Bearer authorization and a UUID
`Idempotency-Key`. The caller must reuse that key and source event for transport
retries. Body has exactly these four keys (UUID values supplied by enrollment):

```json
{
  "requestId": "11111111-1111-4111-8111-111111111111",
  "sourceEventId": "22222222-2222-4222-8222-222222222222",
  "taskKeys": ["proposal.executive-summary"],
  "operation": "initialize"
}
```

The example IDs are synthetic, not an enrolled Request. Response is `{job: ...}`,
202 for polling or 200 for terminal replay, with relative `Location` and
`Retry-After` when pending. GET that Location with the same app authorization.
Only terminal `succeeded` means validated output, confirmed audit and applied
publication. `failed`, `needs_attention` or any unexpected response must halt intake
and notify check-in staff; a successful HTTP status alone is not business success.
Do not replace the key or event to work around failure. Read status after ambiguous
submission; do not issue another model call directly.

The operator advances `POST /api/cron/drain-summary-prompt-jobs` with server cron
authorization. It accepts no job selector. Connor receives no cron secret.
The old Short Title driver is pinned to its old fixture and must not be reused as
though it selected Summary. For this bounded test, an operator may call Summary
ticks sequentially and inspect status between calls, stopping at terminal state,
transport ambiguity or the enrollment expiry. Never overlap ticks after a timeout;
inspect retained lease/dispatch receipts first. Unattended scheduling is deferred.

## Bounded acceptance completed; rollout remaining

The November 16 [live receipt](PA_EXECUTIVE_SUMMARY_LIVE_TRIAL_2026-11-16.md)
records exact enrollment, hosted budget, prompt/profile, database, fixture and
successful delivery/replay/restoration. The policy expires November 18 at 19:30 UTC.
No new execution is authorized by these completed trial pins.

Before promotion, review the full branch delta: PA base `db00e33ba` plus main
`57eb7c40f`, merged at `8e9a615bc`, includes inherited unpromoted Executor/Admin,
staff-draft and recommendation work. Connor's actual intake submit/poll actions,
upload-completion signal, final readiness/failure paths, and unattended worker
scheduling still need integration acceptance. Synthetic input proves mechanics,
not scientific quality on real applicant documents or staff browser readback of
this machine result. Current code refuses Production; broad activation requires
reviewed implementation, not a configuration flip. Production promotion is not
authorized.

Enrollment uses only `PROMPT_JOB_SUMMARY_PILOT`, with exact existing policy keys:
`enabled`, `pilotId`, `requestId`, `sourceEventId`, `tenantId`, `audience`, `clientId`,
`servicePrincipalId`, `role`, `promptId`, `promptVersion`, `promptHash`, `profileHash`,
`databaseIdentity`, `databaseEndpoint`, `expiresAt` (at most seven days).
`destinationGrant` is rejected. Preserve both Dataverse enforcement flags, Sandbox
origin and database pins. Credentials stay server-side. Never overwrite another
trial's policy. No schema apply is implied by these instructions.

The hosted drain budget is 240 seconds, lease 300 seconds and Executor deadline
210 seconds from tick entry. Metadata/extraction/final writes are not globally
abort-controlled. Forced platform timeout remains untested; uncertainty must
recover through the retained lease/dispatch fences, never blind retries.

## Verification and review evidence

Local integration uses actual migration 097 PostgreSQL transactions, Summary source
adapter and shared Executor, with fake PDF extraction, provider, Graph, audit and
Dataverse. It proves mechanics, not live permissions, scientific quality, real PDF
extraction or deployed timing. Unit tests cover exact policy, metadata, route auth
and proxy boundaries. Results below are the completed local checks.

Independent fresh-agent read-only review traced caller → admission → persistence →
worker → audit/publication → status. No blocking runtime defects found. Its deadline
caveat is recorded above; the deadline now starts at tick entry, before initial DB
reads. Review performed no live calls. Partial-batch success is N/A (one task);
UI async changes are N/A; shared helper fan-out and state consumers are covered by
Title, staff draft, machine-status and ledger regressions.

Sweep Mode A scope: Summary branch implementation and accepted intake contract.
Authoritative evidence: code, actual local SQL tests, Connor's response and Justin's
bounded-test/rerun decisions. Current field/worker/handoff/config/architecture plans,
ledger Atlas, route matrix, environment runbook, service catalogue and session notes
received scoped corrections; earlier dated trials are historical evidence. This is
not a whole-inventory truth audit of unrelated route/catalogue/environment entries. External PA/form
configuration remains unverified. Hosted policy/prompt rows and bounded Summary
delivery are now verified in the linked live receipt.

### Completed local checks

- 851 tests across 39 suites passed: all `tests/integration/prompt-jobs*` against
  disposable PostgreSQL 16, prompt-job/machine units, Summary metadata and editor
  contracts. Two additional invocation-deadline regressions then passed with the
  28-test worker suite (853 distinct tests across those suites).
- Type check and scoped ESLint passed. API inventory, Atlas, fact consistency,
  doc currency/symbols/canonical pointers/build-claims, GUID/OData, DAL/context,
  route lifecycle/service boundary, injection tagging, secret scan, scaffolding,
  status enum gates and each available sequential self-test passed. Migration
  manifest, docs catalogue, agent invariants and prebuild passed.
- Production-mode webpack fallback build passed with credentials scrubbed and
  existing shared installed dependencies. The worktree's external `node_modules`
  symlink precludes a canonical Turbopack claim; no fresh dependency install or
  hosted build was performed in that local verification pass. The subsequent
  bounded Preview reached Ready at `6d6a7c724`.
- No live Summary quality, SharePoint extraction, Entra authorization, cloud schema
  or field publication claim follows from those local checks alone. The separate
  live receipt now supplies bounded synthetic-input evidence.

Repository storage: feature-branch commits are retained in the main repository's
Git object store even if the temporary worktree disappears. No runtime branch push
was performed. The authorized isolated CLI Preview uses deployment-only overrides;
Production main and Connor's Preview remain untouched.
