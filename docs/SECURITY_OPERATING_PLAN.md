---
title: Security Operating Plan
domain: security-auth
kind: runbook
status: canonical
summary: "- docs/API_ROUTE_SECURITY_MATRIX.md — who can call each API route and what boundary protects it."
canonical: true
cataloged: 2026-07-02
owner: product-engineering
related:
  - docs/API_ROUTE_SECURITY_MATRIX.md
  - docs/AI_DATA_FLOW_MATRIX.md
  - pages/api/
  - docs/archive/SECURITY_OPERATING_PLAN_ALIGNMENT_BRIEF.md
---

# Security Operating Plan

Last updated: 2026-05-05

This plan captures the operating rhythm we want after the May 2026 hardening tranche. The goal is to keep the app suite secure and maintainable as it moves further into production use, without turning every week into a fresh security audit.

The source-of-truth inventories are:

- `docs/API_ROUTE_SECURITY_MATRIX.md` — who can call each API route and what boundary protects it.
- `docs/AI_DATA_FLOW_MATRIX.md` — what data enters external AI/model contexts or durable AI logs.

## Current Posture

The recent hardening tranche closed the current P1 column in the AI/security matrices.

Completed controls:

- API route security matrix and CI gate for new/changed API routes.
- AI data-flow matrix covering high-volume model paths.
- Explicit payload boundaries for proposal/report text sent to external AI services.
- Prompt Executor `dataClass + maxChars` declarative payload caps.
- Redaction of bounded override values before writing `wmkf_ai_promptoverride`.
- Raw-output retention modes (`full`, `hash`, `none`) for Executor and `DynamicsService.logAiRun()`.
- `phase-i.summary` live prompt row activated with `rawOutputRetention: "hash"`.
- Virtual Review Panel provider allowlist and production fail-closed behavior.
- Reviewer Finder migration to `LLMClient`.
- Dynamics Explorer model-context serializer for tool results, search highlights, and export AI-processing records.

Remaining items are operational watch items, not urgent code defects:

- Confirm Dataverse permissions and retention policy for `wmkf_ai_run`.
- Continue adopting `rawOutputRetention` on future high-volume `logAiRun()` callers.
- Watch Dynamics Explorer token costs and answer quality after serializer rollout.
- Keep matrices current during PR review.

## Operating Principles

1. New API routes must update `API_ROUTE_SECURITY_MATRIX.md`.
2. New or materially changed AI/model calls must update `AI_DATA_FLOW_MATRIX.md`.
3. High-volume text sent to external AI must have an explicit named boundary, a cap, and a regression test.
4. Sensitive/high-volume inputs should not be copied into audit logs unless that log is the only durable business record.
5. Security controls should become shared mechanisms when repeated, not route-specific folklore.
6. Defer code hardening when the risk is speculative, but write down the watch trigger.

## PR-Time Checklist

Use this on any PR that touches API routes, auth, Dynamics, SharePoint, external AI, file handling, or durable logs.

- Does this add or change a `pages/api/**/*.js` route?
  - Update `docs/API_ROUTE_SECURITY_MATRIX.md`.
  - Run `npm run check:api-routes`.
- Does this send user, proposal, report, CRM, or document data to an AI model?
  - Update `docs/AI_DATA_FLOW_MATRIX.md`.
  - Add or verify payload boundary tests.
  - Confirm provider allowlist behavior if multiple vendors are involved.
- Does this write model input/output to Dataverse, Postgres, logs, Blob, or SharePoint?
  - Confirm whether content should be `full`, `hash`, `none`, or redacted.
  - Avoid duplicating sensitive content when a target business record already stores it.
- Does this expose downloadable files or proxy external URLs?
  - Confirm ownership/scope checks and host allowlists.
- Does this touch Dynamics Explorer?
  - Confirm model-bound records pass through the serializer.
  - Watch for bypasses caused by preformatted strings or joined summaries.

## Weekly Cadence

Owner: Justin (sole developer on the app suite).

