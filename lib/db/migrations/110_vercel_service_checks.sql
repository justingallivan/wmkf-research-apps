-- Expand the manual-check allowlist without changing existing snapshots or reviews.
SET LOCAL lock_timeout = '5s';
ALTER TABLE external_service_checks DROP CONSTRAINT external_service_checks_service_id_check;
ALTER TABLE external_service_checks ADD CONSTRAINT external_service_checks_service_id_check
 CHECK (service_id IN ('assemblyai','anthropic','serpapi','openai','vercel-hosting'));
