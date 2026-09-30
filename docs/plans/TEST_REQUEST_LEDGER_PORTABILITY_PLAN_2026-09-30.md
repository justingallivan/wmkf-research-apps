# Test Request Factory ledger: portability and single source of truth

Status: **DRAFT, revision 0 (2026-09-30, S553). Written after the B4 release preflight stalled in the office because the operational ledger exists only on the home Mac. Nothing built. Owner decisions D1–D3 open.**

## Problem

The Factory's operational state for production test Requests (cast members, cast bindings, run journal, status changes) lives in `ledger_prod`, a Postgres database inside the `wmkf-ledger-pg` Docker container on the home Mac. It was built by hand (`psql -f` of an in-place-edited 054, then explicit `ALTER TABLE`s), it has never been dumped, and nothing on the office Mac can reach it [VERIFIED 2026-09-30: this Mac's container holds only a stale `ledger` with the two original 054 tables and no `ledger_prod`].

That placement was deliberate. Rule P6 of the production plan and the CLI guard `requireLedgerUrl` (`scripts/rehearse-test-request-sandbox.mjs:749-760`) forbid running ledger-driven modes against the app's shared database, by refusing any `TEST_REQUEST_LEDGER_URL` that equals a configured `POSTGRES_URL*`/`DATABASE_URL` or names a `neon.tech` host. The guard has no positive notion of where the ledger *should* be, so the only place that satisfied it was a laptop.

Consequences today:

1. Any owner-run Factory step, and every B4 readiness check that reads `test_request_cast_members`, is impossible away from the home Mac.
2. A disk failure or a Colima reset (which already deleted the container once, S538) loses the production cast's GUID-to-digest record. A rebuilt ledger would let a clone re-create contacts that already exist in production.
3. Two ledgers (`ledger_prod`, `ledger`) plus each machine's copies drift in schema silently: 054 was edited in place at least three times (S547 status changes, S548 cast tables, S548 role check) and applied by hand each time; nothing verifies a ledger matches the migration files before a command runs.
4. Session handoffs record *what* was run but not *which ledger* held the result (the cast plan itself notes the 1003303 ledger is unrecorded).

## Goal

One operational ledger, reachable from every machine the owner works on, still never the app's database, with its schema verified by tooling before any command touches it, and a recovery path that does not depend on one laptop.

## Owner decisions

- **D1 — Where the ledger lives.** Options in *Phase 2*. Recommendation: a second, dedicated Neon project (`wmkf-factory-ledger`), separate credentials, never linked to the Vercel project.
- **D2 — Local Docker ledgers after the move.** Recommendation: keep the container for the live-Postgres test suites only (`TEST_REQUEST_LEDGER_TEST_URL`); retire `ledger_prod` locally once the managed copy is verified and one dump is archived.
- **D3 — Interim transport: DECIDED (owner, 2026-09-30, S553).** Dumps are written directly to the owner's shared documents folder, which both Macs reach, unencrypted. The owner accepts that posture for these files (production Request and contact GUIDs, address digests, journal JSON; no credentials). Digests are compared on both sides before a restore.

## Phases

### Phase 0 — Today, office (no ledger access needed; ~1 h)

