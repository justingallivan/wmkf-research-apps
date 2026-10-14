# Proposal Ranking private-save conflict — October 14, 2026

## Scope and observed incident

The owner reported that separate PDs, signed in as themselves, saw entries
replaced in My preparation on the dedicated test Preview. This investigation
read D97 metadata and assessments only; it performed no assessment writes,
resets, production data access or production deployment.

[VERIFIED via `vercel inspect`] At investigation start the stable test alias
served READY Preview `dpl_HfhZs8uMFzxXkPCFyfMwam4868b1`, URL
`https://wmkf-meeting-transcription-test-ic0634b8w.vercel.app`.
This is the previous deployment, not a receipt for the fix below.

[VERIFIED via read-only sandbox probe] The active D97 round remained
`ea3496d5-c105-4e97-95c0-6b13a2e3f2ef`, private preparation version 1. Beth,
Justin, Jean and John each had a distinct linked active profile and three
separate assessment records. Latest edited records were attributed to their
owners; unchanged initial records were attributed to Justin as creator. The
records contained different confidence counts, orders and boundaries. This is
not proof that no historical overwrite occurred. Operation receipts retain
request hashes/outcomes, not historical copies of every private assessment.

Reproduce the bounded read with
`scripts/probe-ranking-test-save-isolation.cjs --env-file <dedicated-preview-env> --local-env <local-app-env>`,
using Node with `--import ./scripts/lib/use-extensionless.mjs`. The probe pins
the sandbox/test database, emits content hashes and attribution metadata, and
never writes saved work or prints credentials.

## Confirmed defect and repair

[VERIFIED via source and regression] Every private save changes the round ETag.
A second PD working from that round revision is rejected before their independent
assessment can commit. The old UI retained the request but retried the same stale
ETag indefinitely; discarding local changes reloads previously saved work.
This reproduces a cross-PD save conflict, not a persisted cross-PD overwrite.

`AssessmentWorkflow.execute` now passes its saved view into `client.js`.
For six explicit private actions, a definite stale-scope/conflict/confirmation
rejection triggers a read. The client retries only if round identity, actor,
active state, policy, full workflow and complete own assessment are unchanged.
It adopts the new round ETag/confirmation and a new operation UUID. The service
still authorizes the session-derived actor and atomically fences the changeset
with current round and list ETags. Another race is rejected and bounded to three
retries. Same-PD changes, shared operations, resets/reveal and unknown errors
remain outside the recovery path. Uncertain saves retain the exact final request
for receipt recovery, including a rebased UUID when applicable.

Persistence, routes, schemas and server privacy contracts are unchanged. Partial
success is N/A: the existing changeset remains atomic. Stale asynchronous UI
responses retain the existing generation/unmount guards. Enum/schema fan-out is
N/A; the recovery allowlist uses existing action/error tokens only.

## Validation and limits

- Full ranking regression, including real client-to-service logic with an
  in-memory ETag-enforcing adapter, preserves different answers from two PDs
  loaded at the same initial round revision.
- Client tests reject changed own work, actor, round, policy, stage, preparation
  version and closed rounds; shared actions and uncertain errors do not rebase.
- UI regression retains the rebased pending request after an uncertain result.
- Type check and scoped ESLint passed. Fresh-agent read-only review found no
  actionable issue; the reviewer did not independently run live account tests.
- Deployment is pending: Vercel CLI authentication became unavailable after the
  initial read-only inspections. The owner was asked to complete `vercel login`.
- Independent hosted multi-account acceptance after deployment remains required.
  No restoration or reset of colleagues' work is authorized or performed.

## Narrow changed-fact reconciliation

Mode A: client recovery contract only. Authoritative sources are client/UI,
workflow-service receipt and scope guards, adapter changesets, regression tests,
and the bounded read probe. API-contract section 6 now describes the recovery.
The Atlas's round-fenced persistence description and implementation-plan's
same-PD stale-write requirements agree and remain unchanged. Historical rehearsal
receipts are not relabeled as current multi-user acceptance. Broader historical
ranking deployment prose is excluded from this bug-fix audit.
