---
title: Bounded Executive Summary integration
status: branch-built
last_verified: 2026-11-16
---

# Executive Summary integration — bounded test Requests

Owner: Codex. Branch: `codex/executive-summary-generation-2026-11-16`.
Worktree: `/private/tmp/wmkf-summary-generation-20261116`.
[OWNER DECISION 2026-11-16] Build on a branch; explicitly enrolled test Requests first.
No deployment, enrollment, cloud migration, real model call or Request write occurred
in this build. The separately deployed staff editor is documented in
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

## Enrollment and bounded live acceptance remaining

1. Review the full branch release delta. This branch starts from PA commit
   `db00e33ba`, merged with current main `57eb7c40f` at `8e9a615bc`; it includes
   inherited unpromoted shared Executor, Admin profile, staff draft and recommendation
   work. It is not just a small patch on production main. Keep all unrelated trial
   policies disabled and do not replace Connor's existing Preview.
2. Prepare an isolated Sandbox Preview and database with canonical migrations using
   the existing migration runner. Verify migration 097 fingerprints and database
   identity; do not use fresh-install setup on an existing database. No schema apply
   is authorized by this document alone.
3. Select one explicitly approved test Request with a blank Summary, stored PI and
   finalized narrative. Verify the exact file/path, Graph revision semantics and
   readable PDF with the real producer. The ready flag is the final handoff, not an
   AI prerequisite. Set the stable source-event UUID at enrollment; the broader
   intake event mapping remains Connor's flow wiring, not a new unresolved source choice.
4. Read the actual current Summary prompt/profile in the target environment and pin
   their IDs/version/hashes. The checked-in November 11 v2 candidate supplies the
   tested raw-output/profile shape; it is not proof those rows are published in the
   selected Sandbox. Do not silently republish or alter prompt wording.
5. Configure **only** `PROMPT_JOB_SUMMARY_PILOT`, never overwrite
   `PROMPT_JOB_MACHINE_PILOT`. It uses the existing exact policy keys: `enabled`,
   `pilotId`, `requestId`, `sourceEventId`, `tenantId`, `audience`, `clientId`,
   `servicePrincipalId`, `role`, `promptId`, `promptVersion`, `promptHash`,
   `profileHash`, `databaseIdentity`, `databaseEndpoint`, `expiresAt` (≤7 days).
   `destinationGrant` is rejected; the Summary field is code-owned. Require the
   pinned Sandbox origin, both Dataverse enforcement flags `on`, server nonce secret
   and pinned Postgres URL. These policy IDs/hashes are nonsecret; credentials stay
   server-side. Verify application token claims and wrong-request/status isolation.
6. Inspect the deployed drain budget: route and exact Vercel override are 240 seconds,
   lease 300 seconds, Executor deadline 210 seconds from tick entry (also bounded by
   lease minus checkpoint margin). Metadata, extraction and final writes are not
   globally abort-controlled: a platform termination must recover conservatively
   through lease/unknown-outcome fences. No forced live timeout has been tested.
7. Obtain approval for one bounded real generation/audit/write, then submit/poll and
   advance stages. Verify one provider attempt, one audit, one applied Summary and
   staff readback; replay the same key and confirm no additional side effects.
   Restore original Summary if the approved fixture procedure calls for it. Retain
   receipts and record cleanup deadlines. Content quality needs human review.
8. Only after that evidence, decide deployment and future broader intake/scheduling.
   Current code refuses Production; broad production activation is not a config flip.

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
configuration, hosted policy/prompt rows and live Summary delivery remain unverified.

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
  hosted build was performed.
- No live Summary quality, SharePoint extraction, Entra authorization, cloud schema
  or field publication claim follows from these checks. A bounded live test remains.

Repository storage: feature-branch commits are retained in the main repository's
Git object store even if the temporary worktree disappears. No runtime branch push
was performed because it could create a Preview deployment before the bounded
setup is selected. Production main and Connor's Preview remain untouched.
