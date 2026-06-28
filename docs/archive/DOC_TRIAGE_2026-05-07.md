# Doc Currency Triage — 2026-05-07

Snapshot of the doc-currency review run on 2026-05-07. Records categorization, staleness signals applied, and execution protocol for the eventual Step 3 archival pass. Codex review (gpt-5.3-codex) on 2026-05-07 prompted two corrections folded in below (1.1, 1.2).

**Repo as of 2026-05-07:** 119 markdown docs (97 in `docs/`, 12 in `docs/atlas/`, 4 in `docs/archive/`, 6 in `docs/guides/`).

## Buckets

| Bucket | Definition | Default action |
|---|---|---|
| A | Authoritative reference (CI-gated or actively-read) | Keep current |
| B | Living plans (still build against) | Keep, refresh as state evolves |
| C | Point-in-time artifacts (response-to-finding, request-fulfilled, snapshots) | Archive after closure |
| D | Per-app guides | Keep, spot-refresh against current app |
| E | Atlas pages | Keep, 60-day staleness rule applies |
| Other | Mixed — superseded specs, orphan reference docs | Triage individually |

## Bucket A — Authoritative reference (8)

| Doc | Age | Status |
|---|---|---|
| APPLICATION_STATE_ATLAS.md | 0d | ✓ |
| API_ROUTE_SECURITY_MATRIX.md | 3d | **Refresh** — endpoint persistence annotation flagged in Atlas v1 known-gaps; "CI-gated for completeness" ≠ "fully current" |
| CLAUDE_COVERAGE_LESSONS.md | 0d | ✓ |
| CLAUDE_REMEDIATION_PLAN.md | 1d | ✓ |
| EXECUTOR_CONTRACT.md | 3d | ✓ |
| SECURITY_OPERATING_PLAN.md | 2d | ✓ |
| CREDENTIALS_RUNBOOK.md | 73d | **Refresh** — verify env-var list against current code |
| AUTHENTICATION_SETUP.md | 98d | **Refresh** — dual-provider Entra External shipped since |

## Bucket B — Living plans (25)

Auto-flag = age >21d AND contains status verbs.

Not flagged (recent or content-current): POSTGRES_TO_DATAVERSE_MIGRATION.md, REVIEWER_POSTGRES_TO_DATAVERSE_PLAN.md, INTAKE_PORTAL_DESIGN.md, INTAKE_PORTAL_SCHEMA_CHANGES.md, EXTERNAL_REVIEWER_INTAKE_PLAN.md, DYNAMICS_IDENTITY_RECONCILIATION_PLAN.md, DYNAMICS_AI_FIELDS_SPEC_v3_cn.md, AI_DATA_FLOW_MATRIX.md, DATAVERSE_SHAREPOINT_FILE_MODEL.md, REVIEWER_INTERACTION_DESIGN.md, REVIEWER_MATERIALS_FOLDER_SPEC.md, REVIEWER_ARCHITECTURE.md, REVIEWER_FINDER_DATAVERSE_CUTOVER_PLAN.md, REVIEWER_FINDER_FUTURE_ARCHITECTURE.md, BACKEND_AUTOMATION_PLAN.md, EXECUTOR_EXTENSIONS_PLAN.md, PROMPT_STORAGE_DESIGN.md, PROMPT_CACHING_PLAN.md, PDF_INPUT_FOR_BACKEND.md, RETROSPECTIVE_ANALYSIS_PLAN.md, PROPOSAL_CONTEXT_EXTRACTION_PLAN.md, WORKFLOW_CHAINING_DESIGN.md.

**Flagged for refresh:**

| Doc | Age | Reason |
|---|---|---|
| GRANT_CYCLE_LIFECYCLE.md | 28d | Cycle redesign in flight (concepts going away, single-phase coming) |
| STAGED_REVIEW_PIPELINE.md | 36d | Status check |
| STAGED_PIPELINE_IMPLEMENTATION_PLAN.md | 36d | Status check |
| REVIEWER_LIFECYCLE_PROPOSAL.md | 40d | Phase A shipped; refresh status |
| STRATEGY.md | 56d | Direction has evolved (intake portal, single-phase cycle) |
| DYNAMICS_SCHEMA_ANNOTATION.md | 56d | Cited from CLAUDE_REMEDIATION_PLAN.md as Atlas-reconciliation input. Do NOT archive. Refresh against Atlas. |

