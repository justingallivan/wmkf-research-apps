-- Raise the transcription audio byte cap from 50 MiB (52,428,800) to 200 MiB
-- (209,715,200) to match lib/services/transcription-pilot/limits.js. The
-- original constraints were inline column CHECKs from 060, so they carry the
-- Postgres default names <table>_<column>_check.
ALTER TABLE transcription_jobs
  DROP CONSTRAINT IF EXISTS transcription_jobs_declared_bytes_check,
  DROP CONSTRAINT IF EXISTS transcription_jobs_verified_bytes_check;
ALTER TABLE transcription_jobs
  ADD CONSTRAINT transcription_jobs_declared_bytes_check
    CHECK (declared_bytes IS NULL OR declared_bytes BETWEEN 1 AND 209715200),
  ADD CONSTRAINT transcription_jobs_verified_bytes_check
    CHECK (verified_bytes IS NULL OR verified_bytes BETWEEN 1 AND 209715200);
