-- Review bundle PDF retention (plan §11, Step C1). Ten nullable columns on
-- the existing pre_site_distribution_attempts table pin the identity of the
-- one-PDF-per-request "every review" bundle assembled at Share (prepare)
-- time: the governed registry row/SharePoint file it lives in, the review
-- set it was built from, and (for the later on-demand rebuild) when it was
-- last rebuilt. Legacy (pre-review-bundle) attempts leave the whole family
-- null.

ALTER TABLE pre_site_distribution_attempts
  ADD COLUMN IF NOT EXISTS review_bundle_document_id TEXT,
  ADD COLUMN IF NOT EXISTS review_bundle_drive_id TEXT,
  ADD COLUMN IF NOT EXISTS review_bundle_item_id TEXT,
  ADD COLUMN IF NOT EXISTS review_bundle_version_id TEXT,
  ADD COLUMN IF NOT EXISTS review_bundle_filename TEXT,
  ADD COLUMN IF NOT EXISTS review_bundle_size INTEGER,
  ADD COLUMN IF NOT EXISTS review_bundle_byte_hash CHAR(64),
  ADD COLUMN IF NOT EXISTS review_bundle_set_fingerprint CHAR(64),
  ADD COLUMN IF NOT EXISTS review_bundle_review_count INTEGER,
  ADD COLUMN IF NOT EXISTS review_bundle_rebuilt_at TIMESTAMPTZ;

ALTER TABLE pre_site_distribution_attempts
  DROP CONSTRAINT IF EXISTS pre_site_distribution_review_bundle_shape,
  DROP CONSTRAINT IF EXISTS pre_site_distribution_review_bundle_coherence;

ALTER TABLE pre_site_distribution_attempts
  ADD CONSTRAINT pre_site_distribution_review_bundle_shape CHECK (
    (review_bundle_byte_hash IS NULL OR review_bundle_byte_hash ~ '^[0-9a-f]{64}$')
    AND (review_bundle_set_fingerprint IS NULL OR review_bundle_set_fingerprint ~ '^[0-9a-f]{64}$')
  ),
  ADD CONSTRAINT pre_site_distribution_review_bundle_coherence CHECK (
    (
      -- Legacy attempt: the whole family is null, and a rebuild timestamp
      -- (meaningful only once a bundle exists) cannot be set either.
      review_bundle_document_id IS NULL
      AND review_bundle_drive_id IS NULL
      AND review_bundle_item_id IS NULL
      AND review_bundle_filename IS NULL
      AND review_bundle_byte_hash IS NULL
      AND review_bundle_set_fingerprint IS NULL
      AND review_bundle_review_count IS NULL
      AND review_bundle_rebuilt_at IS NULL
    )
    OR (
      -- A prepared review-bundle attempt always has this identity core.
      -- review_bundle_version_id and review_bundle_size are metadata, not
      -- part of the generation-key identity, so they are not required here.
      review_bundle_document_id IS NOT NULL
      AND review_bundle_drive_id IS NOT NULL
      AND review_bundle_item_id IS NOT NULL
      AND review_bundle_filename IS NOT NULL
      AND review_bundle_byte_hash IS NOT NULL
      AND review_bundle_set_fingerprint IS NOT NULL
      AND review_bundle_review_count IS NOT NULL
      AND review_bundle_review_count >= 1
    )
  );
