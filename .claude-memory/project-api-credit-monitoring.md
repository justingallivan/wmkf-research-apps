---
name: API Credit Monitoring
description: Credit-balance observability — spend tile, daily-threshold alert, low-balance email; documents the cache-underreporting bug that motivated it
type: project
originSessionId: 855d17dc-8935-4bc6-88a5-cb73f4cb1b2d
---
User ran out of Anthropic API credits during a batch expertise matching run (April 2026). Prepaid account, no auto-reload — runaway cost caps out at remaining balance (not a financial catastrophe, but an annoying one). Wants:

1. **Admin dashboard tile** — today's spend by app and by user, pulled from `api_usage_log`
2. **Daily-spend threshold alert** — cron inserts a `system_alerts` row when today's total exceeds `DAILY_SPEND_ALERT_CENTS` (default ~$10)
3. **Low-balance alert** — remaining credit drops below threshold → email notification

**Why:** Batch processing burns credits faster than interactive use. Running out mid-batch wastes time and leaves partial results. Separately, user wants visibility into per-app / per-user spend trends since interactive-user base is small but backend/PA jobs may dominate cost once live.

**Shipped 2026-04-21 (Session 105, commit `04ce74a`):** Tile on `/admin`, hourly `/api/cron/spend-check`, low-balance email via Dynamics, `scripts/update-balance-anchor.sh` for top-up syncing. All six env vars (`DAILY_SPEND_ALERT_CENTS`, `LOW_BALANCE_ALERT_CENTS`, `ANTHROPIC_BALANCE_ANCHOR_CENTS`/`_DATE`, `SPEND_ALERT_EMAIL_TO`/`_FROM`) are live in all three Vercel environments.

**Concrete validation of observability value (2026-04-21):** while building the tile, queried `api_usage_log` for `dynamics-explorer` cache hit rate — 30 days, 90 rows, zero cache reads, zero cache creates, despite `cache_control` being sent on every call. Root cause: `parseClaudeStream` in `pages/api/dynamics-explorer/chat.js` captured `input_tokens` from `message_start.message.usage` but skipped `cache_creation_input_tokens` and `cache_read_input_tokens` on the same object. The non-streaming `callClaudeBatch` path was fine — only streaming (100% of chat traffic) was broken. Fixed in commit `5d53a32`; post-fix a single 11-call session logged 11,784 cached tokens built + 10 cached-read calls at ~12K each. **This bug was silently invisible for ~30 days; it only surfaced because we were building observability.** Keep the tile.

**How to apply:**

Verified 2026-04-18 — Anthropic Admin API has NO "balance remaining" endpoint. Closest is `/v1/organizations/cost_report` (requires admin-scoped key `sk-ant-admin-...`, separate from `CLAUDE_API_KEY`).

Two implementation paths for the low-balance alert:
- **Option A (authoritative):** new `ANTHROPIC_ADMIN_KEY` env var + manual `ANTHROPIC_BALANCE_ANCHOR_CENTS` / `_DATE` when topping up; cron calls `cost_report`, subtracts from anchor.
- **Option B (shipped — simpler):** skip Admin API, sum our own `api_usage_log.estimated_cost_cents` since anchor. Drifts slightly from actual Anthropic billing (pricing table lag, cache math), but fires early which is the safe failure mode. Also covers OpenAI/Gemini/Perplexity in one alert since they're in the same table.

**Email path:** route alerts through `DynamicsService.createAndSendEmail` (Dynamics CRM SendEmail action — working since Session 77). Do NOT use Graph-API mail path — that's still aspirational per `docs/TODO_EMAIL_NOTIFICATIONS.md`.

**Observability plan (agreed 2026-04-18):** tiles + threshold alert + "Backend" relabel for `user_profile_id IS NULL`. Skip hard caps — user base is small and trusted.

**Future-check when adding new streaming Claude callers:** verify the SSE parser captures BOTH cache fields from `message_start.message.usage` in addition to `input_tokens`. Easy to miss because the non-streaming path just spreads `data.usage` wholesale and works by default; the streaming path has to enumerate fields by name. Silent zeros in `cache_creation_tokens`/`cache_read_tokens` on a caller with a long system prompt = this bug.

Hard caps (per-user/per-app daily $ limits) are deferred until there's a second user on the system.