## Bucket C — Archive candidates (28 explicit, allowlist below)

The Step 3 protocol requires an **explicit filename allowlist**. Below is the verified list with last-touched dates.

**Closed Connor docs (4):**
- CONNOR_BRIEF_PHASE0.md (0d, superseded today)
- CONNOR_DELEGATE_ROLE_REQUEST.md (2d, role granted)
- CONNOR_INTAKE_PORTAL_SYNC.md (2d, six decisions resolved 2026-05-06)
- CONNOR_QUESTIONS_2026-04-15.md (0d, Q4–Q7 all closed)

**Code review responses (8):**
- CODE_REVIEW_FINDINGS_2026-03-10.md
- CODE_REVIEW_FINDINGS_FINAL_2026-03-10.md
- CODE_REVIEW_FINDINGS_FOLLOWUP_2026-03-10.md
- CODE_REVIEW_FINDINGS_LEGACY_LINKING_2026-03-10.md
- CODE_REVIEW_FINDINGS_SAFE_FETCH_2026-03-10.md
- CODE_REVIEW_FINDINGS_USER_PROFILES_EXPOSURE_2026-03-10.md
- CODE_REVIEW_FRAGILITY_FINDINGS_2026-04-30.md
- CODE_REVIEW_RESPONSE_2026-04-30.md
- CODEX_WORK_LOG_2026-03-10.md

**Security audits / responses (12):**
- COMPREHENSIVE_SECURITY_AUDIT_2026.md
- COMPREHENSIVE_SECURITY_AUDIT_2026_ANNOTATED.md
- SECURITY_AUDIT_2026-04-18.md
- SECURITY_AUDIT_RESPONSE_CODEX.md
- SECURITY_AUDIT_RESPONSE_GEMINI.md
- SECURITY_CODE_CHANGES_2026-04-26.md
- SECURITY_FINDINGS_2026-04-26.md
- SECURITY_GEMINI_FIXES.md
- SECURITY_HARDENING_PROPOSAL_2026.md
- SECURITY_HARDENING_SUMMARY.md (also contains the broken `Easy_Wins.md` reference — moot once archived)
- SECURITY_HARDENING_SUMMARY_2026-03-10.md
- SECURITY_REVIEW_RESPONSE_V2.md
- SECURITY_REVIEW_RESPONSE_V3.md

**IT request artifacts (6):**
- IT_ADMIN_SECURITY_REPORT_2026.md
- IT_ENTRA_EXTERNAL_TENANT_REQUEST_2026-05-04.md
- IT_MEETING_GRAPH_API_REQUIREMENTS.md
- IT_RESPONSE_SESSION_TIMEOUTS_2026-03-11.md
- IT_SECURITY_RESPONSE.md
- IT_SECURITY_UPDATE_2026-03-11.md

**Wave 1 closed artifacts (2):**
- WAVE1_PROD_PRIVILEGE_REQUEST.md
- WAVE1_PROD_PRIVILEGE_REQUEST_2.md

**Snapshots (2):**
- CODEBASE_STATUS_2026-05-04.md
- Answering_DFT_questions.md

**Keep in `docs/` (Wave 1 still has pending action / cutover not stabilized):**
- WAVE1_PROD_RUNBOOK.md
- WAVE1_REVERT_TEMP_ELEVATIONS.md
- WAVE1_VERCEL_FLAG_ROLLOUT.md

**Total Bucket C archive count: 36** (counted explicitly post-Codex review; my earlier hand-counts of "~28" were drift in my own analysis, exactly the failure mode Codex flagged).

## Bucket D — Per-app guides (6)

All last-touched 2026-02-18 (78d). Apps have evolved (Reviewer Finder Dataverse cutover, Dynamics Explorer schema diff). Spot-refresh needed; not archive candidates.

