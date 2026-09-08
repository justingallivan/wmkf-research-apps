---
name: reference-vercel-logs-filtering
description: How to find a specific production request or error in Vercel runtime logs without the log-drain webhook noise swamping the CLI limit
metadata:
  type: reference
  status: active
  scope: dev-environment
  last_verified: S498 via vercel logs --status-code/--level/--query pulls, 2026-09-08
---

`vercel logs` (CLI 59.x) accepts server-side filters: `--query "<text>"` (matches
path and message), `--status-code 500` (or `4xx`), `--level error`, `--since`/`--until`,
and `--json`. Use them; an unfiltered `--limit 5000` pull is swamped by
`POST /api/webhooks/vercel-log-drain` rows and the three drain crons (hundreds per
minute), so a 5000-row window covers only seconds and the request you want is
usually outside it. A `--since` older than what the unfiltered limit can reach
silently returns the oldest rows in range rather than the ones you asked for.

Working shape (2026-09-08):

```
vercel logs --environment production --since 4h --status-code 500 --limit 200 --json
vercel logs --environment production --since 6h --level error --limit 500 --json
vercel logs --since 6h --query "close-review" --limit 300 --json
```

Each JSON line carries `timestamp` (epoch ms), `requestMethod`, `requestPath`,
`responseStatusCode`, `level`, `message`, and a `logs[]` array of the function's
console output. A `console.error` in an API route lands in `message` of the
error-level row for that request.

Also: a "production" failure with no matching Vercel row was a local `npm run start`
on port 3000 hitting the Dataverse write interlock (see
`docs/DATAVERSE_TARGET_WRITE_INTERLOCK_PLAN.md` and `docs/agent-wiki/topics/dev-environment.md`).
Check `lsof -nP -iTCP:3000 -sTCP:LISTEN` before assuming the request reached Vercel.