Timebox: 30-45 minutes. Triggered by a recurring calendar reminder (e.g. Mondays AM) rather than an implicit "first session of the week" trigger — explicit recurrence guards against the cadence-drift failure mode that quietly slips after several weeks.

Checklist:

- Review failed CI/security checks.
- Run or inspect dependency/security alerts.
- Review new or changed API routes since the last check.
- Check whether any AI/model call sites were added without matrix updates.
- Skim recent high-volume AI usage for unexpected token growth or provider drift.
- Note any follow-up items in the relevant matrix rather than starting a new one-off document.

Output:

- No change needed, or
- One short issue/PR with the specific matrix row, route, or call site to update.

## Monthly Cadence

Owner: Justin, with Connor looped in on backend-automation / Dynamics-side topics.

Timebox: 60-90 minutes. Tied to the next regular Connor sync rather than a standalone meeting — the doc-storage work, prompt-row activations, and `wmkf_ai_run` retention review naturally belong in those conversations anyway. If a month passes without a Connor sync, do the Dataverse-side checks solo and queue the rest for the next one.

Checklist:

- Review `wmkf_ai_run` access and retention assumptions.
- Review high-volume `DynamicsService.logAiRun()` callers:
  - Should raw output stay `full`?
  - Is `hash` sufficient because the business output is saved elsewhere?
  - Is `none` sufficient?
- Review Dynamics Explorer:
  - Token cost trend.
  - Query denial trend.
  - Any answer-quality regressions caused by serializer redaction.
  - Any loopback behavior involving generated summaries or raw outputs.
- Review external AI provider configuration:
  - `VRP_ALLOWED_PROVIDERS`.
  - Required keys in production.
  - Provider set stored with runs/results.
- Confirm operational secrets and production env vars are documented.

Output:

- Update `AI_DATA_FLOW_MATRIX.md` watch items.
- Open small implementation tickets only for observed risks or clear policy decisions.

## Quarterly Cadence

Owner: Justin, with the Foundation IT contact looped in for service-principal / tenant-permission topics.

Timebox: half day. Triggered by calendar (every three months) OR by a material change (new app, new external integration, new data class entering AI context, IT permission change) — whichever comes first.

Checklist:

- Re-read `API_ROUTE_SECURITY_MATRIX.md` and `AI_DATA_FLOW_MATRIX.md` end to end.
- Re-rank open P1/P2/P3 items.
- Review auth/app-access assumptions against actual staff usage.
- Review Dataverse and SharePoint service-principal permissions.
- Review production incidents, near misses, or confusing operator workflows.
- Confirm whether documented deferrals are still valid.

Output:

- Updated matrix priorities.
- A short decision log:
  - What changed?
  - What remains accepted risk?
  - What needs code?
  - What needs IT/admin action?

## Postgres backup / restore

The application's Postgres database is provisioned via Vercel's Neon integration. Neon retains **WAL history**, not discrete snapshots — recovery happens by branching the live database at a past timestamp (a fast, copy-on-write operation), not by restoring from a backup file. There's no application-side backup job to run.

**Retention window depends on the Neon tier.** As of 2026-05 (verify against current Neon docs):

| Tier | PITR / restore reach |
|---|---|
| Free | **6 hours** |
| Launch | 7 days |
| Scale | 30 days |

**Verify the current tier via** Vercel project dashboard → Storage → Neon Postgres → Settings. If we're on the Free tier, the recovery reach is much narrower than what most operators intuitively assume — any restore plan needs to fit inside the 6-hour window. When changing tiers, update both the dashboard expectation and this table.

**Recovery procedure** (use when a table is corrupted or critical data is lost):

