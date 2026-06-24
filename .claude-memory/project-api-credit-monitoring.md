---
name: API Credit Monitoring
description: Credit-spend observability — `/admin` spend tile, daily-threshold alert, and the cache-underreporting bug that motivated building it
type: project
originSessionId: 855d17dc-8935-4bc6-88a5-cb73f4cb1b2d
status: active
scope: global
last_verified: S209 via memory-content (not re-probed 2026-06-04)
---

## Recall Rule

Read this when: working on credit-spend observability, the `/admin` spend tile, pricing accuracy, or adding a new streaming Claude caller.

Do:
- Keep pricing source of truth in code (`lib/utils/model-pricing.js`); cron alerts surface drift, humans edit.
- When adding a streaming Claude caller, verify the SSE parser captures BOTH `cache_creation_input_tokens` and `cache_read_input_tokens` from `message_start.message.usage` (silent zeros = the dynamics-explorer bug).
- Use Anthropic console Billing → Usage for authoritative org-wide spend; auto-reload is ON.

Do not:
- Rebuild the removed low-balance estimator/anchor machinery — Anthropic-native auto-reload + spend limits replaced it (S181).
- Assume there is a numbered migration `032` for `model_pricing_audit` — it's created in `scripts/setup-database.js`; latest numbered migration is `020_reviewer_find_roster.sql`.

Ground truth: `lib/utils/model-pricing.js`, `pages/api/admin/stats.js`, `pages/api/cron/{spend-check,pricing-canary,pricing-refresh}.js`, `api_usage_log` table; Anthropic console for reconciliation.

User ran out of Anthropic API credits during a batch expertise matching run (April 2026). Prepaid account at the time, no auto-reload. Wanted: admin tile, daily-spend threshold alert, low-balance alert.

**Why originally:** batch processing burns credits faster than interactive use. Running out mid-batch wastes time and leaves partial results. Per-app / per-user spend trends matter because the interactive-user base is small but backend/PA jobs may dominate cost once live.

## Current state (S181, 2026-05-23)

**Account moved to work org.** Justin's WMKF Anthropic account replaces the personal account that motivated the original work. Production `CLAUDE_API_KEY` confirmed pointing at the work org (last-used timestamp comparison, S181).

**Anthropic-native features now cover the failure modes the local code was guarding:**
- **Auto-reload ON** — when balance drops below threshold, Anthropic charges the saved card and tops up automatically. Eliminates "credits run out mid-batch."
- **$500/mo spend limit + Anthropic's own email notifications** — covers "approaching budget" without our code.
- **Anthropic console Usage/Cost pages** — authoritative org-wide spend, one click away.

**Local code retained:**
- **Admin tile (per-user, per-app)** — only WE can produce this; Anthropic only knows API keys, not WMKF users. `pages/api/admin/stats.js` queries `api_usage_log` for breakdowns.
- **Daily-spend threshold alert** (`/api/cron/spend-check.js`) — kept as a runaway-cost detector (code wedged in a loop, prompt mistakenly looping a large input). Different failure mode than budget approaching.

**Pricing accuracy machinery (S181):**
- **`lib/utils/model-pricing.js`** — extracted from `usage-logger.js`. Longest-prefix-first matcher (was `.includes()`, which silently misrouted `claude-opus-4-6` → `claude-opus-4` pricing for 3× overestimate). `LAST_REVIEWED_AT` field. Bug fixes: Haiku 4.5 = $1/$5 (was $0.80/$4); Opus 4.5/4.6/4.7 = $5/$25 (were inheriting Opus 4 $15/$75). 1h cache write multiplier (2×) added.
- **`/api/cron/pricing-canary`** — weekly (Mon 10am UTC). Scans last 7d of `api_usage_log` for unknown model ids + flags if `LAST_REVIEWED_AT` >60 days old. Free signal, no Admin API needed.
- **`/api/cron/pricing-refresh`** — monthly (1st of month, 11am UTC). Pulls Anthropic `/v1/organizations/cost_report` for last 30d, derives per-(model, token_type) price from `cost / tokens`, compares to local table, alerts on >5% drift OR unknown-in-cost-report. Skips when `ANTHROPIC_ADMIN_API_KEY` not set. Writes audit history to `model_pricing_audit` (created in `scripts/setup-database.js`, not a numbered migration — there is no `032`; latest migration is `020_reviewer_find_roster.sql`). [verified S209; migration high-water mark refreshed 2026-06-23]
- **Storage decision:** pricing source of truth stays in code; cron alerts and humans edit. No auto-overwrite — protects against billing-system glitches corrupting prices.

**Local code removed (S181):**
- `checkLowBalance()` function and the anchor-based estimator.
- `scripts/update-balance-anchor.sh`. <!-- doc-symbol-refs:ignore reason=removed-s181 -->
- Env vars `ANTHROPIC_BALANCE_ANCHOR_CENTS`, `ANTHROPIC_BALANCE_ANCHOR_DATE`, `LOW_BALANCE_ALERT_CENTS`. Also `SPEND_ALERT_EMAIL_TO/FROM` + `NOTIFICATION_EMAIL_TO` (removed earlier in S181 when alert recipients moved to the per-category routing config).

## Accuracy of our local estimate vs Anthropic

S181 cross-check: local `api_usage_log` MTD = $2.53; Anthropic console MTD = $3.35. ~24% delta, mostly cache-write pricing variance + Anthropic's 5-min reporting lag. Numbers agree well enough that per-user breakdowns are trustworthy as estimates.

**Pattern available but not built:** pull Admin API `/v1/organizations/cost_report` daily, compute a correction factor (e.g. 1.08×), apply to per-user numbers so they sum to the authoritative total. Over-engineering for the current volume; revisit if delta grows or finance asks.

## Concrete validation of observability value (the original 2026-04-21 finding — keep)

While building the tile, queried `api_usage_log` for `dynamics-explorer` cache hit rate — 30 days, 90 rows, zero cache reads, zero cache creates, despite `cache_control` being sent on every call. Root cause: `parseClaudeStream` in `pages/api/dynamics-explorer/chat.js` captured `input_tokens` from `message_start.message.usage` but skipped `cache_creation_input_tokens` and `cache_read_input_tokens` on the same object. The non-streaming `callClaudeBatch` path was fine — only streaming (100% of chat traffic) was broken. Fixed in commit `5d53a32`; post-fix a single 11-call session logged 11,784 cached tokens built + 10 cached-read calls at ~12K each.

**This bug was silently invisible for ~30 days; it only surfaced because we were building observability.** Keep the tile.

## How to apply

**Future-check when adding new streaming Claude callers:** verify the SSE parser captures BOTH cache fields from `message_start.message.usage` in addition to `input_tokens`. Easy to miss because the non-streaming path just spreads `data.usage` wholesale and works by default; the streaming path has to enumerate fields by name. Silent zeros in `cache_creation_tokens`/`cache_read_tokens` on a caller with a long system prompt = this bug.

**For ground-truth reconciliation:** open the Anthropic console Billing → Usage. Auto-reload is ON; spend-limit is $500/mo with native Anthropic notifications. No code maintenance needed.

**For per-user breakdowns:** `/admin` Usage section, or `scripts/check-mtd-spend.js` for ad-hoc terminal queries.

Hard caps (per-user/per-app daily $ limits) deferred until there's evidence of need.
