---
name: feedback-operational-state-must-be-reachable-from-every-workstation
description: Any owner-run tool that keeps durable state must name where that state lives, and that place must not be one machine; a guard that only says where state must NOT be leaves a laptop as the only compliant home.
metadata:
  type: feedback
  status: active
---

**Recall rule:** read before designing or reviewing any owner-run tool (CLI, script, rehearsal) that writes durable state outside the app database.

**What happened (2026-09-30, S553):** the Test Request Factory's production ledger existed only in a Docker container on the owner's home Mac. The CLI guard refused the app's shared Postgres and every `neon.tech` host but named no place the ledger *should* be, so a laptop was the only compliant location. A day's B4 release work stalled in the office, and a Colima reset had already deleted the container once.

**Why:** "never the app database" is a necessary rule, not a location. Without a registered destination, tooling drifts to whatever is at hand, nothing dumps it, nothing verifies its schema, and handoffs record run ids without saying which copy holds them.

**How to apply:**
- Every durable store an owner-run tool writes gets a tracked allowlist of where it may live (`lib/db/ledger-registry.js` is the pattern; `target-registry.js` before it) and a guard that checks the *actual* host against it.
- Its schema is verified by tooling before a command runs (`check:factory-ledger`, `--ledger-check`), never assumed from a hand-applied migration.
- Handoffs and evidence name the store beside the record id (the `/stop` ledger-identity line).
- If state must temporarily live on one machine, the brief that creates it also schedules its dump and names the current copy.

Plan: [[project-test-request-ledger-portability]] → `docs/plans/TEST_REQUEST_LEDGER_PORTABILITY_PLAN_2026-09-30.md`.
