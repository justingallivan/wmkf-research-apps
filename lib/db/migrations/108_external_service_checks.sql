-- Bounded latest manual check + successful source baselines, separate from human reviews.
SET LOCAL lock_timeout = '5s';
CREATE TABLE external_service_checks (
 service_id TEXT PRIMARY KEY REFERENCES external_services(id),
 snapshot JSONB NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(snapshot) = 'object' AND octet_length(snapshot::text) <= 262144),
 checked_at TIMESTAMPTZ,
 checked_by INTEGER REFERENCES user_profiles(id) ON DELETE SET NULL,
 lease_token UUID,
 lease_expires_at TIMESTAMPTZ,
 CHECK (service_id IN ('assemblyai','anthropic','serpapi')),
 CHECK ((lease_token IS NULL) = (lease_expires_at IS NULL))
);