1. **Codex on B4:** every checklist step that needs `ledger_prod` or `ledger` is recorded as *blocked: ledger not on this machine*, not improvised against the stale local `ledger`. Everything else on the B4 checklist proceeds.
2. **Snapshot helper (Tier 0 script, this plan's first build item):** `scripts/factory-ledger-snapshot.sh dump|restore --db=ledger_prod|ledger --file=<path>`. `dump` runs `pg_dump -Fc` inside `wmkf-ledger-pg`, writes the file, prints its SHA-256 and the row counts of every `test_request_*` table. `dump` writes to the path given (the shared folder under D3). `restore` creates the database when it is absent (this Mac has no `ledger_prod`), refuses if the target already has rows unless `--replace` is passed (which drops and recreates it; the office `ledger` needs this because of residue), then `pg_restore`s and prints the same counts so the two sides can be compared. No credentials in output.
3. **Ledger identity in handoffs:** from this session on, any handoff or evidence file that records a Factory run names the ledger host and database (`wmkf-ledger-pg/ledger_prod` today) beside the run id. Add the line to the `/stop` skill's checklist.

### Phase 1 — Tonight, home Mac (~20 min)

Step-by-step brief for the agent on each machine: `docs/plans/briefs/FACTORY_LEDGER_SNAPSHOT_BRIEF_2026-09-30.md`.

1. `dump` both `ledger_prod` and `ledger` with the helper; keep the printed digests and counts in `docs/plans/evidence/test-request-factory/ledger-snapshot-2026-09-30.md` (digests and counts only, never the dump).
2. Wait for the shared folder to sync; the office side compares digests before restoring.
3. Next office morning: compare digests, `restore` both here (`createdb` for the absent `ledger_prod`, `--replace` for the residue-laden `ledger`); compare counts to the evidence file; record the restore in the same evidence file. Codex's blocked B4 steps become runnable.

This is the stopgap. It is manual in both directions and must be repeated after every home-Mac Factory command until Phase 2 lands, so the evidence file must say which copy is current.

### Phase 2 — Managed ledger (after D1; ~half a day plus review)

**Options considered**

| Option | Reachable from both Macs | Satisfies "never the app database" | Guard change | Cost |
|---|---|---|---|---|
| A. Second Neon project, own credentials | yes | yes (different project, host and role) | replace the `neon.tech` blanket refusal with a tracked host allowlist | free tier [ASSUMED; verify current Neon pricing before D1] |
| B. Non-Neon managed Postgres (Supabase, Railway, Fly) | yes | yes | allowlist as in A | free or low tier [ASSUMED]; a second vendor to run |
| C. Keep local, automate dump/restore via cloud folder | partly (restore lag, two-way conflicts) | yes | none | zero, but the drift and loss risks stay |
| D. Schema in the shared database under a separate schema name | yes | **no** (P6; the CLI would have to be taught to accept a shared URL) | large | rejected |

**Recommendation: A.** Same operational knowledge as today's Neon, one console, branchable for rehearsal, and the isolation P6 wants is by project rather than by laptop.

**Build items for A**

1. `lib/services/test-requests/ledger-registry.js` (tracked, reviewed like `target-registry.js`): the allowed ledger hostnames, each labelled `production-ledger` or `sandbox-ledger`, plus `localhost`/`127.0.0.1` labelled `local`. `requireLedgerUrl` becomes: URL set; hostname in the registry; not equal to any configured shared URL; and, for `--target=production`, labelled `production-ledger` or `local`. Extending the registry is a commit, not an env edit. The `neon.tech` regex goes away, replaced by the allowlist (an unregistered Neon host is refused the same as any other unregistered host).
2. `TEST_REQUEST_LEDGER_URL` (production ledger) and `TEST_REQUEST_SANDBOX_LEDGER_URL` (sandbox) documented in `docs/CREDENTIALS_RUNBOOK.md` (which does not mention `TEST_REQUEST_LEDGER_URL` today [VERIFIED 2026-09-30 by grep]) and `lib/utils/tracked-secrets.js`, stored in each machine's `.env.local` only, never in Vercel. Rotation procedure: Neon console reset, update both Macs, same as the office sync done in S553.
3. Migrate: restore the Phase 1 dump into the new project, run the Phase 3 schema check, then run one read-only `--run-inspect` against it from each Mac. Only then retire the local `ledger_prod` (D2).
4. Update the cast plan §6 and the B4 release checklist to name the managed ledger instead of "local `ledger_prod` and `ledger`"; update the Atlas ledger page header.
5. **Review:** the registry and the new `requireLedgerUrl` loosen a fence that went through Codex review, so they get one Codex adversarial round before merge, on their own Tier 1 branch (CLI and scripts only, no app runtime).

### Phase 3 — Schema verification (with or after Phase 2; ~half a day)

The in-place edits to 054 are the drift source. Two build items:

1. **Ledger migration runner:** `scripts/apply-ledger-migrations.js --url=<ledger url>` applies the ledger's migration files (054, 058, and any later `test_request_*` migration) with a `schema_migrations` tracker *inside the ledger database*, `applied_by` recorded, idempotent by filename like `apply-migrations.js`. Because 054 was edited in place, its first run against an existing ledger performs the documented reset only when `--reset-054` is passed and the ledger has zero runs; otherwise it refuses and points at 058's repair.
2. **Schema fingerprint check:** `--ledger-check` mode in the CLI (and a `check:factory-ledger` gate that runs it when the URL is set) computes a fingerprint of the ledger's `test_request_*` tables, constraints, indexes and `pg_get_functiondef('test_request_receipt_ok')`, compares it to the fingerprint derived from the migration files, and prints the diff. Every ledger-driven command runs the check first and refuses on mismatch. `/start` runs it when `TEST_REQUEST_LEDGER_URL` is set and reports "ledger unreachable" as a named condition rather than silence.

### Phase 4 — Durable facts and hygiene (~1 h)

1. Atlas `docs/atlas/postgres-test-request-runs.md`: ledger location, registry, fingerprint check, dump procedure.
2. `docs/agent-wiki/topics/dev-environment.md` and `.claude-memory/project-local-docker-is-colima.md`: the container is for tests; the operational ledger is managed.
3. Make `tests/integration/test-request-run-ledger.pg.test.js` and `test-request-run-runner.pg.test.js` schema-scoped like the newer suites, so residue in a local `ledger` database cannot fail them (they fail on this Mac today for that reason while passing in CI).
4. Memory entry: *feedback-operational-state-must-be-reachable-from-every-workstation* — any owner-run tool that keeps durable state must name where that state lives, and the location must not be one machine.

## Order and dependencies

Phase 0 → Phase 1 (tonight) → D1 → Phase 2 and Phase 3 in parallel on separate branches (Tier 1: CLI and scripts only, no app runtime) → Phase 4. B4's ledger-dependent checks can run on the restored local copy after Phase 1; they do not wait for Phase 2.

## Risks

- **Two live copies during Phase 1.** Mitigated by the evidence file naming the current copy and by the restore helper refusing a populated target without `--replace`.
- **Allowlist mistakes.** A wrong host in the registry is a reviewed commit; the shared-URL equality refusal stays as a second fence.
- **Managed-tier compute suspension** [ASSUMED for Neon's free tier] may pause an idle project so the first command of a session takes a few seconds. Acceptable for owner-run tooling.

## Not in scope

The P7 admin form and the "Q2 shared ledger" it needs are unchanged; if P7 ever lands, its ledger is the managed one from Phase 2, not the app database.
