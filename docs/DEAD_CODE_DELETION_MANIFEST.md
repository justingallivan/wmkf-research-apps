---
title: Dead-Code Deletion Manifest (S322 sweep)
domain: repo-hygiene
kind: audit
status: active
summary: SAFE dead-code bucket applied 2026-07-03; owner-confirmation deletion candidates remain parked for explicit approval.
---

# Dead-Code Deletion Manifest

- **Date:** 2026-07-03 (Session 322)
- **Evidence anchor:** repo state at commit `7d3be6a1`. All "last commit referencing" claims and grep results are snapshots as of that commit — **re-run caller checks at execution time before deleting anything** (CLAUDE.md rule 2, destructive carryover).
- **Method:** four parallel read-only scans (dead exports, page/route reachability, feature flags, scripts/config) over `lib/ shared/ pages/ tests/ scripts/` plus root config. Every export-level SAFE claim was additionally re-verified in the S322 main session with repo-wide word-boundary greps (including `.mjs`/`.json`) after one scan false positive was caught (see Keep).
- **Evidence labels:** [VERIFIED session-grep] = re-checked directly in the S322 main session; [VERIFIED scan] = confirmed by the S322 read-only scan agents (grep + git evidence in their reports) but not independently re-run in the main session.
- **Status:** SAFE bucket applied 2026-07-03 after live caller checks. The owner-confirmation bucket below remains read-only until explicitly approved.

## APPLIED — SAFE bucket deleted 2026-07-03

After the mandated live caller checks were re-run, the zero-reference SAFE cluster
was removed: two orphan helper files, the dead exported symbols, the unsupported
`MOCK_MODE` environment computation, and 20 one-off probe/fix scripts. Active docs,
the BILL option-set probe/test, and `.env.example` were reconciled so the deleted
symbols and unsupported env variable no longer appear as live contracts.

## NEEDS-OWNER-CONFIRMATION

| Candidate | Evidence / why not safe |
|---|---|
| `pages/api/integrity-screener/dismiss.js`, `pages/api/integrity-screener/history.js` | Built 2026-05, never wired to any UI (`git log -S`: only ever referenced by `docs/API_ROUTE_SECURITY_MATRIX.md` since `ad8f4f3d` 2026-05-04; last touch `dbc50601` 2026-06-06) [VERIFIED scan]. POST/GET surface — confirm no external caller and no near-term UI plan |
| `pages/api/api-capabilities.js` | Its consumer (web-discovery feature) deleted in `502154d8` 2026-06-06; zero client callers remain [VERIFIED scan]. GET metadata endpoint — confirm nothing external polls it |
| `shared/config/d26Allowlist.js` + `scripts/backfill-d26-triage.mjs` + `scripts/probe-triage-filter.mjs` | Retire-together cluster: the config's only consumers are these two one-off triage scripts [VERIFIED session-grep]; retirement commits `832ed5c8`/`e6267553` 2026-06-15 say "triage fully shipped". Confirm the backfill won't be re-run |
| `DYNAMICS_IMPERSONATION_ENABLED` off-branch (`lib/services/dynamics-service.js:164,1355`) | `true` in prod since the S127-129 rollout (last ref `d3ed821b` 2026-06-28; prod value per `docs/GRANTEE_DELIVERABLE_PACKAGE_MIGRATION_PLAN.md:63`) [VERIFIED scan]; off-branch now serves only preview/dev envs lacking the Delegate-role grant — owner call whether that fallback is still needed |
| `NEXT_PUBLIC_PHASE_I_DYNAMICS_PRIVATE_BLOB`, `NEXT_PUBLIC_GRANT_REPORTING_PRIVATE_BLOB`, `NEXT_PUBLIC_EXPENSE_REPORTER_PRIVATE_BLOB` off-branches | Permanent cutover, `true` in prod since `f17fa3b7` 2026-06-11 per `docs/CREDENTIALS_RUNBOOK.md:229` [VERIFIED scan]; `public` branch is documented pre-migration legacy retained as fail-closed fallback where the token is unset. Hardcoding private removes a rollback lever — owner call |
| `evaluateCrossFieldNamesakeGuard` in `lib/services/discovery-service.js` | Pre-registered in `.claude-memory/project-deferred-code-cleanup.md` (S236) [VERIFIED via that file, read this session]: inert since field-aware routing; its retire-when precondition (re-confirm no input reaches the PubMed path and triggers the guard) must be re-run live first |
| `shared/config/prompts/common.js` exports (`PROMPT_PREFIXES`, `FORMATTING_INSTRUCTIONS`, `SYSTEM_INSTRUCTIONS`) | Imported only by their own unit test [VERIFIED scan] — test-only fixture pattern; confirm no planned reuse |
| `FileProcessor` class export in `shared/api/handlers/fileProcessor.js` | Class is live (constructed by `createFileProcessor` at `:192`) [VERIFIED session-grep] — only the `export` keyword is unused. Cosmetic de-export, not a deletion |
| 27 weaker zero-reference scripts [VERIFIED scan] | `backfill-j26-stuck-invites-no-response.js`, `cleanup-reviewer-name-whitespace.js`, `dryrun-reviewer-email-reconcile.mjs`, `export-program-area-research.js`, `find-orphan-reviewers.mjs`, `find-program-area-field.js`, `find-research-test-cases.js`, `lookup-program-area.js`, `probe-akoya-codex-followups-s158.js`, `probe-app-user-roles.js`, `probe-existing-reviewer-templates.mjs`, `probe-grant-cycle-schema.js`, `probe-memory-audit-verify.js`, `probe-orcid-live.js`, `probe-orphaned-email-incidence.mjs`, `probe-picklist-suggestion.js`, `probe-potentialreviewer-by-id.js`, `probe-potentialreviewer-email-dups-audit.js`, `probe-potentialreviewer-email-dups.js`, `probe-reviewer-legacy-grants.js`, `probe-roster-has-dataverse-empty.mjs`, `probe-stuck-invites-by-cycle.js`, `probe-w4-suggestion-lookup.js`, `smoke-grant-cycles-dataverse.js`, `smoke-identity-resolver-verdict.js`, `test-dataverse-app-access-and-settings.js`, `test-multi-picklist-query.js` — unreferenced but less clearly one-shot; batch owner review |

