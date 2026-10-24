-- Durable meeting material preparation. Allocation verified against 355 refs and
-- owner-authorized tracker filenames 2026-10-23; apply before deploying these readers.
CREATE TABLE IF NOT EXISTS meeting_material_preparations (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
 request_id UUID NOT NULL REFERENCES meeting_presentation_visibility(request_id),
 site_visit_id UUID NOT NULL,
 input_fingerprint TEXT NOT NULL CHECK (input_fingerprint ~ '^[a-f0-9]{64}$'),
 input JSONB NOT NULL CHECK (jsonb_typeof(input)='object' AND octet_length(input::text)<=8192),
 source_artifact_id UUID,
 source_fingerprint TEXT CHECK (source_fingerprint IS NULL OR source_fingerprint ~ '^[a-f0-9]{64}$'),
 actor_profile_id INTEGER NOT NULL REFERENCES user_profiles(id),
 acting_user_system_id UUID NOT NULL,
 version INTEGER NOT NULL DEFAULT 1 CHECK (version>0),
 created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
 UNIQUE(request_id,site_visit_id,input_fingerprint)
);
CREATE TABLE IF NOT EXISTS meeting_material_preparation_steps (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
 preparation_id UUID NOT NULL REFERENCES meeting_material_preparations(id),
 kind TEXT NOT NULL CHECK (kind IN ('source','transcripts','presentation_summary','discussion_summary','video')),
 state TEXT NOT NULL DEFAULT 'pending' CHECK(state IN ('pending','running','succeeded','blocked','unknown')),
 attempt_id UUID NOT NULL DEFAULT gen_random_uuid(),
 attempt_created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
 attempts INTEGER NOT NULL DEFAULT 0 CHECK(attempts BETWEEN 0 AND 3),
 version INTEGER NOT NULL DEFAULT 1 CHECK(version>0),
 execution_profile_id INTEGER REFERENCES user_profiles(id), execution_system_user_id UUID,
 lease_token UUID, lease_expires_at TIMESTAMPTZ,
 options JSONB NOT NULL DEFAULT '{}'::jsonb CHECK(jsonb_typeof(options)='object' AND octet_length(options::text)<=1024),
 output JSONB CHECK(output IS NULL OR (jsonb_typeof(output)='object' AND octet_length(output::text)<=4096)),
 failure_code TEXT CHECK(failure_code IS NULL OR failure_code ~ '^[a-z0-9_]{1,80}$'),
 next_attempt_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
 updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
 UNIQUE(preparation_id,kind),
 CHECK ((execution_profile_id IS NULL)=(execution_system_user_id IS NULL)),
 CHECK ((state='running')=(lease_token IS NOT NULL AND lease_expires_at IS NOT NULL)),
 CHECK (state='running' OR (lease_token IS NULL AND lease_expires_at IS NULL))
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_meeting_preparation_one_running ON meeting_material_preparation_steps(preparation_id) WHERE state='running';
CREATE INDEX IF NOT EXISTS idx_meeting_preparation_work ON meeting_material_preparation_steps(state,next_attempt_at);
CREATE INDEX IF NOT EXISTS idx_meeting_preparation_request ON meeting_material_preparations(request_id,created_at DESC);
ALTER TABLE meeting_transcript_summary_drafts
 ALTER COLUMN acknowledgment_version DROP NOT NULL,
 ALTER COLUMN acknowledged_by_profile_id DROP NOT NULL,
 ALTER COLUMN acknowledged_at DROP NOT NULL,
 ADD COLUMN IF NOT EXISTS preparation_id UUID REFERENCES meeting_material_preparations(id),
 ADD COLUMN IF NOT EXISTS generation_outcome TEXT CHECK(generation_outcome IN ('reserved','dispatched','unknown','completed','failed','abandoned')),
 ADD COLUMN IF NOT EXISTS initiated_by_profile_id INTEGER REFERENCES user_profiles(id),
 ADD COLUMN IF NOT EXISTS initiated_at TIMESTAMPTZ;
DO $$ BEGIN
ALTER TABLE meeting_transcript_summary_drafts ADD CONSTRAINT summary_acknowledgment_truthful_shape CHECK (
 (acknowledgment_version IS NULL AND acknowledged_by_profile_id IS NULL AND acknowledged_at IS NULL)
 OR (acknowledgment_version IS NOT NULL AND acknowledged_by_profile_id IS NOT NULL AND acknowledged_at IS NOT NULL));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
CREATE INDEX IF NOT EXISTS idx_meeting_summary_uncertainty ON meeting_transcript_summary_drafts(request_id,artifact_type)
 WHERE generation_outcome IN ('reserved','dispatched','unknown');
COMMENT ON TABLE meeting_material_preparations IS 'Content-free request/visit/input identity and actor for durable meeting preparation. Never Board approval.';
COMMENT ON TABLE meeting_material_preparation_steps IS 'Bounded child attempts and output references. Unknown summary attempts require explicit coordinator recovery; successful outputs survive failures.';

-- Meeting Tracker initiation is distinct from the retired disclosure acknowledgement.
ALTER TABLE transcription_jobs ADD COLUMN IF NOT EXISTS initiated_by_profile_id INTEGER REFERENCES user_profiles(id), ADD COLUMN IF NOT EXISTS initiated_at TIMESTAMPTZ;
