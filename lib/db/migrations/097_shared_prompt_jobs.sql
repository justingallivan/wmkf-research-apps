-- Shared Executor synthetic trial. Number 096 belongs to the J27 stream.
CREATE TABLE prompt_jobs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  environment TEXT NOT NULL CHECK (length(environment) BETWEEN 1 AND 32),
  principal_key TEXT NOT NULL CHECK (length(principal_key) BETWEEN 1 AND 200),
  authorization_scope TEXT NOT NULL CHECK (length(authorization_scope) BETWEEN 1 AND 200),
  request_id UUID NOT NULL,
  idempotency_key UUID NOT NULL,
  payload_hash TEXT NOT NULL CHECK (payload_hash ~ '^[a-f0-9]{64}$'),
  operation TEXT NOT NULL CHECK (operation IN ('initialize', 'generate-draft')),
  source_event_id TEXT CHECK (length(source_event_id) BETWEEN 1 AND 200),
  source_expires_at TIMESTAMPTZ NOT NULL,
  result_expires_at TIMESTAMPTZ NOT NULL,
  snapshot_content_id UUID,
  snapshot_hash TEXT CHECK (snapshot_hash ~ '^[a-f0-9]{64}$'),
  target_etag TEXT CHECK (length(target_etag) BETWEEN 1 AND 200),
  lease_token UUID,
  lease_expires_at TIMESTAMPTZ,
  version INTEGER NOT NULL DEFAULT 1 CHECK (version > 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (environment, principal_key, idempotency_key),
  UNIQUE (id, environment, request_id),
  CHECK (operation <> 'initialize' OR source_event_id IS NOT NULL),
  CHECK (source_expires_at <= result_expires_at),
  CHECK ((snapshot_content_id IS NULL) = (snapshot_hash IS NULL)),
  CHECK ((lease_token IS NULL) = (lease_expires_at IS NULL))
);

CREATE INDEX idx_prompt_jobs_request ON prompt_jobs (environment, request_id);
CREATE UNIQUE INDEX idx_prompt_jobs_one_request_lease
  ON prompt_jobs (environment, request_id) WHERE lease_token IS NOT NULL;

-- Receipt references intentionally survive deletion of the corresponding content row.
CREATE TABLE prompt_job_content (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id UUID NOT NULL REFERENCES prompt_jobs(id),
  kind TEXT NOT NULL CHECK (kind IN ('configuration', 'snapshot', 'response', 'result', 'audit', 'publication')),
  payload TEXT NOT NULL,
  sha256 TEXT NOT NULL CHECK (sha256 ~ '^[a-f0-9]{64}$'),
  size_bytes INTEGER NOT NULL CHECK (size_bytes BETWEEN 1 AND 4194304 AND size_bytes = octet_length(payload)),
  expires_at TIMESTAMPTZ NOT NULL
);

CREATE INDEX idx_prompt_job_content_expiry ON prompt_job_content (expires_at, id);

CREATE TABLE prompt_job_tasks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id UUID NOT NULL REFERENCES prompt_jobs(id),
  task_key TEXT NOT NULL CHECK (length(task_key) BETWEEN 1 AND 80),
  destination_field TEXT CHECK (destination_field ~ '^[a-z][a-z0-9_]{0,127}$'),
  prompt_hash TEXT NOT NULL CHECK (prompt_hash ~ '^[a-f0-9]{64}$'),
  profile_hash TEXT NOT NULL CHECK (profile_hash ~ '^[a-f0-9]{64}$'),
  model TEXT NOT NULL CHECK (length(model) BETWEEN 1 AND 120),
  configuration_content_id UUID NOT NULL,
  configuration_hash TEXT NOT NULL CHECK (configuration_hash ~ '^[a-f0-9]{64}$'),
  state TEXT NOT NULL DEFAULT 'queued' CHECK (state IN (
    'queued', 'dispatching', 'response_saved', 'validated', 'failed_pre_dispatch', 'failed_validation', 'unknown', 'expired'
  )),
  writeback_state TEXT NOT NULL CHECK (writeback_state IN (
    'not_requested', 'pending', 'blocked', 'applied', 'conflict', 'unknown', 'expired'
  )),
  result_content_id UUID,
  result_hash TEXT CHECK (result_hash ~ '^[a-f0-9]{64}$'),
  error_code TEXT CHECK (error_code ~ '^[a-z][a-z0-9_]{0,79}$'),
  UNIQUE (job_id, task_key),
  UNIQUE (job_id, destination_field),
  UNIQUE (id, job_id),
  CHECK ((result_content_id IS NULL) = (result_hash IS NULL)),
  CHECK ((state = 'validated') = (result_content_id IS NOT NULL))
);

