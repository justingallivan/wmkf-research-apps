---
name: project-private-repo-ci-visibility
description: Why CodeQL was removed and Semgrep broadened after the repo went private; branch protection needs GitHub Pro
metadata: 
  node_type: memory
  type: project
  originSessionId: 6fc5f954-97c9-44ce-9593-d2aa5dce023e
---

Repo `justingallivan/wmkf-research-apps` is PRIVATE on a personal (non-org) account. Going private (done ~2026-06 for a security scare that turned out to be a spam bot) did NOT break Dependabot (still opening PRs, free on private) or Actions minutes (2,000/mo free, not currently capped). It broke exactly one check: **CodeQL**.

Two reasons CodeQL failed on the private repo, both verified 2026-07-03/04:
1. `codeql.yml` had a `permissions:` block listing only `security-events: write`, so `contents` defaulted to `none` → checkout got a 404 on the now-private repo (public repos clone without that scope). `security-scan.yml` passes because it declares `contents: read`.
2. Code scanning on private repos requires a **GitHub Code Security license** (org/enterprise; NOT included in personal Free/Pro). GitHub Pro ($4/mo) would NOT re-enable it.

Decision (commits 180e9046, 198fbd97 on main): **removed `codeql.yml`**, replaced its SAST role by broadening `security-scan.yml`. The old `returntocorp/semgrep-action@v1` silently ignored its `config:` input and ran only `SEMGREP_RULES=.semgrep` — a no-op for registry packs. New job uses the `semgrep/semgrep` container + `semgrep scan` directly: token-audit rules **blocking** (`--error`, unchanged gate, 0 findings), plus `p/owasp-top-ten p/nextjs p/react` **advisory** (`|| true`, ~19 findings, non-blocking to avoid a red wall). Dropped `p/default`/`p/javascript` — they add ~235 noisy path-traversal/format-string warnings.

**Open follow-ups:** (a) triage the ~19 advisory findings and promote the packs to blocking; 18 are `github-actions-mutable-action-tag` (pin actions to SHA), the notable real one is `react-dangerouslysetinnerhtml` at `pages/external/grantee/[token].js:116` (possible XSS on a public token page). (b) **Branch protection / required status checks also require GitHub Pro on a private personal repo** — this is the one thing paying for Pro actually buys here. See [[feedback-verify-external-platform-claims]].
