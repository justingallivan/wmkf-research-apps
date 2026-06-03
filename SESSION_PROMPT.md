# Session 214 Prompt: Post-collapse — reviewer identity-resolution Phase 1 + carried follow-ons

## ⏰ Standing context / guardrails (carried S197–S213)
- **Falsification hook is LIVE** (`.claude/hooks/scope-claim-reminder.js`). Run the *disconfirming* query before asserting scope/quantity into docs/memory. Authoritative lint = `npx eslint . -f json` keyed on `ruleId`/`severity`, never grep over the default formatter.
- **⚠ Codex stop-time review gate is DISABLED** — it began failing on every (even no-op) turn mid-S213 (empty output, status 1; the shared Codex runtime got into a bad state, possibly after a console network-permission grant). Re-enable with `/codex:setup` (or `codex-companion.mjs setup --enable-review-gate`) once the runtime recovers; it's genuinely useful and caught real bugs all session.
- **Deliver Codex output VERBATIM** ([[feedback-share-codex-verbatim]]).
- **`main` auto-deploys to prod.** All S213 work is pushed (`bfc903d`→`fb0a3f4`).
- **CI-green ≠ correct for async/effect/UI/outward-facing code.** Manual smoke is mandatory ([[feedback-profile-context-runtime-bugs]]).
- **Local-dev auth bypass:** `AUTH_REQUIRED=false NEXTAUTH_SECRET=dev-throwaway NEXTAUTH_URL=http://localhost:3000 ./node_modules/.bin/next dev`. Local-dev and prod hit the SAME prod Dataverse — no isolated test store (a sandbox exists but is schema-stale; see [[project-dynamics-sandbox-state]]).
- **Ad-hoc prod-Dataverse probes/writes:** the `.env.local`-loading mjs pattern works; adapters need `bypassDynamicsRestrictions(...)`. Person entity logical name is `wmkf_potentialreviewers` (trailing s); the metadata `Attributes` endpoint 501s on `$filter startswith` (fetch all, filter in JS).

## Session 213 Summary

A very long session. Headline: the **`wmkf_appresearcher` bibliometric sidecar collapse — fully executed end-to-end on prod** (see DEVELOPMENT_LOG.md). Plus a Workbench remove-reviewer feature, smoke-helper hardening, a D26 testbed swap, several memory entries, and a Codex-authored reviewer-identity redesign plan.

### What was completed

1. **⭐ Appresearcher collapse — SHIPPED (Phases 1–6 + loose ends).** 17 bibliometric fields folded onto `wmkf_potentialreviewers`; 339 sidecars backfilled (verified exact); adapter + 5 callers + 7 affiliation readers repointed to the person; `wmkf_appresearcher` + `wmkf_apppublication` + `wmkf_apppublicationauthor` **DROPPED** (404); all canonical docs/memory reconciled; **zero runtime refs to the dropped entity remain**; all gates green. Affiliation canonical = `wmkf_primaryaffiliation` (500); `wmkf_organizationname` (100) kept as a clamped compat shadow. As-executed: `docs/APPRESEARCHER_COLLAPSE_PLAN_V2.md`. Snapshot: `scripts/.appresearcher-snapshot.jsonl` (gitignored).
2. **Workbench "Remove from this request"** (`ca95de5`, `e2a6b35`, `e9d5660`) — per-row remove on Candidates (✕) + Invite/Track/Completed (kebab), `canManage`-gated, reusing `my-candidates` DELETE → `softDelete(alsoRevokeToken:true)` (atomic link-revoke + `wmkf_selected=false`, never touching the global person/contact). `ReviewersTab.refreshAll` reloads both data sources. Codex-reviewed (BUG 1–4 + a standalone-Finder bug, all resolved).
3. **D26 smoke testbed swap** (`ced6470`) — replaced the real declined grant 1002826 with Connor's dedicated test request **1002788** ("Dec 2026 Project Title TEST 2"); allowlist + docs reconciled.
4. **Smoke-helper hardening** — partial-cleanup reporting (`6c41700`), firstname-marker fix (`48cb411`), default request → 1002788 (`bdfb014`), post-drop teardown fix.
5. **Reviewer identity-resolution plan** (`1a51e4f`) — Codex redesign for the persistent false-match problem (see Next Steps #1). Memory: contact DeleteAccess gap + sandbox state (`7a85c37`).

### Live data notes
- **Request 1002788** is the reviewer-testbed (smoke candidate cleaned up; Tsai/Madabhushi + applicant recs rev1–4 remain). **Tsai's person** (`257ba07a-…`) had wrong Scholar metrics (a lab member's) cleared S213.
- A Codex **deep-dive validation prompt** (docs/memory vs code + live Dataverse) was drafted to screen this session — re-run it in a fresh Codex session if you want an independent consistency audit.

