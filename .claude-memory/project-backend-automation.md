---
name: Backend Automation Vision
description: Leadership-driven initiative to move from manual user-initiated processing to event-driven backend automation via PowerAutomate, with all results written to Dynamics
type: project
status: active
scope: strategy
last_verified: 2026-07-27 via owner strategy record, current Executor source, and production Power Automate metadata probe
---

## Recall Rule

Read this when: planning event-driven backend automation, PowerAutomate triggers on Dynamics status changes, or dual-auth processing endpoints.

Do:
- Follow the auth contract of each approved processing endpoint. Where both interactive users and PowerAutomate are approved callers, support the endpoint’s explicit service-token or user-session contract; do not generalize dual auth to every API.
- Treat Dynamics as the strategic write-back source of truth. PowerAutomate-first CRM writes were an earlier design direction; current code also has a direct Vercel write path.
- Use the v3 AI field spec; see [[project-dynamics-ai-writeback]] for the canonical field list.

Do not:
- Reintroduce per-app v2 field names (`wmkf_ai_structured_data` is renamed to `wmkf_ai_dataextract`).
- Assume run metadata lives on `akoya_request` — timestamps/model/version moved to the `wmkf_ai_run` child table.

Ground truth: `docs/EXECUTOR_CONTRACT.md`, [[project-dynamics-ai-writeback]]; PROMPT_STORAGE_DESIGN (Pattern A dual-caller).

[VERIFIED via current source 2026-10-22]: the shared Executor persists output through
`persistOutputs()` into `grantRequestAdapter.updateById()` (`lib/services/execute-prompt.js`
→ `lib/dataverse/adapters/grant-request.js`). This proves a direct application write path,
not current app-registration permissions, environment configuration, or a deployed
PowerAutomate flow. [VERIFIED 2026-07-27 via
`scripts/probe-power-automate-prompt-executor.js`]: no production cloud-flow
definition visible to the Dataverse application user implements the prompt
Executor or chaining DAG. PowerAutomate triggering remains product direction,
not deployed current behavior; the dated field-deployment claims below require
their named read-only schema probes before operational use.

Leadership wants key processing tasks automated on the backend — no manual uploads. Two tiers:

**Tier 1 (Fully Automatic):** PowerAutomate triggers on Dynamics status changes (e.g., proposal submitted) → calls our API → results written back to Dynamics fields. Example: Phase II proposal arrives → auto-generate summary.

**Tier 2 (Human-Initiated, CRM-Connected):** Staff uses our UI for higher-touch tasks needing judgment (reviewer finding with specific expertise criteria, review management). Results still flow back to Dynamics as source of truth.

**Historical write-back strategy:** PowerAutomate was expected to handle CRM writes first, with direct application writes considered later after permissions. Current source includes a direct write path; this does not establish that every deployment or caller is authorized to use it.

**2026 design/deployment record:** the v3 spec names are `wmkf_ai_summary` and
`wmkf_ai_dataextract` (formerly `wmkf_ai_structured_data` in v2). Run timestamps,
model, and version moved to the `wmkf_ai_run` child table (`createdon`,
`wmkf_ai_model`, `wmkf_ai_promptversion`). These were reported deployed through
the 2026-05-07/S209 probes; current metadata requires the read-only probes named
in [[project-dynamics-ai-writeback]].

**Configurable prompts:** Prompts should be editable by admins via the dashboard (DB-backed with versioning), not requiring code deploys. Both automatic and manual flows use the same prompt system.

**Why:** The system evolved from individual workflow tool → multi-user platform → organization wants it as infrastructure. Backend triggers are the natural next step.

**How to apply:** For each processing endpoint, trace its approved callers and apply the endpoint-specific authentication contract. Do not infer blanket dual-auth architecture from the future PowerAutomate direction or from the existing direct-write source path.
