---
name: project-local-docker-is-colima
description: "On the owner's Mac, Docker runs through Colima (no Docker Desktop app): start it with `colima start`. The Test Request Factory's throwaway ledger Postgres is the container wmkf-ledger-pg (postgres:16, 127.0.0.1:5433, password ledger, db ledger)."
status: active
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
When migration 054 changes, drop `test_request_run_resources`,
`test_request_runs` and `test_request_receipt_ok(jsonb)` first.
