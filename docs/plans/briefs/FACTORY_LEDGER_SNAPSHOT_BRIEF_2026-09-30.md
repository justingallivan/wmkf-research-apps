# Brief: snapshot the Factory ledgers at home, restore them at the office

Plan: `docs/plans/TEST_REQUEST_LEDGER_PORTABILITY_PLAN_2026-09-30.md`, Phase 1. Owner decision D3 (2026-09-30): dumps go straight to the owner's shared documents folder, unencrypted, and digests are compared on both sides. The owner supplies the folder path as `SHARED` below.

## Context

- The operational ledger for production test Requests (`ledger_prod`) and its sandbox counterpart (`ledger`) live only in the `wmkf-ledger-pg` Docker container on the **home Mac** (Colima; `colima start` if the Docker API is down).
- The **office Mac** has the same container with no `ledger_prod` and a stale, residue-laden `ledger`.
- Until Phase 2 of the plan lands, the copy in the shared folder is carried by hand. This brief does one round trip.

## Rules

- `pg_dump` and digests only on the home side; nothing else touches the ledgers there.
- Never print connection strings or credentials. The container's Postgres role is `postgres` with the local password from the memory entry; it never appears in output.
- The evidence file records digests and row counts only, never dump contents.
- If any step prints `STOP:` or a digest mismatch, do not restore; report to the owner.

## Home Mac (tonight)

```bash
SHARED="<owner supplies the shared documents folder path>"
STAMP=2026-09-30
cd /Users/gallivan/Code/WMKF_Apps && git pull --ff-only origin main
docker ps --format '{{.Names}}' | grep -qx wmkf-ledger-pg || { echo "STOP: wmkf-ledger-pg is not running (try: colima start; docker start wmkf-ledger-pg)"; exit 1; }
for db in ledger_prod ledger; do
  docker exec wmkf-ledger-pg pg_dump -U postgres -Fc "$db" > "$SHARED/$db-$STAMP.dump" || { echo "STOP: dump of $db failed"; exit 1; }
done
shasum -a 256 "$SHARED"/ledger_prod-$STAMP.dump "$SHARED"/ledger-$STAMP.dump
for db in ledger_prod ledger; do
  echo "== $db row counts =="
  docker exec wmkf-ledger-pg psql -U postgres -d "$db" -tAc "
    SELECT table_name || ' ' || (xpath('/row/c/text()', query_to_xml('SELECT count(*) AS c FROM ' || table_name, false, true, '')))[1]::text
      FROM information_schema.tables WHERE table_schema='public' AND table_name LIKE 'test_request_%' ORDER BY 1"
done
```

Then write `docs/plans/evidence/test-request-factory/ledger-snapshot-2026-09-30.md` with: the date, `home Mac → shared folder`, each dump's filename, SHA-256 and the row-count lines above, and the sentence "current copy: shared folder". Commit it to `main` (Tier 0 docs) and push:

```
docs: record Factory ledger snapshot 2026-09-30 (home → shared folder)
```

## Office Mac (next morning)

```bash
SHARED="<same folder path>"
STAMP=2026-09-30
cd /Users/gallivan/Code/WMKF_Apps && git pull --ff-only origin main
shasum -a 256 "$SHARED"/ledger_prod-$STAMP.dump "$SHARED"/ledger-$STAMP.dump   # must equal the evidence file; else STOP
docker ps --format '{{.Names}}' | grep -qx wmkf-ledger-pg || docker start wmkf-ledger-pg
docker exec wmkf-ledger-pg psql -U postgres -tAc "SELECT 1 FROM pg_database WHERE datname='ledger_prod'" | grep -q 1 \
  && { echo "STOP: ledger_prod already exists here; the owner decides whether to replace it"; exit 1; }
docker exec wmkf-ledger-pg createdb -U postgres ledger_prod
docker exec -i wmkf-ledger-pg pg_restore -U postgres -d ledger_prod < "$SHARED/ledger_prod-$STAMP.dump"
# the office `ledger` is stale residue: replace it
docker exec wmkf-ledger-pg dropdb -U postgres ledger && docker exec wmkf-ledger-pg createdb -U postgres ledger
docker exec -i wmkf-ledger-pg pg_restore -U postgres -d ledger < "$SHARED/ledger-$STAMP.dump"
```

Re-run the row-count block from the home section and compare with the evidence file. Append to the same evidence file: the date, `restored on office Mac`, the counts, and "current copy: office Mac and home Mac identical as of restore". Commit and push. The B4 ledger checks in `~/Code/WMKF_Apps-codex` can then run against `TEST_REQUEST_LEDGER_URL=postgres://postgres:<local password>@127.0.0.1:5433/ledger_prod` (set it in the shell, never commit it).

## Also tonight: load the managed ledger (D1, decided 2026-09-30)

The Neon project `wmkf-factory-ledger` now holds empty `ledger_prod` and `ledger` databases with the 054 + 058 schema. Add the same two variables to the home Mac's `.env.local` (values from the Neon console **Connect** dialog, pooled, one per database; paste in an editor, never in chat):

```
TEST_REQUEST_LEDGER_URL=<ledger_prod connection string>
TEST_REQUEST_SANDBOX_LEDGER_URL=<ledger connection string>
```

Then restore each dump into Neon through the container's `pg_restore` (the dump's owner is the local `postgres` role, so ownership and grants are dropped; `--clean` replaces the empty schema with the dump's, and 058 is re-applied afterwards so the shape matches the migration file):

```bash
cd /Users/gallivan/Code/WMKF_Apps
set -a; source .env.local; set +a
docker exec -i wmkf-ledger-pg pg_restore --clean --if-exists --no-owner --no-privileges -d "$TEST_REQUEST_LEDGER_URL"         < "$SHARED/ledger_prod-$STAMP.dump"
docker exec -i wmkf-ledger-pg pg_restore --clean --if-exists --no-owner --no-privileges -d "$TEST_REQUEST_SANDBOX_LEDGER_URL" < "$SHARED/ledger-$STAMP.dump"
git show origin/codex/factory-reviewer-b4-runtime:lib/db/migrations/058_test_request_cast_slot_bindings.sql > /tmp/058.sql
for u in "$TEST_REQUEST_LEDGER_URL" "$TEST_REQUEST_SANDBOX_LEDGER_URL"; do docker exec -i wmkf-ledger-pg psql "$u" -v ON_ERROR_STOP=1 -f - < /tmp/058.sql; done
rm /tmp/058.sql
```

Row counts on Neon (same query as above, but `docker exec -i wmkf-ledger-pg psql "$TEST_REQUEST_LEDGER_URL" -tAc "..."`) go into the evidence file beside the local counts. `set -a; source` exports every `.env.local` value into that shell only; close the shell afterwards. Nothing prints a connection string.

The Factory CLI still refuses `neon.tech` hosts until the plan's Phase 2 registry lands, so nothing runs against Neon yet; the office restore into the local container is still what unblocks B4 tomorrow.

## After either side runs a Factory command

Until Phase 2, whichever Mac last ran a ledger-driven command holds the current copy. Dump again from that Mac with a new `STAMP`, update the evidence file's "current copy" line, and restore on the other side before running anything there.