## Potential Next Steps

### 1. ⭐ Reviewer identity-resolution — Phase 1 (the false-match fix)
`docs/REVIEWER_IDENTITY_RESOLUTION_PLAN.md`. Build the **Phase 1 quick wins**: a strict Scholar *displayed-name* guard in `SerpContactService.findScholarProfileViaGoogle` / `ContactEnrichmentService._attachScholarMetrics` (skip metrics on name mismatch — this catches the Tsai→Nakano lab-member case the institution-only guard can't); make `ORCIDService.findContact` score candidates instead of taking first-with-email; and **don't persist** Scholar/ORCID metrics in `save-candidates`/`enrich-recommended` without an identity-confidence status. **Data-governance:** also audit the already-persisted metrics on the ~330 enriched persons (some are wrong matches, like Tsai's was). Highest-value item.

### 2. Per-user SIGNATURE into the Workbench invite (carried S212–S213, small)
`pages/workbench/[requestId].js:~80` sets `settings.signature = session.profileName` (just the display name). Wire the real per-user signature (the `SENDER_INFO` pref, as `EmailSettingsPanel` does) so `{{signature}}` renders a full block.

### 3. Co-investigator COI parity in `discover.js` (carried S211)
`enrich-recommended` folds co-Is into the coauthor check; shared `discover.js` still checks PI only. Decide whether to fold co-Is there too (re-smoke).

### 4. Grant `reviewers` app access to pilot PDs + validate the dashboard tier (carried S211)
Via `/admin` → App Access; validate `/workbench` with a real PD login.

### 5. Intake virus-scan EICAR e2e — STILL parked pre-cycle must-do
[[project-intake-portal-virus-scan-e2e-deferred]]. Needs deployed env + Entra applicant session.

## Key Files Reference

| File | Purpose |
|------|---------|
| `docs/APPRESEARCHER_COLLAPSE_PLAN_V2.md` | As-executed record of the collapse (decisions, phases, ground truth) |
| `docs/REVIEWER_IDENTITY_RESOLUTION_PLAN.md` | Codex redesign plan for reviewer false-matches (Phase 1 = next step #1) |
| `lib/dataverse/adapters/researcher.js` | Now writes bibliometrics onto the person (post-collapse) |
| `lib/dataverse/adapters/potential-reviewer.js` | Affiliation → `wmkf_primaryaffiliation` (canonical) + `wmkf_organizationname` (compat shadow) |
| `shared/components/reviewers/{ReviewerManagePanel,CandidatesPanel,ReviewersTab}.js` | Remove-reviewer action + dual-source refresh |
| `scripts/{backfill-appresearcher-to-potentialreviewer,drop-appresearcher-entities}.mjs` | One-shot collapse scripts (done; kept for record/rollback) |

## Testing
```bash
npx jest tests/unit/reviewer                # 135 reviewer tests
npx eslint . -f json                        # 0 errors (warnings don't gate)
npm run check:atlas && npm run check:atlas:self-test && npm run check:fact-consistency && npm run check:doc-currency && npm run check:drain-table-mentions
./node_modules/.bin/next build
# Collapse already shipped — DO NOT re-run the backfill/drop scripts.
```