## KEEP — checked and alive (including near-misses)

- **`lib/seed/email-defaults/reviewer-reminders.js`** — scan flagged it dead; **false positive**, statically imported at `scripts/seed-email-defaults.mjs:23` [VERIFIED session-grep]. This miss is why the export list above was hand re-verified.
- Seed fixture files `lib/seed/email-defaults/reviewer-templates.js`, `grantee-reminder.js`, `grantee-invite.js` — imported by `scripts/seed-email-defaults.mjs` [VERIFIED session-grep] and by tests [VERIFIED scan].
- All feature flags except `MOCK_MODE` [VERIFIED scan, flag-by-flag with read sites]: `BILL_ENABLED`, `BILL_ONBOARDING_DEFERRED` / `HONORARIUM_ONBOARDING_DEFERRED` (live short-circuits, `9724a960` 2026-07-02), `VIRUS_SCAN_ENABLED` (pending rollout — off IS the live prod state), `AUTH_REQUIRED` / `EMERGENCY_AUTH_BYPASS` (monitored emergency kill-switch), `REVIEWER_PAGE_EMAIL_TIER_ENABLED` (enabled in prod 2026-07-03; off-branch is deliberate rollback capability), `DEBUG_REVIEWER_FINDER` and dev/test/ops toggles (`PROMPT_RESOLVER_STRICT`, `BILL_WEBHOOK_DEBUG`, `REAL_COI_TEST`, `ALLOW_POPULATED_DATABASE_SETUP`, `PR4_E2E_CONFIRM_PROD_DATAVERSE`).
- External-service clients (arxiv, biorxiv, chemrxiv, openalex, pubmed, orcid, serp-contact, perplexity, claude-reviewer, integrity, integrity-matching, literature-search) — 8+ live call sites each [VERIFIED scan]; every `lib/utils/tracked-secrets.js` entry maps to an active service and the file's `tier: 'forward'` list is empty [VERIFIED scan].
- UI pages and API routes: repo has 27 non-API page files and 138 API route files (`find`, this session); 16 `vercel.json` crons [VERIFIED session count]. The reachability scan confirmed live in-repo callers for all pages and all API routes except the 3 listed above [VERIFIED scan; scan reported 26 pages/~130 routes, so up to 1 page file and a handful of route files fall outside its enumeration — re-check coverage at execution time].
- Operational keepers: `scripts/setup-database.js`, `scripts/apply-migrations.js`, all `check-*` gate scripts, `scripts/probe-no-email-breakdown.mjs`, `scripts/probe-institution-coi-breakdown.mjs` (SESSION_PROMPT measure-later items).

## Execution protocol (when a deletion pass is approved)

1. Re-run the caller check for each entry live (grep + read likely callers) — this manifest is evidence as of `7d3be6a1` only.
2. Delete in small, per-cluster commits (exports / files / scripts / routes separately); run the relevant gates (`check:doc-symbol-refs`, `check:api-routes`, full test suite) after each.
3. Routes and flags require the owner decisions recorded above before touching.
