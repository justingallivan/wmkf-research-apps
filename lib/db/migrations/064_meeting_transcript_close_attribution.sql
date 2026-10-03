ALTER TABLE meeting_transcript_publications
  ADD COLUMN IF NOT EXISTS closed_by_profile_id INTEGER REFERENCES user_profiles(id);
