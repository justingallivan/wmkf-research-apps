-- Append-only lead Program Director/superuser dispositions for workbench
-- integrity screenings. Existing screening status/notes remain untouched.
CREATE TABLE IF NOT EXISTS integrity_screening_reviews (
  id SERIAL PRIMARY KEY,
  screening_id INTEGER NOT NULL REFERENCES integrity_screenings(id),
  request_id UUID NOT NULL,
  reviewer_profile_id INTEGER NOT NULL REFERENCES user_profiles(id),
  reviewer_systemuser_id UUID NOT NULL,
  decision VARCHAR(16) NOT NULL CHECK (decision IN ('approved', 'hold')),
  notes TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT integrity_screening_reviews_notes_length CHECK (char_length(notes) <= 2000),
  CONSTRAINT integrity_screening_reviews_hold_notes CHECK (decision <> 'hold' OR length(trim(notes)) > 0)
);

CREATE INDEX IF NOT EXISTS idx_integrity_screening_reviews_request_created
  ON integrity_screening_reviews (request_id, created_at DESC, id DESC);

CREATE INDEX IF NOT EXISTS idx_integrity_screening_reviews_screening_created
  ON integrity_screening_reviews (screening_id, created_at DESC, id DESC);
