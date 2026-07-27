---
name: project-private-repo-ci-visibility
description: Why CodeQL was removed and Semgrep broadened after the repo went private; branch protection needs GitHub Pro
metadata: 
  node_type: memory
  type: project
  status: active
  last_verified: 2026-07-27 via current security workflow; GitHub plan/licensing facts remain bounded to 2026-07-03/04
  originSessionId: 6fc5f954-97c9-44ce-9593-d2aa5dce023e
---

## Recall Rule

Read this when: changing security CI, CodeQL/Semgrep coverage, or required checks
for the private GitHub repository.

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

Ground truth: `.github/workflows/security-scan.yml` and dated GitHub checks from
2026-07-03/04. Current external capabilities require an official GitHub
plan/security-feature check.

**External-platform snapshot, 2026-07-03/04:** the repository was private on a
personal account; Dependabot and available Actions minutes still operated, while
CodeQL failed. Current plan capabilities, quotas, and repository visibility must
be rechecked through GitHub before relying on this snapshot.

Two reasons CodeQL failed on the private repo, both verified 2026-07-03/04:
1. `codeql.yml` had a `permissions:` block listing only `security-events: write`, so `contents` defaulted to `none` → checkout got a 404 on the now-private repo (public repos clone without that scope). `security-scan.yml` passes because it declares `contents: read`.
2. Code scanning on private repos requires a **GitHub Code Security license** (org/enterprise; NOT included in personal Free/Pro). GitHub Pro ($4/mo) would NOT re-enable it.

Decision (commits 180e9046, 198fbd97 on main): **removed `codeql.yml`**, replaced its SAST role by broadening `security-scan.yml`. The old `returntocorp/semgrep-action@v1` silently ignored its `config:` input and ran only `SEMGREP_RULES=.semgrep` — a no-op for registry packs. New job uses the `semgrep/semgrep` container + `semgrep scan` directly: token-audit rules **blocking** (`--error`, unchanged gate, 0 findings), plus `p/owasp-top-ten p/nextjs p/react` **advisory** (`|| true`, ~19 findings, non-blocking to avoid a red wall). Dropped `p/default`/`p/javascript` — they add ~235 noisy path-traversal/format-string warnings.

**Open follow-ups:** (a) triage the ~19 advisory findings and promote the packs to blocking; 18 are `github-actions-mutable-action-tag` (pin actions to SHA), the notable real one is `react-dangerouslysetinnerhtml` at `pages/external/grantee/[token].js:116` (possible XSS on a public token page). (b) **Branch protection / required status checks also require GitHub Pro on a private personal repo** — this is the one thing paying for Pro actually buys here. See [[feedback-verify-external-platform-claims]].
