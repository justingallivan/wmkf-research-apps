---
name: project-ci-npm10-lockfile-parity
description: "CI installs with Node 22 / npm 10, owner Macs run npm 11; a lock file npm 11 accepts can fail CI's `npm ci`. Check with npm@10 before pushing dependency changes."
metadata:
  node_type: memory
  type: project
  status: active
  last_verified: 2026-10-11
  originSessionId: 8f8f764b-8031-4308-865d-5673ac27cf3e
  modified: 2026-10-11T20:28:05.405Z
---

## Recall Rule
Read before committing any `package.json` or `package-lock.json` change.

CI (`.github/workflows/test.yml`, `e2e.yml`) uses `node-version: 22`, which ships npm 10. Owner
Macs run Node 26 / npm 11. On 2026-10-11 a lock written by npm 11 (`0aca28b9e`, `@vercel/sandbox`
3.4.0) omitted nested `workflow/node_modules/chokidar@5` and `readdirp@5`; npm 11 accepted it,
npm 10 `npm ci` refused ("Missing: ... from lock file"), and Tests + E2E failed on every `main`
push for a day (fixed in PR #472).

**Why:** the two npm versions disagree on which nested optional peers a lock must record.

**How to apply:** after a dependency change, copy `package.json` + `package-lock.json` to a scratch
dir and run `npx -y npm@10 ci --dry-run --ignore-scripts`. If it fails, add only the missing
entries npm 10 resolves (do not take npm 10's whole regenerated lock: it strips npm 11's `libc`
metadata and churns). Confirm `npx -y npm@11 install --package-lock-only` then leaves the file
unchanged.
