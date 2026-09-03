---
name: project-vercel-node22-no-require-esm
description: Vercel's 22.x function runtime cannot require() ESM (older than 22.12); sanitize-html >= 2.17.6 (htmlparser2 12, ESM-only) broke production on 2026-09-01. Fixed forward by bundling via transpilePackages (PR #144); any ESM-only server dep must be bundled, not externalized.
status: active
metadata:
  type: project
---

## Recall Rule

Read this when upgrading an ESM-only dependency imported by server code,
debugging a Vercel-only module-load failure, or changing Next.js dependency
externalization/bundling.

Vercel's production Node "22.x" runtime for wmkf_research_apps does NOT support
unflagged `require()` of ES modules (it is older than 22.12) as of 2026-09-01.
Local Node 26 and CI on Node 22 (actions/setup-node resolves a newer 22) both
pass, so neither reproduces it. Next externalizes `sanitize-html` in the server
build (`require("sanitize-html")` in the Turbopack chunks), so the runtime does
a real `require()` of htmlparser2.

**Incident (2026-09-01, PR #142):** bumping sanitize-html 2.17.5 -> 2.17.7 for
CVE-2026-84371 deployed green (build, Jest, Vercel deploy all passed) and then
500'd every route importing sanitize-html at module load with `ERR_REQUIRE_ESM`
on `htmlparser2/dist/index.js`. Reverted on main (`9a59297a`). `vercel rollback`
was blocked by the auto-mode classifier; a git revert push took about four
minutes.

**Why:** sanitize-html 2.17.6+ moved to htmlparser2 12 (ESM-only) and declares
`node >= 22.12`. Dependabot's alert range (<= 2.17.6) has no CJS-compatible
fixed release. The existing memory [[project-jsdom-serverless-esm-incompat]]
already recorded that Vercel's runtime can't require(esm); "project says 22.x"
was not sufficient evidence to override it.

**Resolution (2026-09-02, PR #144, merged `39413e3d`):** `transpilePackages` in
`next.config.js` lists sanitize-html + htmlparser2/domhandler/domutils/
dom-serializer/domelementtype/entities, so both bundlers inline them into the
server chunks and no runtime require(esm) occurs. The webpack builder (used by
Playwright e2e via `next build --webpack`) additionally needs
`experimental.esmExternals: 'loose'`, which Turbopack panics on, so it is
spread in only when `process.env.TURBOPACK` is unset. sanitize-html is now
2.17.7. Production probe after deploy: draft route 401 with app JSON.

**How to apply:**
- Any ESM-only dependency reached from server code must be added to
  `transpilePackages` (bundled), never externalized. Before merging, verify
  `grep -rl 'require("<pkg>")' .next/server` is empty and the built route
  loads under `node --no-experimental-require-module`, then probe a preview.
  Unauthenticated probe: `GET /api/external/review/<bogus>/draft` returns 401
  when the module loads and 500 on `ERR_REQUIRE_ESM`.
- A Vercel deploy "completed" plus green CI is not a runtime check for
  externalized dependencies. See
  [[feedback-deployment-monitoring-use-inspect]].