CREATE UNIQUE INDEX idx_prompt_job_tasks_one_dispatch
  ON prompt_job_tasks (job_id) WHERE state = 'dispatching';

CREATE TABLE prompt_job_attempts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id UUID NOT NULL REFERENCES prompt_job_tasks(id),
  attempt_number INTEGER NOT NULL DEFAULT 1 CHECK (attempt_number > 0),
  audit_run_id UUID NOT NULL UNIQUE DEFAULT gen_random_uuid(),
  state TEXT NOT NULL CHECK (state IN (
    'dispatching', 'response_saved', 'validated', 'failed_pre_dispatch', 'failed_validation', 'unknown', 'expired'
  )),
  response_content_id UUID,
  response_hash TEXT CHECK (response_hash ~ '^[a-f0-9]{64}$'),
  audit_content_id UUID,
  audit_hash TEXT CHECK (audit_hash ~ '^[a-f0-9]{64}$'),
  audit_state TEXT NOT NULL DEFAULT 'none' CHECK (audit_state IN ('none', 'pending', 'dispatching', 'delivered', 'failed', 'unknown')),
  usage JSONB CHECK (jsonb_typeof(usage) = 'object'),
  usage_complete BOOLEAN,
  error_code TEXT CHECK (error_code ~ '^[a-z][a-z0-9_]{0,79}$'),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (task_id, attempt_number),
  CHECK ((response_content_id IS NULL) = (response_hash IS NULL)),
  CHECK ((audit_content_id IS NULL) = (audit_hash IS NULL)),
  CHECK ((audit_state = 'none') = (audit_content_id IS NULL)),
  CHECK (state NOT IN ('response_saved', 'validated', 'failed_validation') OR response_content_id IS NOT NULL)
);

CREATE UNIQUE INDEX idx_prompt_job_attempts_one_unresolved
  ON prompt_job_attempts (task_id) WHERE state IN ('dispatching', 'unknown');

CREATE TABLE prompt_job_initializations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id UUID NOT NULL,
  task_id UUID NOT NULL UNIQUE,
  environment TEXT NOT NULL,
  request_id UUID NOT NULL,
  destination_field TEXT NOT NULL CHECK (destination_field ~ '^[a-z][a-z0-9_]{0,127}$'),
  initial_content_hash TEXT CHECK (initial_content_hash ~ '^[a-f0-9]{64}$'),
  initially_blank BOOLEAN,
  released_at TIMESTAMPTZ,
  FOREIGN KEY (job_id, environment, request_id) REFERENCES prompt_jobs(id, environment, request_id),
  FOREIGN KEY (task_id, job_id) REFERENCES prompt_job_tasks(id, job_id),
  CHECK ((initial_content_hash IS NULL) = (initially_blank IS NULL))
);

CREATE UNIQUE INDEX idx_prompt_job_initializations_one_slot
  ON prompt_job_initializations (environment, request_id, destination_field) WHERE released_at IS NULL;

CREATE TABLE prompt_job_publications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id UUID NOT NULL UNIQUE REFERENCES prompt_jobs(id),
  expected_etag TEXT NOT NULL CHECK (length(expected_etag) BETWEEN 1 AND 200),
  payload_content_id UUID NOT NULL,
  payload_hash TEXT NOT NULL CHECK (payload_hash ~ '^[a-f0-9]{64}$'),
  task_ids UUID[] NOT NULL CHECK (cardinality(task_ids) BETWEEN 1 AND 8),
  initialization_ids UUID[] NOT NULL CHECK (cardinality(initialization_ids) = cardinality(task_ids)),
  state TEXT NOT NULL DEFAULT 'ready' CHECK (state IN ('ready', 'dispatching', 'applied', 'conflict', 'unknown', 'expired')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
