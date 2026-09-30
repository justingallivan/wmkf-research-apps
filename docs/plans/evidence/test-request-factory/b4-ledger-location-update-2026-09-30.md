# B4 ledger location and restore handoff — 2026-09-30

**Ledger-dependent B4 steps: blocked: ledger not on this machine, until tomorrow's restore.** Location is now owner-confirmed; do not investigate or migrate the stale residue database here. PR #369 remains draft. No ledger connection, migration, run, cast/status change or slot PATCH was performed in this update.

## Evidence and source boundary

[OWNER-REPORTED in this chat, 2026-09-30] Operational `wmkf-ledger-pg/ledger_prod` and `wmkf-ledger-pg/ledger` exist only on the home Mac. This Mac's `ledger` is stale residue and is not an operational ledger. Snapshot/restore tomorrow is the prerequisite for B4 §6 schema/receipt preflight, owned cast-journal reads and address-digest comparison.

[OWNER-REPORTED; independently matched to PR #374's plan, not independently database-probed] Neon Marketplace project `wmkf-factory-ledger`, connected to no Vercel project, has `managed-ledger/ledger_prod` and `managed-ledger/ledger` with 054+058 applied. Provisioned schema does not establish restored operational journal history. The managed restore remains pending in the brief. This is separate from the app's shared Production/Preview database.

[VERIFIED via GitHub source read] Draft PR #374 is `claude/factory-ledger-registry` at `124ba673998a4676578fe169d283fbab80ac70f2`. Its [restore brief](https://github.com/justingallivan/wmkf-research-apps/blob/124ba673998a4676578fe169d283fbab80ac70f2/docs/plans/briefs/FACTORY_LEDGER_SNAPSHOT_BRIEF_2026-09-30.md) and [portability plan](https://github.com/justingallivan/wmkf-research-apps/blob/124ba673998a4676578fe169d283fbab80ac70f2/docs/plans/TEST_REQUEST_LEDGER_PORTABILITY_PLAN_2026-09-30.md) and stop-skill ledger-identity instruction were read through the GitHub contents API. Those new documents/registry/runner/fingerprint are absent from this B4 checkout. No checkout, merge, rebase or copy of Claude's implementation was performed; no direct reads/writes of Claude's checkout.

[VERIFIED via this branch source] The B4 CLI still has no-argument requireLedgerUrl and a blanket neon.tech refusal. The shared-database refusal message for a managed Neon URL is expected on this branch and does not add a B4 blocker. After restore, use only a shell override of TEST_REQUEST_LEDGER_URL pointing to 127.0.0.1:5433/ledger_prod for local production-ledger work, with the owner-supplied local password. Never commit the connection string, point B4 checks at today's stale ledger, or bypass the guard to use managed Neon. Sandbox work must use its restored ledger database.

[VERIFIED via link/file metadata and real CLI/Next.js loaders] The owner subsequently authorized recreating this worktree's shared .env.local symlink. It now resolves to ../WMKF_Apps/.env.local; both TEST_REQUEST_LEDGER_URL and TEST_REQUEST_SANDBOX_LEDGER_URL are present. Shared target contents were not changed, no secret values/URLs printed or committed. Both Local isolation switches resolve off/off from the shared file, replacing the earlier private-copy/on-on configuration; Local B4 literal-on readiness must be re-established before checks. [Sanitized link receipt](b4-shared-env-link-2026-09-30.json). No managed/local ledger connection was attempted.

## Second-landing integration obligations

Whichever of #369 and #374 lands second must reconcile the B4 slot-mode branch with requireLedgerUrl(args.target), preserving the target-aware database selection and fingerprint check. Do not change the B4 guard ahead of #374 or merge/rebase #374 into this branch.

After 058 is on main, the second landing must regenerate the tracked fingerprint against a disposable scratch Postgres database, using the script supplied by #374:

```bash
TEST_REQUEST_LEDGER_TEST_URL=<scratch postgres> node scripts/check-factory-ledger.js --write-expected
```

The CI ledger job and Jest job will otherwise fail. That registry/fingerprint surface is Claude's until deliberate integration; this update records the obligation without creating/editing it. Do not use an operational ledger as the scratch database.

From now on, every handoff/evidence line recording a Factory run, cast change or status change names its actual host label/database beside the run ID (for example, wmkf-ledger-pg/ledger_prod or managed-ledger/ledger_prod). No new such operation occurred here. Existing historical receipts keep their original provenance; unknown historical run destinations must not be guessed from the new location statement.

## Bounded reconciliation

/sweep Mode A: changed fact is known home-Mac ledger location and tomorrow's restore prerequisite. Authority is the explicit owner update, remote pinned brief/plan and local source/file metadata. Consumers are the B4 plan/checklist, owner packet, release/fix reports and branch handoff. Prior schema receipts remain dated historical observations of this Mac's stale residue; their physical schema facts are not operational-ledger evidence. The initial Opus review is explicitly historical. Claude's registry, portability plan, Atlas/memory changes and other checkout are excluded from edits by owner instruction. Managed live contents/schema parity and actual snapshot/restore are not independently probed here. No runtime/schema/migration change, no production milestone log entry required.

[VERIFIED via source/metadata/term search and local gates] Unknown-location/restored-ledger recommendations were structurally replaced in the B4 plan, release report, owner packet and current handoff. Historical schema and Opus receipts are explicitly dated; no new run/cast/status receipt was written. Remaining live stale claims in those owned surfaces: zero. All 20 documentation/Atlas/secret/scaffolding/harness/invariant/catalog gate commands passed, with gate/self-test pairs sequential; whitespace clean. No runtime test rerun was required for this docs-only update. Managed live schema/history and the actual restore remain unprobed here. Before this update, all 12 PR #369 checks also passed at e04553e76, draft/mergeable/clean. No production milestone entry required.
