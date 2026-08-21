-- Preserve the provider's per-call terminal reason alongside the existing
-- model/token/cost usage record. Nullable keeps historical rows and failed
-- calls valid; LLMClient supplies this only for completed provider responses.

ALTER TABLE api_usage_log
  ADD COLUMN IF NOT EXISTS stop_reason VARCHAR(50);

COMMENT ON COLUMN api_usage_log.stop_reason IS
  'Provider completion stop reason, such as end_turn, tool_use, max_tokens, or refusal.';