1. Identify the target timestamp — when the data was last known to be intact.
2. In the Vercel/Neon dashboard, create a **branch** from that timestamp. Neon creates a new database snapshot at that point-in-time — fast (seconds) because Neon's storage is copy-on-write.
3. Connect to the branch using the branch's connection string (separate from prod). Verify the data is intact.
4. Decide on recovery strategy:
   - **Partial restore** (single table, single row): dump the affected rows from the branch using `pg_dump --table=...` or `psql -c "COPY ..."`, then restore into prod. Lowest-risk option; prod stays live.
   - **Full restore** (catastrophic loss): promote the branch to be the new primary. Coordinates downtime; rare.
5. After restore is verified, delete the branch (cleans up storage).

**Restore-test cadence:** Quarterly. Pick a date, branch the prod DB to that timestamp, query a known-stable table to verify recoverability, then delete the branch. This is a low-effort drill — under 10 minutes per quarter — that catches "snapshot retention quietly stopped working" type failures before a real incident.

**Log restore-test runs in `system_alerts`** with category `ops` and severity `info`, message format `quarterly-restore-test passed (PITR target: YYYY-MM-DD)`. Lets us audit cadence from the maintenance dashboard.

**Out-of-scope of Neon's PITR:**
- Vercel Blob (separate retention/recovery model — see [blob lifecycle docs](https://vercel.com/docs/storage/vercel-blob))
- Dataverse (Microsoft-managed; restore procedures live with Connor / AkoyaGO admin)
- SharePoint (Microsoft-managed; Graph API content is not part of our backup posture)

**B2-F5 readiness-audit finding closed S188.**

## Current Watch Items

### Workbench Dependency Telemetry

Status: implemented on branch `codex/claude-workbench-observability-stage1` (Stage 1,
`lib/observability/request-correlation.js`); not yet merged; production measurement window
not yet opened.

Every server-side call through the three instrumented egress seams
(`lib/services/dynamics/http.js`, `lib/services/graph-service.js`,
`lib/dataverse/client.js`) emits one `workbench.dependency` JSON line to the platform log
stream at 100% sampling. These are **shared app-wide transports** — every caller emits, not
only Workbench routes; non-HTTP callers (cron, cold start, `scripts/`) emit without
`correlationId`/`routeName` by design.

PII/secret contract: the event carries only closed-set literals (`dependency`,
`resourceClass`, `operation`, `outcome`, `statusClass`), a duration, and two random UUIDs.
Raw URLs, query strings, path segments, entity ids, filenames, tenant identifiers,
signed-URL material, tokens, headers, and bodies are never emitted; classifiers fail closed
to `'unknown'` rather than fall through to raw input, and error classification reads only
structured error markers, never `error.message`. Pinned by redaction unit tests over seeded
hostile-URL/secret markers plus exact-key-set assertions on the envelope. `correlationId` is
a server-minted `crypto.randomUUID()` — never accepted from a request header or body,
carries no user identity, and is never write authority. The sink is the existing platform
log stream: no new table, no durable write, and deliberately not `api_usage_log` (the LLM
token/cost ledger).

Watch trigger (any one is sufficient):

- Platform log throttling or truncation observed in a measurement slice.
- A visible log-cost line item appears on the Vercel bill.
- A new egress seam is instrumented, or a Dataverse entity set is added to the
  `resourceClass` allowlist without a reviewed commit.

Escalation threshold:

- Watch becomes a stop condition when daily `workbench.dependency` volume exceeds
  ~50,000 lines/day (per `docs/WORKBENCH_OBSERVABILITY_AND_READ_COALESCING_PLAN.md`
  Stage 1). Whole-application dependency-call volume is `[ASSUMED — explicitly
  unverified]`; measure it in the first 48 hours of emission. Exceeding the threshold is a
  stop, not a silent tuning choice.

Likely response:

- Revert (the change is purely additive) or land a named sampling knob as a separately
  reviewed follow-up.

### `wmkf_ai_run` Retention

Status: partially adopted.

`phase-i.summary` uses hash retention. Grant Reporting deliberately remains `full` because its output currently flows to client-side Word export and the audit row is the only durable copy.

Watch trigger (any one is sufficient):

- A save-to-`akoya_request` path lands for Grant Reporting outputs (Grant Reporting → `'hash'`).
- A new high-volume `logAiRun()` caller stores derived proposal/report text and the same content lives elsewhere as a business record (new caller → `'hash'`).
- Dataverse access review shows `wmkf_ai_run` is readable by roles broader than intended (escalate to IT ticket — this is a permission concern, not a code concern).

Escalation threshold:

- Watch becomes a ticket when the Dataverse `wmkf_ai_run` table exceeds 10,000 rows OR when a non-staff role (e.g. external contact, applicant tenant user) gains read access to the table. As of 2026-05-05, staff have read access to all fields across all tables in this Dataverse environment by design — that's the intended audience, not the trigger. Until non-staff exposure happens, the table is small enough and the audience is narrow enough that retention is a watch item, not a defect.

Likely response:

- Adopt `rawOutputRetention: "hash"` or `"none"` for the relevant caller.
- Document the rationale inline at the call site.

### Dynamics Explorer Serializer

Status: shipped.

The serializer redacts high-risk fields and caps long values before CRM data re-enters Claude context. `wmkf_ai_summary` is intentionally not denylisted; the long-string cap preserves legitimate summary questions while avoiding full 4-8KB summary fan-out.

Watch trigger:

- Token costs rise after more long-text fields enter common tables.
- Claude cites generated summaries as ground truth in fresh queries.
- Users report that serializer redaction prevents legitimate answers.

Escalation threshold:

- Watch becomes a ticket when Dynamics Explorer's monthly Anthropic spend exceeds $50, OR when a single user reports a redaction-induced wrong answer (false negative on a legitimate query is a real product bug; cost creep is a config tuning task). Token-cost trend is observable via the existing usage logs in `api_usage_log`.

Likely response:

- Add per-table default `select` pruning for generic queries.
- Add deliberate field-specific allow paths where justified.
- Avoid globally disabling the serializer.

### Search Document Fan-Out

Status: accepted watch item.

`search_documents` passes through curated Graph snippets. Per-file snippets are small, but broad queries can join many snippets into a larger context payload.

Watch trigger:

- Search-document queries become a measurable token-cost source.
- Users run broad document searches routinely.

Escalation threshold:

- Watch becomes a ticket when a single `search_documents` invocation routinely returns more than 50 files, OR when search-tool token usage exceeds 20% of total Dynamics Explorer spend in a month.

Likely response:

- Add a fan-out cap, such as limiting returned snippet lines and reporting `hasMore`.

## Decisions, 2026-05-05

Initial alignment ratified in Session 132. Brief archived at `docs/archive/SECURITY_OPERATING_PLAN_ALIGNMENT_BRIEF.md`.

1. **Hardening tranche complete** — confirmed.
2. **Cadence as drafted** — accepted. Weekly trigger switched from "first session of the week" to a recurring calendar reminder (folded into § Weekly Cadence above).
3. **`wmkf_ai_run` permission review** — kept as a watch item. Read access self-answered same day: in this Dataverse environment, staff have read access to all fields across all tables (per Justin). Watch item's "audience is staff-only" assumption confirmed; escalation threshold remains "non-staff role gains read access" (e.g. external contact, applicant tenant user).
4. **PR-time AI matrix check** — kept as a soft prompt. CI gate revisited if drift accumulates over two consecutive monthly reviews, or if a contributor is onboarded.
5. **Watch-item tracking** — matrix rows only. Promotion to GitHub issue only when an item's escalation threshold trips.
6. **Next non-security priority** — intake portal institution/membership flow as primary thread for sessions 133+. (Delegate role unblock and impersonation re-smoke both completed 2026-05-06; Dynamics Explorer schema curation remains a between-rocks palate cleanser.)

## Definition of Done For Future Security Work

A security hardening item is done when:

- The code change is implemented.
- The relevant matrix is updated.
- Tests pin the behavior if regression would matter.
- Any production activation step is complete or explicitly tracked.
- The remaining risk is documented as accepted, deferred, or transferred to IT/admin action.
