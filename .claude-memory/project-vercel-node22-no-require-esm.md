---
name: project-vercel-node22-no-require-esm
description: Historical September 2026 deployed require(esm) failure and sanitizer bundling fix; retain the safeguard and verify actual runtime compatibility before changing dependency externalization.
status: active
metadata:
  type: project
---

## Recall Rule

Read this when upgrading an ESM-only dependency imported by server code,
debugging a Vercel-only module-load failure, or changing Next.js dependency
externalization/bundling.

Keep the existing sanitizer bundling safeguard unless a scoped change proves it
can be replaced safely. Check `next.config.js`, the actual dependency graph,
function trace and target runtime; a major-version label alone does not prove
module-load compatibility. This note does not identify today's hosted runtime.

## Historical incident and resolution — September 2026

The 2026-09-01 investigation attributed the deployed failure to a Node "22.x"
runtime unable to perform the required unflagged `require(esm)` operation. Local
Node 26 and that session's CI passed. The failing build externalized `sanitize-html`,
causing a runtime require of htmlparser2. These are incident observations, not
current platform-wide capability claims.

**Incident (2026-09-01, PR #142):** bumping sanitize-html 2.17.5 -> 2.17.7 for
CVE-2026-84371 deployed green (build, Jest, Vercel deploy all passed) and then
500'd every route importing sanitize-html at module load with `ERR_REQUIRE_ESM`
on `htmlparser2/dist/index.js`. Reverted on main (`9a59297a`). `vercel rollback`
was blocked by the auto-mode classifier; a git revert push took about four
minutes.

**Why:** sanitize-html 2.17.6+ moved to htmlparser2 12 (ESM-only) and declares
`node >= 22.12`. Dependabot's alert range (<= 2.17.6) has no CJS-compatible
fixed release. The existing memory [[project-jsdom-serverless-esm-incompat]]
already recorded a deployed require(esm) failure; "project says 22.x"
was not sufficient evidence to override it.

**Resolution (2026-09-02, PR #144, merged `39413e3d`):** `transpilePackages` in
`next.config.js` lists sanitize-html + htmlparser2/domhandler/domutils/
dom-serializer/domelementtype/entities, so both bundlers inline them into the
server chunks and no runtime require(esm) occurs. The optional webpack fallback builder additionally needs
`experimental.esmExternals: 'loose'`, which Turbopack panics on, so it is
spread in only when `process.env.TURBOPACK` is unset. The incident's resolved
sanitize-html version was 2.17.7, not a current version pin. Production probe
after that deploy: draft route 401 with app JSON.

**How to apply:**
- Preserve the established sanitizer-tree bundling policy. For a new server
  dependency, test its actual externalization/module-load behavior rather than
  imposing this incident's workaround on every ESM package.
- Inspect the relevant built trace and test the route under the intended runtime.
  The incident used a `node --no-experimental-require-module` check and an invalid-token
  draft request (401 after module load, 500 on the observed ESM failure). Recheck
  supported flags and route behavior before reusing those diagnostics; a grep of
  built chunks alone is not proof of runtime compatibility.
- A Vercel deploy "completed" plus green CI is not a runtime check for
  externalized dependencies. See
  [[feedback-deployment-monitoring-use-inspect]].