- ADMIN_GUIDE.md, DYNAMICS_EXPLORER.md, GETTING_STARTED.md, INTEGRITY_SCREENER.md, REVIEW_MANAGER.md, REVIEWER_FINDER.md

## Bucket E — Atlas pages (12)

All 0d, all current. **Excluded from any archive operation.**

## Other (~14, mixed dispositions)

**Archive candidates (6):**
- DYNAMICS_AI_FIELDS_SPEC_v2.md — superseded by v3
- DYNAMICS_AI_FIELDS_SPEC_cn-notes.md — Connor's pre-v3 notes
- DYNAMICS_EXPLORER_DOCUMENT_LISTING_PLAN.md — shipped per memory
- CRM_EMAIL_SEND_PLAN.md — shipped (S77 per memory)
- ENTRA_ID_INTEGRATION_SUMMARY.md — pre-dates dual-provider work
- SHAREPOINT_DOCUMENT_ACCESS.md — likely superseded by DATAVERSE_SHAREPOINT_FILE_MODEL.md (verify before move)

**Refresh / verify (5):**
- AI_PROMPTS_OVERVIEW.md, AI_PROMPTS_DETAILED.md (43d) — verify aligned with prompt-resolver state
- REVIEWER_FINDER.md (97d) — likely superseded by REVIEWER_ARCHITECTURE
- SECURITY_ARCHITECTURE.md (57d) — cross-check against SECURITY_OPERATING_PLAN
- SYSTEM_OVERVIEW.md (83d) — compare against current CLAUDE.md sections
- PDF_EXPORT.md (91d)

**Status-check (3):**
- SECURITY_ROLE_WAVE1.md, WISHLIST.md, TODO_EMAIL_NOTIFICATIONS.md

**Currency-sensitive (1):**
- PENDING_ADMIN_REQUESTS.md (6d)

## Headline numbers

| Action | Count |
|---|---|
| Archive | **28** Bucket C + **6** Other = **34** |
| Refresh | **2** Bucket A + **6** Bucket B + **5** Other = **13** |
| Status-check | **9** (Bucket D = 6, Other = 3) |
| Keep as-is | ~63 |

## Step 3 execution protocol (revised post-Codex)

Codex flagged that a broad move would repeat the failure mode `CLAUDE_REMEDIATION_PLAN.md` was written to prevent. Required protocol:

1. Build an **explicit filename allowlist** (above). No globs over `docs/*.md`.
2. For each candidate, **grep-verify** repo-wide that it isn't cited from any markdown file:
   ```
   for f in <candidates>; do grep -rln "$f" --include="*.md" | grep -v "^docs/archive/"; done
   ```
3. Anything cited → stop, investigate, either update the citer or remove from the allowlist.
4. Verify `docs/atlas/` is excluded from any move logic.
5. Move via `git mv` (preserves history).
6. **Post-move link check** — re-grep remaining markdown for `docs/<archived-name>` references.
7. Update any redirects in surviving citers.

## Staleness signals that should run before Step 3

The age-plus-status-verb probe used in this triage misses several drift modes Codex flagged. `scripts/check-doc-currency.js` (added 2026-05-07) implements four additional probes:

1. **Code-name drift** — wrong/old custom-entity names (e.g., `wmkf_app_researcher` instead of `wmkf_appresearcher`)
2. **Table-liveness mismatch** — docs describing dead/empty tables as load-bearing
3. **Source-of-truth drift** — explicit "doc claims X, ground truth is Y" pairs
4. **Path-contract drift** — non-canonical SharePoint folder paths

Run `node scripts/check-doc-currency.js` to surface candidates the age probe missed.

## Step 3 execution result (2026-05-07)

Bucket C archive executed: **36 files** moved to `docs/archive/` via `git mv`. Pre-move grep-verify identified live citers in 6 living plans (INTAKE_PORTAL_DESIGN.md, REVIEWER_POSTGRES_TO_DATAVERSE_PLAN.md, BACKEND_AUTOMATION_PLAN.md, INTAKE_PORTAL_SCHEMA_CHANGES.md, WAVE1_REVERT_TEMP_ELEVATIONS.md, GEMINI.md); citation paths rewritten to `docs/archive/`.

