-- One materials release per reviewer engagement (D46/D49). Automatic release on
-- acceptance and manual release both claim this row first; the first insert owns
-- the release. Markers on the Dataverse suggestion are written only after
-- confirmed delivery (state 'sent' -> 'recorded').
CREATE TABLE IF NOT EXISTS reviewer_materials_releases (
 suggestion_id UUID PRIMARY KEY,
 request_id UUID NOT NULL,
 source TEXT NOT NULL CHECK(source IN ('acceptance','manual')),
 state TEXT NOT NULL DEFAULT 'claimed' CHECK(state IN ('claimed','link_minted','sent','recorded','uncertain','failed')),
 job_id BIGINT REFERENCES reviewer_acceptance_jobs(id),
 actor_profile_id INTEGER REFERENCES user_profiles(id),
 lease_token UUID,
 lease_until TIMESTAMPTZ,
 attempts INTEGER NOT NULL DEFAULT 1 CHECK(attempts >= 1),
 error_code TEXT CHECK(error_code IS NULL OR length(error_code) BETWEEN 1 AND 100),
 claimed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
 link_minted_at TIMESTAMPTZ,
 sent_at TIMESTAMPTZ,
 recorded_at TIMESTAMPTZ,
 updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
 CHECK((source = 'acceptance') = (job_id IS NOT NULL)),
 CHECK(source = 'acceptance' OR actor_profile_id IS NOT NULL),
 CHECK(state NOT IN ('sent','recorded') OR sent_at IS NOT NULL),
 CHECK(state <> 'recorded' OR recorded_at IS NOT NULL)
);
CREATE INDEX IF NOT EXISTS reviewer_materials_releases_request ON reviewer_materials_releases(request_id);
CREATE INDEX IF NOT EXISTS reviewer_materials_releases_open ON reviewer_materials_releases(state, lease_until) WHERE state NOT IN ('recorded');
