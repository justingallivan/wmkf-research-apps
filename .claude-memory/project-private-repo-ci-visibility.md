---
name: project-private-repo-ci-visibility
description: Historical GitHub visibility/licensing and CI decisions from July–September 2026. Current repository visibility, plan, CodeQL setup, and alert state are unknown without a fresh GitHub check.
metadata: 
  node_type: memory
  type: project
  status: active
  last_verified: 2026-07-27 local workflow snapshot; external visibility/licensing facts are dated 2026-07-03/04 and 2026-09-20; current GitHub state unknown
  originSessionId: 6fc5f954-97c9-44ce-9593-d2aa5dce023e
---

## Recall Rule

Read this when: changing security CI, CodeQL/Semgrep coverage, or required checks
for this repository; do not assume its present visibility or plan from history.

Do:
- Treat the CodeQL/license and branch-protection statements as dated external
  platform evidence and verify GitHub's current plan capabilities before paying
  for or redesigning CI.
- Keep the custom token audit blocking; triage advisory Semgrep findings before
  promoting packs to blocking.

Do not:
- Re-add CodeQL solely by fixing checkout permissions; the 2026-07-04 license
  check was a separate blocker.
- Assume the advisory rule count or GitHub plan matrix is current.

Ground truth for the checked-in workflow is `.github/workflows/security-scan.yml`
(local source only). External visibility, plan/features, default CodeQL setup, scan
results, and alert state require a fresh authorized GitHub check; all such current
external state is UNKNOWN here.

**External-platform snapshot, 2026-07-03/04:** the repository was then private on a
personal account; Dependabot and available Actions minutes still operated, while
CodeQL failed. Current plan capabilities, quotas, and repository visibility must
be rechecked through GitHub before relying on this snapshot.

Two reasons CodeQL failed on the private repo, both verified 2026-07-03/04:
1. `codeql.yml` had a `permissions:` block listing only `security-events: write`, so `contents` defaulted to `none` → checkout got a 404 on the now-private repo (public repos clone without that scope). `security-scan.yml` passes because it declares `contents: read`.
2. Code scanning on private repos requires a **GitHub Code Security license** (org/enterprise; NOT included in personal Free/Pro). GitHub Pro ($4/mo) would NOT re-enable it.

Decision (commits 180e9046, 198fbd97 on main): **removed `codeql.yml`**, replaced its SAST role by broadening `security-scan.yml`. The old `returntocorp/semgrep-action@v1` silently ignored its `config:` input and ran only `SEMGREP_RULES=.semgrep` — a no-op for registry packs. New job uses the `semgrep/semgrep` container + `semgrep scan` directly: token-audit rules **blocking** (`--error`, unchanged gate, 0 findings), plus `p/owasp-top-ten p/nextjs p/react` **advisory** (`|| true`, ~19 findings, non-blocking to avoid a red wall). Dropped `p/default`/`p/javascript` — they add ~235 noisy path-traversal/format-string warnings.

**Follow-ups recorded in the July snapshot (historical, not a current alert inventory):** (a) triage the ~19 advisory findings and promote the packs to blocking; 18 are `github-actions-mutable-action-tag` (pin actions to SHA), the notable real one is `react-dangerouslysetinnerhtml` at `pages/external/grantee/[token].js:116` (possible XSS on a public token page). (b) **Branch protection / required status checks also require GitHub Pro on a private personal repo** — this is the one thing paying for Pro actually buys here. See [[feedback-verify-external-platform-claims]].

Those were the findings and proposed actions recorded then. Their current existence,
severity, disposition, and applicable GitHub plan remain UNKNOWN; this record does
not authorize changing security configuration or triaging/deleting scan history.

## Historical addendum (2026-09-20, S528): CodeQL re-enabled via default setup

At that time the repository was reported public (see the 2026-07-27 PII history audit), so
the owner chose to turn CodeQL back on ("1", 2026-09-20). Enabled through the
GitHub **default setup** API (`PATCH /code-scanning/default-setup`,
`state: configured`, default suite) — no workflow file; the deleted
`.github/workflows/codeql.yml` stays deleted and Semgrep in
`security-scan.yml` keeps running. The first analyses landed 2026-09-21 00:11Z:
javascript-typescript 118 results / 87 rules, actions 4 / 17, python 0 / 43.
Alerts reported open after that 2026-09-21 rescan: 145 (8 error-level, all `js/request-forgery` on
fetch helpers and token pages that build URLs from inputs by design —
`shared/utils/api-request.js:132`, `lib/utils/safe-fetch.js:79`,
`lib/services/graph/http.js:64`, `pages/api/blob-proxy.js:56`, the grantee
token page/form; triage is the owner's). The 2026-07 "private-repo blocked"
reasons above no longer apply; keep them as history.
Triage the same day: the five current-category `js/request-forgery` alerts
(#120 api-request helper, #119 grantee failure beacon, #118 Graph HTTP client
on the fixed GRAPH_BASE, #31 blob-proxy with host-pattern check, #28 safeFetch
allowlist) were dismissed as false positives with written reasons; the four
`actions/missing-workflow-permissions` findings were fixed by adding
least-privilege `permissions:` blocks (`825266b51`). At the time, the 89 analyses from the
deleted `codeql.yml` configuration (and the ~40 alerts pinned to that
category, e.g. #91/#92/#78) were not expected to auto-close because default setup
reports under a different category; deleting that configuration is an
owner UI action on the CodeQL tool-status page (the API deletion was blocked
for the agent as scan-history tampering).
