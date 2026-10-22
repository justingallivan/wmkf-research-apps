---
name: project-local-docker-is-colima
description: "Dated local setup: Test Request Factory ledger suites can use a throwaway Postgres container through Colima. Current Colima/container presence is unknown; verify locally before use."
status: active
last_verified: 2026-10-05 dated local Colima/container observation; current presence unknown
metadata:
  type: project
---

## Recall Rule

Read before running the Test Request Factory live ledger suites or anything
else that needs a local container.

[VERIFIED 2026-09-24, Session 538] `open -a Docker` fails ("Unable to find
application named 'Docker'"); `/opt/homebrew/bin/colima` and `docker` exist.
`colima start` brings the Docker API up (context `colima`). The earlier
`wmkf-ledger-pg` container was gone after Colima restarted, so it was recreated:

`docker run -d --name wmkf-ledger-pg -e POSTGRES_PASSWORD=ledger -e POSTGRES_DB=ledger -p 127.0.0.1:5433:5432 postgres:16`

Then `TEST_REQUEST_LEDGER_TEST_URL=postgres://postgres:ledger@127.0.0.1:5433/ledger`
and run the two `.pg.test.js` suites with `--runInBand` (running them in
parallel on a fresh database races on schema creation and fails spuriously).
[OBSERVED 2026-10-05] The then-running `wmkf-ledger-pg` used `postgres:16-alpine`;
that observation does not establish current container presence. The ledger proof at
`tests/integration/test-request-run-ledger.pg.test.js` requires an explicit scratch/local
`TEST_REQUEST_LEDGER_TEST_URL` and refuses Neon or the shared `POSTGRES_URL`. Its
fixtures create a random isolated schema and clean up only the rows/schema they create.

Migration 054 is tracked by the durable migration ledger. Applied migration files are
checksum-immutable: schema changes must use a new numbered forward migration. Do not
drop ledger tables or replay the migration as a generic response to a migration change.
