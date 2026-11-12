# Session 675 Prompt: Shared Executor trial complete; PA integration handed off

## Session 674 Summary (Codex, 2026-11-11)

**Destination:** `codex/coordinated-start-2026-11-10-b`, isolated worktree
`/private/tmp/wmkf-coordinated-start-2026-11-10-b`. Keep runtime and session docs
on this branch; no main promotion or deployment. Numbering is branch-local.
The preceding complete handoff is retrievable with
`git show 23b39df83:SESSION_PROMPT.md`; its inherited concurrent-stream index
also points to `33a233633:SESSION_PROMPT.md`. Both are historical, not current
permissions or worktree authority.

### Completed — verified by source, tests and controlled live trial

- Built the shared profile/context, durable job/checkpoint and typed recommendation architecture; authoritative boundaries are in `docs/plans/SHARED_EXECUTOR_JOB_ARCHITECTURE_2026-11-10.md` and `docs/plans/SHARED_EXECUTOR_TASK_INTERFACES_2026-11-11.md`.
- Added compiler 2 native JSON Schema derived from the frozen roster, preserving compiler 1 checkpoints and closed domain validation. No output repair, automatic retry or fallback.
- Ran four authorized Sandbox trials on Request 1000339. Prior failures remain intact. The fourth returned complete valid JSON: 548 output tokens, 1,869 characters, all measured brevity targets, no identity/schema errors or duplicate recommendations.
- Fourth job `27232d4d-1be9-4489-b7a1-1fda69b05551`; sole-current Sandbox prompt v4 `6e1443be-e662-41ca-bcc0-469614c00745`; success audit `20754273-7a8e-4619-9a44-5199d1f12022` delivered/read back. Normal Microsoft OAuth staff GET returned available/current; anonymous GET redirected to sign-in.
- One HTTP 200 provider POST; usage-based estimate $0.15441075 versus conservative preflight ceiling $1.212980. Shared PostgreSQL host `ep-frosty-credit-afovxswa-pooler.c-2.us-west-2.aws.neon.tech`, database `neondb`, was explicitly approved for scoped ledger writes. No Request-field writes, Production Dataverse writes or deployment.
- Opus 5.5 ordinary OAuth plan/build reviews completed; named changes were closed by focused tests and source review. Exact packet hashes and evidence are in the task-interface plan. The local server is stopped and the roster/source coordination hold is released.

### Key commits

- `7b140b6ee`, `3ce88acb6` — roster-derived schema and conflict guidance.
- `aa763f044`, `62b396ddf` — native compiler, compatible checkpoints and documentation.
- `d6919c949` — exact fourth-trial admission, candidate, runner and failure-path tests.
- `23b39df83` — successful trial evidence and eight reconciled documentation surfaces.

## Next Items

### Verified Open

1. **Staff assessment of recommendation quality.** Structural, identity, length and freshness checks passed; scientific suitability and conflict clearance are still human review. Evidence: task-interface plan, “Live native-schema trial outcome.” Do not treat a zero-conflict model result as independent clearance.
2. **Due-only retention cleanup for the four jobs.** Commands and each job’s deadlines are in the task-interface plan. Fourth source/response deadline: `2026-11-13T04:03:52.504Z`; configuration/result/audit deadline: `2026-11-19T04:03:52.504Z`. These are Nov 12 and Nov 18 at 9:03:52 p.m. America/Phoenix. Recheck current time, exact job/database bindings and retained content before acting. No cleanup was run by this stop. The runner's `expire` mode refuses early cleanup; preserve quota receipts and the approved SharePoint PDF.

### Handed Off — do not duplicate

Power Automate integration is owned by the other Codex chat
`01a1c633-9230-78c3-ad45-13450c921093`, branch
`codex/power-automate-integration-2026-11-11`, recorded worktree
`/private/tmp/wmkf-pa-integration-20261111`. Its owner reported an isolated
machine-auth/admission proof and ongoing status/ETag delivery work; those
changes were not audited or imported here. Read its current handoff and
`docs/plans/POWER_AUTOMATE_PROMPT_HANDOFF_2026-11-11.md` on that branch before
planning. User priority there is plumbing and Dataverse field delivery, not
further prompt wording. Shared surfaces were released after `d6919c949`.

### Parked / Owner Decisions

- Production rollout, broader machine enablement, scheduling, additional prompt destinations and Request writeback are outside this completed trial. Coordinate with the PA owner; do not infer deployment/provisioning authority.
- Native schema acceptance is proven for this one proposal/roster. Broader quality, schema scale and cache savings are not established by this result.

### Do Not Reopen Without New Decision

- No fifth job or extra paid generation is authorized. The durable quota rejects a fifth receipt, including after content cleanup. Ask before any future authorized generation expected to exceed $10.
- Keep one backend Executor for app and PA, exact caller authorization, sealed source/roster bindings and strict domain validation. No guessed identities, result unwrapping, repair generation or duplicated PA provider executor.
- No automatic reruns on file replacement; no main promotion, environment changes, credential provisioning, or other-session worktree switching.

## Concurrent workstreams — compact routing index

| Stream | Owner / recorded boundary | Resume source |
|---|---|---|
| Shared Executor / expertise trial | This chat; complete at `23b39df83`, stop docs follow | Task-interface plan and this branch |
| Power Automate integration | Other Codex chat, branch above; active owner-reported work | Its current handoff and PA prompt handoff plan |
| Expertise roster | Same other chat; prior roster checkout recorded clean at `0b4c88a79`; no current hold | `docs/plans/EXPERTISE_ROSTER_HANDOFF_2026-11-09.md` and owner confirmation |
| J27 / Request narratives / other inherited streams | Not re-audited here | Historical complete index at `23b39df83:SESSION_PROMPT.md` and `33a233633:SESSION_PROMPT.md`; verify current owner before acting |

## Verification and local artifacts

- 232 unit tests / nine suites; 93 real disposable PostgreSQL tests / three suites; final affected PostgreSQL suite 60 tests after review closure. Scoped lint/types, source gates and self-tests, documentation gates and isolated production webpack build passed.
- No active local server or disposable database remains from this trial. Private state is local-only under `/private/tmp/wmkf-expertise-sandbox-trial-1000339-v4-20261111`; `e2e-receipt.json` is the clean content-free receipt. Do not commit credentials, snapshots, results or private state. On another machine, do not reconstruct missing state or copy secrets into Git; obtain a deliberate secure handoff before cleanup.
- Claim-evidence report was attempted but local state was unavailable; no observation row invented. Memory router unchanged.
- Milestone determination: a new architecture was built and proven in Sandbox, so a DEVELOPMENT_LOG milestone is required and included in this stop. CLAUDE.md conventions remain unchanged.
- Stop documentation and push stay on this feature branch. Check Git log and remote tracking for the final stop commit.
