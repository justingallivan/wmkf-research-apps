# Security Audit Runbook

Last updated: 2026-06-11

This runbook captures the current repeatable shape for security audits in this repo. Use it when running a broad security review, a quarterly security cadence check, or a focused follow-up on auth, data exposure, AI/model calls, file handling, Dynamics, Blob, SharePoint, or operational gates.

## Source Artifacts

Start from these repo-native precedents:

- `docs/security-audit/SECURITY_AUDIT_2026-05-21.md` for the concise security-audit report shape.
- `docs/THIRD_PARTY_LLM_AUDIT_PROMPT.md` for the full-repository audit prompt and deliverables.
- `docs/THIRD_PARTY_LLM_AUDIT_FOLLOWUP_PROMPT.md` for the correction pass after a first audit report.
- `docs/THIRD_PARTY_LLM_AUDIT_PRACTICE_IMPROVEMENT_PROMPT.md` for methodology guardrails learned from prior audit mistakes.
- `docs/SECURITY_OPERATING_PLAN.md` for the ongoing PR-time, weekly, monthly, and quarterly cadence.
- `docs/API_ROUTE_SECURITY_MATRIX.md` and `docs/AI_DATA_FLOW_MATRIX.md` as source-of-truth inventories.

## Audit Contract

The audit must be evidence-bounded. Every material claim should be labeled:

- `[VERIFIED]` with file paths, line references, or command output.
- `[INFERRED]` with the evidence chain.
- `[CONFLICT]` when docs and code disagree.
- `[UNVERIFIED]` when the claim could not be confirmed.
- `[NEEDS OWNER]` when a policy or risk-acceptance decision is required.
- `[RETRACTED]` in correction passes when a prior claim was wrong or stale.

Do not recommend destructive removal of files, routes, env vars, feature flags, tables, dependencies, or data until live callers, migration timing, backups, restore paths, docs, and gates have been verified.

## Baseline Commands

Run applicable gates sequentially. A gate and its self-test should not run in parallel.

```bash
npm run check:api-routes
npm run check:atlas
npm run check:atlas:self-test
npm run check:fact-consistency
npm audit --audit-level=high
```

If scanner tooling is installed, also run:

```bash
semgrep --config=.semgrep/token-audit.yaml --exclude='node_modules' --exclude='.next' lib/ pages/
semgrep --config=p/secrets --exclude='node_modules' --exclude='.next' .
semgrep --config=p/javascript --config=p/nodejs --config=p/owasp-top-ten --exclude='node_modules' --exclude='.next' lib/ pages/ shared/
gitleaks detect --source .
trivy fs .
```

If a command is blocked by local environment, record it as blocked with the exact blocker. Do not imply it passed.

## Required Review Surfaces

At minimum, review:

1. Auth and middleware: `middleware.js`, `lib/utils/auth.js`, `lib/utils/auth-policy.js`, `pages/api/auth/[...nextauth].js`.
2. API route authorization: `docs/API_ROUTE_SECURITY_MATRIX.md`, `scripts/check-api-route-security-matrix.js`, and any route changed since the last audit.
3. AI/data minimization: `docs/AI_DATA_FLOW_MATRIX.md`, `docs/EXECUTOR_CONTRACT.md`, `lib/services/llm-client.js`, `lib/services/execute-prompt.js`, payload-boundary utilities, and high-volume model call sites.
4. File and Blob handling: upload routes, download/proxy routes, private-token usage, SharePoint access, and any generic public upload path.
5. External/public token routes: HMAC/JWT verification, scope binding, revocation, expiry, upload/download limits, and rate-limit posture.
6. Dynamics restrictions and impersonation: `lib/services/dynamics-service.js`, `lib/services/dynamics-context.js`, route-level restriction callers, and any deprecated restriction shim usage.
7. Secrets and operational configuration: `docs/CREDENTIALS_RUNBOOK.md`, `lib/utils/tracked-secrets.js`, cron secrets, external-link secrets, auth bypass controls, and production fail-closed behavior.
8. Durable logging and audit trails: Dataverse/Postgres/Blob/SharePoint writes that may store sensitive content, model inputs, model outputs, or identity decisions.

## Report Shape

Use this structure for the primary report:

```markdown
# Security Audit - YYYY-MM-DD

## Scope

What was reviewed, which standards/guidance were used, and what was explicitly out of scope.

## Automated Checks

Commands run, results, and blockers.

## Findings

### P# - Title

Status: VERIFIED / INFERRED / CONFLICT / UNVERIFIED / NEEDS OWNER

Evidence:
- `path/to/file.js:123` - support

Risk category:
- OWASP / ASVS / repo-specific risk family

Recommendation:
- Specific repair or owner decision

Validation:
- Command, test, grep, browser smoke, or manual check that would prove closure

## Strong Controls Observed

Evidence-backed controls, not vibes.

## Recommended Next Steps

Prioritized sequence, grouped by immediate code/security work, owner decisions, docs/gates, and deferred watch items.
```

## Correction Pass

After the first report, run a correction pass using `docs/THIRD_PARTY_LLM_AUDIT_FOLLOWUP_PROMPT.md` as the model. The correction pass should:

- Re-open every cited line range.
- Re-run exact searches before any count claim.
- Distinguish route-matrix inventory coverage from semantic auth correctness.
- Mark architectural intent as `[NEEDS OWNER]` unless directly documented or proven by multiple implementation patterns.
- Avoid overcorrection: narrowing a finding is not the same as retracting it.
- Check that every finding ID referenced in the action plan exists.

For durable or cross-layer findings, distill the corrected result into a short actionable packet before implementation, following the shape of `docs/CORRECTED_AUDIT_FINDINGS_FOR_CLAUDE_REVIEW_2026_05_26.md`.
