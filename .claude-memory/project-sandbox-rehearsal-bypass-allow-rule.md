---
name: project-sandbox-rehearsal-bypass-allow-rule
description: "A narrowly scoped, machine-local Claude Code allow rule was owner-authorized for the sandbox rehearsal CLI; verify the local entry before use."
metadata:
  node_type: memory
  type: project
  status: active
  last_verified: historical check 2026-10-05; recheck the local setting before relying on it
  originSessionId: 5fb56b4d-c45a-4872-8a32-38a75b670ef3
  modified: 2026-09-24T05:02:25.866Z
---

## Recall Rule
Read when the auto-mode classifier blocks `scripts/rehearse-test-request-sandbox.mjs --execute ... --bypass-goverify`, or when setting up the Test Request Factory on another machine.

The owner authorized a machine-local Claude Code rule on 2026-09-24 (S537).
It lives in the gitignored `.claude/settings.local.json` and does not travel with
Git. The exact previously authorized template is:

`"Bash(DYNAMICS_SANDBOX_URL=https://orgd9e66399.crm.dynamics.com node --env-file=/Users/gallivan/Code/WMKF_Apps/.env.local scripts/rehearse-test-request-sandbox.mjs:*)"`

When configuring another machine, adjust only the `--env-file` path. Keep the
sandbox hostname pinned, the command limited to this script, and run it from the
repository root so the relative `scripts/` path resolves. Never widen the rule.
Inspect the local permissions entry before relying on it; last checked on the
owner's Mac on 2026-10-05, so current presence is UNKNOWN. This permission is a
Claude Code prompt rule, not an application safety control.

The CLI rejects `--bypass-goverify` for production and allows it only with
`--execute` or `--advance` [verified in source:
`scripts/rehearse-test-request-sandbox.mjs`]. In S537 the owner verified the rule with the sandbox ledger-driven
`--reserve`, `--advance`, and `--advance --bypass-goverify` path (Request 1000341).
The GoVerify deactivation, create, and restoration path was separately proven on
Requests 1000338–1000340. These are historical rehearsal records, not current
system state. Production permissions and target interlocks remain governed by
`CLAUDE.md`. See [[project-test-request-factory]] and
`docs/plans/TEST_REQUEST_FACTORY_DESIGN_2026-09-19.md`.
