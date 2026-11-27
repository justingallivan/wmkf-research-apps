CREATE TABLE reviewer_find_handoffs (
  request_id UUID PRIMARY KEY,
  case_id UUID NOT NULL DEFAULT gen_random_uuid(),
  owner_profile_id INTEGER NOT NULL REFERENCES user_profiles(id),
  settings JSONB NOT NULL,
  opened_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
