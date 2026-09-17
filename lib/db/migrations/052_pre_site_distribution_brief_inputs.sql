-- Pre-Research Presentation Brief prepare-time review/drift gate audit trail
-- (docs/plans/PRE_RESEARCH_PRESENTATION_BRIEF_PLAN_2026-09-16.md §3.4b).
--
-- Five nullable columns on the existing pre_site_distribution_attempts
-- table: the fingerprint recorded on the brief row at generation time, the
-- fingerprint recomputed from live inputs at prepare time, the bounded
-- audit delta between them, and who/when acknowledged a drifted retry.
-- Legacy (pre-brief, Pre-Site-sourced) attempts leave all five null.

ALTER TABLE pre_site_distribution_attempts
  ADD COLUMN IF NOT EXISTS input_fingerprint_generated CHAR(64),
  ADD COLUMN IF NOT EXISTS input_fingerprint_live CHAR(64),
  ADD COLUMN IF NOT EXISTS stale_inputs_delta JSONB,
  ADD COLUMN IF NOT EXISTS stale_inputs_acknowledged_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS stale_inputs_acknowledged_by UUID;

ALTER TABLE pre_site_distribution_attempts
  DROP CONSTRAINT IF EXISTS pre_site_distribution_brief_fingerprint_shape,
  DROP CONSTRAINT IF EXISTS pre_site_distribution_brief_inputs_coherence;

ALTER TABLE pre_site_distribution_attempts
  ADD CONSTRAINT pre_site_distribution_brief_fingerprint_shape CHECK (
    (input_fingerprint_generated IS NULL OR input_fingerprint_generated ~ '^[0-9a-f]{64}$')
    AND (input_fingerprint_live IS NULL OR input_fingerprint_live ~ '^[0-9a-f]{64}$')
  ),
  ADD CONSTRAINT pre_site_distribution_brief_inputs_coherence CHECK (
    (
      -- Legacy (non-brief) attempt: all five columns null.
      input_fingerprint_generated IS NULL
      AND input_fingerprint_live IS NULL
      AND stale_inputs_delta IS NULL
      AND stale_inputs_acknowledged_at IS NULL
      AND stale_inputs_acknowledged_by IS NULL
    )
    OR (
      -- A brief attempt always has both fingerprints.
      input_fingerprint_generated IS NOT NULL
      AND input_fingerprint_live IS NOT NULL
      AND (
        (
          -- No drift: equal fingerprints, no delta/acknowledgement.
          input_fingerprint_generated = input_fingerprint_live
          AND stale_inputs_delta IS NULL
          AND stale_inputs_acknowledged_at IS NULL
          AND stale_inputs_acknowledged_by IS NULL
        )
        OR (
          -- Acknowledged drift: unequal fingerprints, an object delta, and
          -- both acknowledgement fields.
          input_fingerprint_generated <> input_fingerprint_live
          AND stale_inputs_delta IS NOT NULL
          AND jsonb_typeof(stale_inputs_delta) = 'object'
          AND stale_inputs_acknowledged_at IS NOT NULL
          AND stale_inputs_acknowledged_by IS NOT NULL
        )
      )
    )
  );
