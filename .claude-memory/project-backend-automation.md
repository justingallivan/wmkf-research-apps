---
name: Backend Automation Vision
description: Leadership-driven initiative to move from manual user-initiated processing to event-driven backend automation via PowerAutomate, with all results written to Dynamics
type: project
status: active
scope: strategy
last_verified: unknown via memory-content (not re-probed 2026-06-04)
---

## Recall Rule

Read this when: planning event-driven backend automation, PowerAutomate triggers on Dynamics status changes, or dual-auth processing endpoints.

Do:
- Make new API work stateless and token-authenticated so it serves both UI users and PowerAutomate (plan for service-token OR user-session auth).
- Treat Dynamics as the write-back source of truth; PA handles CRM writes initially.
- Use the v3 AI field spec; see [[project-dynamics-ai-writeback]] for the canonical field list.

Do not:
- Reintroduce per-app v2 field names (`wmkf_ai_structured_data` is renamed to `wmkf_ai_dataextract`).
- Assume run metadata lives on `akoya_request` — timestamps/model/version moved to the `wmkf_ai_run` child table.

Ground truth: `docs/EXECUTOR_CONTRACT.md`, [[project-dynamics-ai-writeback]]; PROMPT_STORAGE_DESIGN (Pattern A dual-caller).

Leadership wants key processing tasks automated on the backend — no manual uploads. Two tiers:

**Tier 1 (Fully Automatic):** PowerAutomate triggers on Dynamics status changes (e.g., proposal submitted) → calls our API → results written back to Dynamics fields. Example: Phase II proposal arrives → auto-generate summary.

**Tier 2 (Human-Initiated, CRM-Connected):** Staff uses our UI for higher-touch tasks needing judgment (reviewer finding with specific expertise criteria, review management). Results still flow back to Dynamics as source of truth.

**Write-back strategy:** PowerAutomate handles CRM writes initially (it already has full Dynamics access). Direct API writes from our app later when IT grants write permissions on app registration.

**New custom fields needed on `akoya_request`:** v3 spec names (`wmkf_ai_summary`, `wmkf_ai_dataextract` — formerly `wmkf_ai_structured_data` in v2; renamed per Connor 2026-04-14). Run timestamps + model + version moved to the `wmkf_ai_run` child table (`createdon`, `wmkf_ai_model`, `wmkf_ai_promptversion`). All deployed. See `project-dynamics-ai-writeback.md` for canonical v3 field list.

**Configurable prompts:** Prompts should be editable by admins via the dashboard (DB-backed with versioning), not requiring code deploys. Both automatic and manual flows use the same prompt system.

**Why:** The system evolved from individual workflow tool → multi-user platform → organization wants it as infrastructure. Backend triggers are the natural next step.

**How to apply:** All new API work should be stateless and token-authenticated so it can serve both UI users and PowerAutomate. Plan for dual auth (service token OR user session) on processing endpoints.
