---
name: project-closed-work-archive
description: Index of closed/shipped work and point-in-time status snapshots moved OUT of the always-loaded MEMORY.md — recall when one of these subjects resurfaces.
metadata:
  type: reference
  status: closed
  scope: docs
  last_verified: 2026-07-26 via documentation truth audit
---

## Recall Rule

Read this when: a closed, shipped, or point-in-time subject resurfaces and you need to find the detailed topic file or design doc it was consolidated into.

Do:
- Use this as the consolidated pointer to closed-work topic files that no longer hold an always-loaded MEMORY.md slot.
- Pull the named topic file (or its design doc) when the subject actually comes up.
- Treat listed shipped features as authoritative-by-design-doc — don't rebuild them.

Do not:
- Expand this index into route/implementation detail — it's a pointer, not a spec.
- Assume a point-in-time snapshot here is current; live state lives in SESSION_PROMPT handoffs / the named topic files.

Ground truth: the linked topic files + design docs named per entry (e.g. `docs/POSTGRES_TO_DATAVERSE_MIGRATION.md`); historical-only consolidation.

These items are **done, closed, or point-in-time** and no longer earn a slot in the always-loaded MEMORY.md index. Their detailed topic files still exist on disk and are recall-able by `description` — this file is the consolidated pointer so nothing is lost. Pull the named topic file (or design doc) when the subject actually comes up.

## Closed migrations
- **Wave 1 Postgres → Dataverse migration** (CLOSED 2026-05-12) — `system_settings`/`user_app_access`/`user_preferences` dropped; dispatcher defaults → Dataverse. Prod app-user elevation tail still needs a fresh role probe before action. History: `docs/POSTGRES_TO_DATAVERSE_MIGRATION.md`, [[project-wave1-closeout-role-tail]]. Zero-touch first-login onboarding design (not built): [[project-wave1-onboarding]].
- **Wave 6 reviewer-finder Postgres tables dropped** (CLOSED 2026-06-04, S219) — `researchers`/`researcher_keywords`/`publications`/`proposal_searches`/`reviewer_suggestions` DROPPED via migration `018_drop_reviewer_finder_postgres_tables.sql`, ahead of the old ≥2026-07-01 trigger. `search_cache` kept (live cache). Pre-drop backups: Vercel Blob `cleanup-backup/2026-06-04/`. Authoritative record: [[project-w6-table-drop-closed]].

## Shipped features (don't rebuild — design docs are authoritative)
- **Dynamics Explorer**: multi-library + subfolder document listing ([[project-dynamics-explorer-archive-libs]], `lib/utils/sharepoint-buckets.js`); tool-result serializer ([[project-dynamics-explorer-serializer-deferred]], `lib/utils/dynamics-explorer-serializer.js`); Search API + perf — 77K+ docs, inline schemas, parallel exec, SSE ([[project-dynamics-explorer-details]]). Still in the index as thin pointers: schema-diff tool preference, Power-Tools reuse direction, thumbs-feedback admin anti-rebuild guardrail.
- **Dynamics identity reconciliation** (SHIPPED S127–129) — DB bridge + MSCRMCallerID + adapter chain + token lifecycle; delegate role granted 2026-05-06, impersonation smoke PASS. [[project-dynamics-identity-reconciliation]].
- **External reviewer file access** (SHIPPED 2026-05-03) — token primitive, `/external/*` endpoints, SharePoint upload, event-driven token expiry. [[project-external-reviewer-file-access]].
- **Reviewer E2E re-baseline** (RESOLVED 2026-07-04) — 23/23 green after client-UX fixture updates for board identity, missing email, and low-confidence confirmation. [[project-e2e-reviewer-rebaseline-parked]].
- **BILL/discovery unit-test expected-red exception** (CLOSED 2026-07-26) — the formerly exempt suites now pass 78/78 tests. Future failures are regressions, not accepted noise. [[project-bill-com-integration-tests-known-red]].

## Point-in-time status snapshots (superseded by live SESSION_PROMPT handoffs)
- **Intake pilot decisions 2026-05-06** — six-decision walkthrough; items 1C+1D superseded by the 2026-05-13 Track-1 decisions (still in index). [[project-intake-portal-pilot-decisions-2026-05-06]].
- **Slice-0 role probe — VERIFIED S179** — `probe-apprequestperson-role-data.js` + `extend-apprequestperson-role-picklist.mjs` (idempotent); data clear, picklist already expanded in prod. [[project-slice0-role-probe]].
- **Slice-0 scope = 4 items not 3** — carryover dropped `wmkf_portal_membership`; trust the 2026-05-14 SCHEMA_CHANGES catalog, wave dir = wave4. [[project-slice0-scope]].
- **Slice-0 timeline posture** — 2026-05-19/05-15 dates are SOFT with slack; report gating factually, no "overdue/at-risk" urgency. [[project-slice0-timeline-posture]].
- **Slice-0 Item 6 deactivate-not-delete rationale** — historical record for the parent/child rollup decision; current invariant now lives in the intake wiki + schema comments. [[slice0-deactivate-not-delete-recalc]].
- **D26 reviewer-inputs probe (S209)** — 35 D26 reqs: 0 existing candidates (Manage tabs empty), 5/5 legacy slots (~175 recs), excluded text mostly N/A. Was Phase-3 ground truth; Phase 3 (Find tab) has since shipped. [[project-d26-reviewer-inputs-probe]].

The durable slice-0 invariant (deactivate-not-delete roster rollup) now lives in `docs/agent-wiki/topics/intake-portal.md` and `lib/dataverse/schema/wave4/wmkf_proposalbudgetline.json`; the memory entry above is historical.
