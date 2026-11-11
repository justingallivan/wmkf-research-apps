# Sandbox recommendations admission source review

**[VERIFIED 2026-11-11 via the review receipt]** The owner approved the
exact 118,326-byte source packet, SHA-256
`d3fe9f501791d4516f9bf46bc5b2478a1ee46e0fca1487cafd9db9042258a529`.
The one-turn ordinary OAuth review reported only `claude-opus-5-5` in
model usage and 228,403 ms elapsed. Its verdict was **READY WITH NAMED
CHANGES**. It reviewed the library at `2a0f4d6bd` and the operator runner.
The packet and raw review are retained locally.

The reviewer accepted the durable singleton, full-policy replay binding,
single-request provider transport and checkpoint fence. The review did not
exercise live publication, admission, generation, audit delivery or the
signed GET.

| Finding | Disposition |
| --- | --- |
| 1. Runner readiness check could leave a revoked actor's task unclassified | The runner leaves `tick` and `recover` authorization to the worker so confirmed denial reaches the queued or saved-response transition. Readiness still applies to publication, preflight, admission and inspection. |
| 2. Fetch `Request` object could bypass method classification | Both guards reject non-string fetch inputs before evaluating the method or URL. |
| 3. Audit callback used the pre-tick job view | The worker already delivers audit in a separate tick. The runner now checks a fresh exact job and the frozen audit UUID in `dispatching` before allowing the POST. |
| 4. Runner lacked a persistent same-UUID audit POST fence | The runner persists the audit UUID before sending and rejects a subsequent POST. The worker maps ordinary adapter or readback errors to `unknown` and never reposts an unknown audit. |
| 5. Cluster/database hash may not distinguish every managed endpoint | The runner also pins the exact endpoint hostname and database name and rejects target-overriding URL parameters. The owner subsequently approved the shared endpoint for one scoped trial. |
| 6. Profile readback missing from the runner excerpt | `publishPromptProfile` already rereads and verifies the exact publication UUID and payload after creation. The runner also checks the retained profile against the approved candidate. |
| 7. Duplicate active app grants treated as revocation | `faac0819c` makes duplicates unavailable proof. A saved response can remain withheld for explicit zero-call recovery. |
| 8. Stale runner header | The runner describes the guarded operator modes and the separate cleanup deadlines. The HTTP guard covers the runner's `fetch` traffic. SQL writes are governed separately by the pinned ledger and its scoped store operations. |
| 9. Cleanup needs two passes | Source and response content expire after 24 hours. Configuration, result and audit content expire after seven days. Operator cleanup deletes only expired rows under the exact database, job and owner binding and preserves receipts and quota history. |

The full worker source resolves two review limitations. A pre-dispatch
error with no attempt goes through `failBeforeDispatch`, returning
`waiting` for an unavailable check and recording a terminal failure
for a confirmed denial. `LLMClient` stores the `fallbackModel` constructor
option, and the trial uses no fallback.

[VERIFIED via local checks] Runner commit `eaecc0935` has SHA-256
`633f12a7cbf1690bb9341ae352a1807d180826aaf8d6dfbff2910ce8043f7d44`.
Node syntax, scoped ESLint and the offline runner guard test passed.
The grant-proof regression at `faac0819c` passed 119 focused tests.
The reviewed source packet predates these local fixes.

## Live boundary

The application PostgreSQL database is shared by Production and Preview.
The Sandbox Dataverse trial's admission, lease/checkpoint updates,
result retention and audit receipts use that shared ledger. The owner
explicitly approved one scoped trial against the shared database after
this distinction was raised. The runner pins the exact shared endpoint
and ledger identity.
[Application PostgreSQL contract](../CREDENTIALS_RUNBOOK.md#rotating-the-app-postgres-password-postgres_url-family).

The separately approved SharePoint copy and read-only preparation for
Sandbox Request 1000339 succeeded with no trial ledger writes. At the
close of source review, Sandbox prompt/profile publication, trial
admission, the provider request, AI-run audit and signed GET were still
pending. [Source and local trial evidence](../plans/SHARED_EXECUTOR_TASK_INTERFACES_2026-11-11.md#local-sandbox-recommendations-trial).
