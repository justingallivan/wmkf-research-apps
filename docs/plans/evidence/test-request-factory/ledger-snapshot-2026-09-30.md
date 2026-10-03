# Factory ledger snapshot and managed-ledger load — 2026-09-30

Plan: `docs/plans/TEST_REQUEST_LEDGER_PORTABILITY_PLAN_2026-09-30.md` (Phase 1 and Phase 2 item 3). Brief: `docs/plans/briefs/FACTORY_LEDGER_SNAPSHOT_BRIEF_2026-09-30.md`. Digests and counts only; no dump contents, no connection strings.

**Current copy: `managed-ledger` (Neon project `wmkf-factory-ledger`), databases `ledger_prod` and `ledger`.** The home Mac's local `wmkf-ledger-pg` copies are left in place, unchanged, as the fallback until D2.

## 1. Home Mac → shared folder (18:05 PT)

Full `pg_dump -Fc` of the local container (PostgreSQL 16.15), written to the owner's shared folder under D3.

| File | SHA-256 |
|---|---|
| `ledger_prod-2026-09-30.dump` | `35a7bf0324733f8ba224ede8d169e9e52ad1040b2f8f10b1344fdaf9f2d54417` |
| `ledger-2026-09-30.dump` | `687c589dedd046649a60c71fd68c1a01accc15e5f4e705d4f107d481958bc5fd` |

Local row counts (054 shape; no `test_request_cast_slot_bindings`):

| Table | `ledger_prod` | `ledger` |
|---|---|---|
| `test_request_cast_bindings` | 1 | 0 |
| `test_request_cast_members` | 5 | 0 |
| `test_request_run_resources` | 21 | 44 |
| `test_request_run_reviewer_assignments` | 0 | 12 |
| `test_request_runs` | 3 | 4 |
| `test_request_status_changes` | 1 | 0 |

## 2. Home Mac → managed ledger

Preconditions [VERIFIED by read-only probe]: both Neon databases had every `test_request_*` table at 0 rows, `ledger_schema_migrations` at 2 rows (054, 058). Their column lists for the six shared tables matched the local ones exactly. Constraint differences were only Neon's catalogued NOT NULL entries, plus one CHECK: the sandbox `ledger`'s `resource_kind` list on Neon is a superset of the local one, adding `foundation_transition`.

Method (deviates from the brief's Neon section, see §3): a separate `pg_dump -Fc --data-only` of each local database, then `pg_restore --no-owner --no-privileges --single-transaction --exit-on-error` into the matching Neon database (local `ledger_prod` → `TEST_REQUEST_LEDGER_URL`, local `ledger` → `TEST_REQUEST_SANDBOX_LEDGER_URL`). The Neon 054 + 058 schema and its tracker rows were not touched. Both restores exited 0.

Neon row counts after the load equal the local counts above for all six tables, and `test_request_cast_slot_bindings` holds 0 rows in each database. Sequences: `ledger_prod` resource 21 / max 21; `ledger` resource 131 / max 131, assignment 27 / max 27.

Checks: `npm run check:factory-ledger` → both `managed-ledger` databases match the 054 + 058 fingerprint (2 inspected, 0 refused). `--target=production --run-inspect=e33fa857-4b00-4c60-94da-77d4406d4027` (Test Request 1003303, status `ready`) read the run from `managed-ledger/ledger_prod` with a matching schema check.

**Pooler hazard, observed and cleared:** pg_dump output runs `set_config('search_path', '', false)`, which is session-scoped. Through Neon's transaction-mode pooler, that empty `search_path` stayed on the single pooled server backend of each database. The first `check:factory-ledger` run therefore failed with `schema=null`, and unqualified queries could not see the tables. A `RESET search_path` through the pooler, which landed on the only backend, restored `"$user", public`, and the gate then passed. Any future `pg_restore` or `psql -f` of pg_dump output against the pooled URL must be followed by `RESET search_path`, or should use the direct (non-pooler) host.

## 3. Superseded brief steps

PR #374 merged before this load, so two parts of the brief no longer applied:
- The "Office Mac (next morning)" restore into the office container is unnecessary. Both Macs now read the managed ledger.
- The brief's Neon section (`pg_restore --clean --if-exists` of the full dump, then a hand re-apply of 058) is unsafe against a ledger whose 058 is already applied and tracked: `--clean` cannot drop `test_request_cast_bindings` while the 058 `test_request_cast_slot_bindings` foreign key references it, and a hand re-apply bypasses `ledger-migrations.js`.

Remaining: one read-only `--run-inspect` from the office Mac (plan Phase 2 item 3), then the owner's D2 decision on retiring the local copies.
