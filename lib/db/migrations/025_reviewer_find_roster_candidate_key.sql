-- Keep distinct same-name reviewer candidates in distinct durable roster rows.
-- normalized_name remains a conservative cross-run search-exclusion field, but
-- is no longer an identity or mutation key.

ALTER TABLE reviewer_find_roster
  ADD COLUMN candidate_key TEXT;

UPDATE reviewer_find_roster
SET candidate_key = COALESCE(
  NULLIF(candidate->>'candidateKey', ''),
  'legacy-row:' || id::text
);

UPDATE reviewer_find_roster
SET candidate = candidate || jsonb_build_object('candidateKey', candidate_key);

ALTER TABLE reviewer_find_roster
  ALTER COLUMN candidate_key SET NOT NULL;

DROP INDEX uq_reviewer_find_roster_req_name;

CREATE UNIQUE INDEX uq_reviewer_find_roster_req_candidate
  ON reviewer_find_roster (request_id, candidate_key);

CREATE INDEX idx_reviewer_find_roster_req_name
  ON reviewer_find_roster (request_id, normalized_name);