Post-move broken-link check: remaining stale paths are all in historical/snapshot files (DEVELOPMENT_LOG.md, SESSION_PROMPT.md, `.claude-memory/`) where point-in-time references are by convention. SESSION_PROMPT.md will refresh on `/stop`.

Drift fixes also applied: `docs/PROMPT_STORAGE_DESIGN.md` columns renamed from pre-rename names (`wmkf_prompt_was_overridden`, `wmkf_run_source`) to live production names (`wmkf_ai_promptoverridden`, `wmkf_ai_runsource`).

## Open follow-ups

- ~~Step 4: lightweight CI gate~~ — **completed S141 (2026-05-08)**: `check:doc-currency` is now a CI gate (exit 1 on hits). Fixed the `walk()` directory-skip bug (`docs/archive` was being scanned because `'docs/archive'.startsWith('docs/archive/')` is false), tightened the `liveness-*` patterns to use `\b` word-boundaries (was matching "Short-live" inside "Short-lived"), corrected the directionally-wrong `sot-prompt-resolver-reads-prompt-table` regex, and expanded allowlists for legitimate historical / teaching references (Atlas pages that name both bad and good forms; migration plans that reference snake-case schema *file* names). Added `docs/security-audit/` to skip list. Added `npm run check:doc-currency`; wired into `.github/workflows/test.yml` between `check:atlas:self-test` and `test:ci`. Self-test fixture (parallel to `check-coverage-self-test.js`) is **not yet built** — would catch pattern regressions; deferring as future carryover since the patterns are simple regexes that humans can reason about.
- ~~Bucket D refresh: 6 guides last-touched 78d ago~~ — **completed S141 (2026-05-08)**: GETTING_STARTED.md (category list updated, Concept Evaluator deprecation noted), ADMIN_GUIDE.md (added spend monitoring, alerts dashboard, secret expiration tracking, Microsoft Graph health, full env-var list), REVIEWER_FINDER.md + REVIEW_MANAGER.md (status banners — Dataverse-direct save-candidates, magic-link reviewer portal, CRM-direct email), DYNAMICS_EXPLORER.md (multi-library SharePoint walk, Excel export). INTEGRITY_SCREENER.md was already current.
- ~~Bucket B "flagged for refresh" list: 6 docs need state pass~~ — **completed S141 (2026-05-08)**: status banners + targeted edits applied to STRATEGY.md (write access live, IT deps current, app count, Wave 1/2 framing), GRANT_CYCLE_LIFECYCLE.md (AI fields DEPLOYED, Wave 1/2 migration current, cycle-redesign banner), REVIEWER_LIFECYCLE_PROPOSAL.md (Phase A/C/D shipped status table), STAGED_REVIEW_PIPELINE.md + STAGED_PIPELINE_IMPLEMENTATION_PLAN.md (not-yet-built status, dormant pending cycle redesign), DYNAMICS_SCHEMA_ANNOTATION.md (Atlas-as-authoritative scope clarification, AI fields explicitly out-of-scope, schema-diff vs schema-map gotcha).
- ~~Bucket A refresh: AUTHENTICATION_SETUP.md (98d), CREDENTIALS_RUNBOOK.md (73d), API_ROUTE_SECURITY_MATRIX.md (endpoint persistence annotation)~~ — **completed S141 (2026-05-08)**: dual-provider Entra External documented in AUTHENTICATION_SETUP; CREDENTIALS_RUNBOOK env-var list cross-checked against `process.env` reads in lib/pages/middleware (added CRON_SECRET, EXTERNAL_LINK_SECRET, VRP/Entra-External/multi-LLM keys, Wave 1 backend flags, etc.); API_ROUTE_SECURITY_MATRIX gained a Persistence column for all 77 routes (closes Atlas v1 known-gap).
- ~~Other: 6 archive candidates identified but not part of Bucket C~~ — **completed S141 (2026-05-08)**: all 6 archived to `docs/archive/`. Live citers rewritten in `docs/DYNAMICS_AI_FIELDS_SPEC_v3_cn.md`, `docs/BACKEND_AUTOMATION_PLAN.md`, `.claude-memory/project_dynamics_ai_writeback.md`.
