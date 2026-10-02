import {
  TRANSCRIPTION_JOB_LABELS, TRANSCRIPTION_JOB_STATUSES, TRANSCRIPTION_JOB_STATUS,
  projectOwnerTranscriptionJob,
} from '../../lib/services/transcription-pilot/model.js';
import { createTranscriptionPilotStore } from '../../lib/services/transcription-pilot/store.js';

function fakeDatabase() {
  return {
    query: jest.fn(async () => ({ rows: [] })),
    transaction: jest.fn(async fn => fn({ query: jest.fn(async () => ({ rows: [] })) })),
  };
}

describe('transcription pilot persistence contract', () => {
  it('has an explicit label for every persisted state', () => {
    expect(Object.keys(TRANSCRIPTION_JOB_LABELS).sort()).toEqual([...TRANSCRIPTION_JOB_STATUSES].sort());
    expect(TRANSCRIPTION_JOB_LABELS.submission_uncertain).toBe('Needs attention');
    expect(TRANSCRIPTION_JOB_LABELS.submitting).toBe('Transcribing');
  });

  it('redacts content immediately on DELETE or expiry and never returns paths/provider IDs', () => {
    const row = {
      id: 'job', status: TRANSCRIPTION_JOB_STATUS.READY, version: 4,
      original_filename: 'private-name.m4a', correction_notes: 'sensitive correction',
      speaker_names: { A: 'Private speaker name' },
      output_pathname: 'transcription-pilot/job/output.json',
      input_cleanup_pathname: 'transcription-pilot/job/input.m4a',
      provider_transcript_id: 'provider-secret-id', provider_upload_ref_ciphertext: 'ciphertext',
      lease_token: 'lease', cleanup_requested_at: new Date(), expires_at: new Date(Date.now() + 60000),
      local_cleanup_completed_at: null, provider_cleanup_completed_at: null,
    };
    const projected = projectOwnerTranscriptionJob(row);
    expect(projected.original_filename).toBeNull();
    expect(projected.correction_notes).toBeNull();
    expect(projected.speaker_names).toBeNull();
    expect(projected.contentAccessAllowed).toBe(false);
    expect(projected.cleanupPending).toBe(true);
    expect(projected.providerCleanupPending).toBe(true);
    for (const secret of ['output_pathname', 'input_cleanup_pathname', 'provider_transcript_id', 'provider_upload_ref_ciphertext', 'lease_token']) {
      expect(projected).not.toHaveProperty(secret);
    }

    const expired = projectOwnerTranscriptionJob({ ...row, cleanup_requested_at: null, expires_at: new Date(Date.now() - 1) });
    expect(expired.original_filename).toBeNull();
    expect(expired.correction_notes).toBeNull();
    expect(expired.speaker_names).toBeNull();
  });

  it('rejects lease-field injection before it reaches SQL', async () => {
    const db = fakeDatabase();
    const store = createTranscriptionPilotStore(db);
    await expect(store.mutateLeasedJob({
      jobId: '00000000-0000-4000-8000-000000000001',
      leaseToken: '00000000-0000-4000-8000-000000000002',
      expectedVersion: 1,
      expectedStatuses: ['queued'],
      fields: { lease_token: '00000000-0000-4000-8000-000000000003' },
    })).rejects.toMatchObject({ code: 'transcription_immutable_field', httpStatus: 400 });
    expect(db.query).not.toHaveBeenCalled();
  });

  it('stores speaker-name overlays under owner, version, ready, cleanup and expiry fences', async () => {
    const db = fakeDatabase();
    const store = createTranscriptionPilotStore(db);
    await store.updateSpeakerNames({ jobId: '00000000-0000-4000-8000-000000000001', ownerProfileId: 7,
      expectedVersion: 8, speakerNames: { A: 'Chair' } });
    const [query, params] = db.query.mock.calls[0];
    expect(query).toMatch(/WHERE id = \$1 AND owner_profile_id = \$2 AND version = \$3/);
    expect(query).toMatch(/status = 'ready' AND output_pathname IS NOT NULL/);
    expect(query).toMatch(/cleanup_requested_at IS NULL AND content_purged_at IS NULL/);
    expect(query).toMatch(/expires_at > NOW\(\) AND receipt_expires_at > NOW\(\)/);
    expect(params).toEqual(['00000000-0000-4000-8000-000000000001', 7, 8, '{"A":"Chair"}']);
  });

  it('saves correction labels and the version predicate using distinct SQL parameter bindings', async () => {
    const db = fakeDatabase();
    const store = createTranscriptionPilotStore(db);
    await store.updateMeetingCorrectionDraft({
      operationId: '00000000-0000-4000-8000-000000000001',
      requestId: '00000000-0000-4000-8000-000000000002',
      siteVisitActivityId: '00000000-0000-4000-8000-000000000003',
      actorProfileId: 12, expectedVersion: 3, speakerNames: { A: 'Chair' },
    });
    const [query, params] = db.query.mock.calls[0];
    expect(query).toMatch(/WHERE operation_id = \$1 AND request_id = \$2 AND site_visit_activity_id = \$3/);
    expect(query).toMatch(/state = 'draft' AND expires_at > NOW\(\)/);
    expect(query).toMatch(/AND version = \$5 RETURNING/);
    expect(query).toMatch(/SET speaker_names = \$4::jsonb/);
    expect(query).not.toMatch(/initiator_profile_id =/);
    expect(params).toEqual([
      '00000000-0000-4000-8000-000000000001',
      '00000000-0000-4000-8000-000000000002',
      '00000000-0000-4000-8000-000000000003', '{"A":"Chair"}', 3,
    ]);
  });

  it('requires a frozen input hash and deterministic Tracker candidate paths before taking a job lease', async () => {
    const db = fakeDatabase();
    const store = createTranscriptionPilotStore(db);
    await expect(store.freezeMeetingPublicationFromJob({
      operationId: '00000000-0000-4000-8000-000000000001',
      jobId: '00000000-0000-4000-8000-000000000002',
      requestId: '00000000-0000-4000-8000-000000000003',
      siteVisitActivityId: '00000000-0000-4000-8000-000000000004',
      initiatorProfileId: 12, publishedByProfileId: 12, expectedVersion: 4,
      frozenInputSha256: 'A'.repeat(64), formatterVersion: '1', candidatePaths: {
        txt: 'bad/path', vtt: 'bad/path', source: 'bad/path',
      },
    })).rejects.toMatchObject({ code: 'transcription_invalid_value', httpStatus: 400 });
    expect(db.transaction).not.toHaveBeenCalled();
  });

  it('serializes request publication freezes and rejects any unresolved receipt independently of job linkage', async () => {
    const tx = { query: jest.fn(async () => ({ rows: [] })) };
    const db = { query: jest.fn(async () => ({ rows: [] })), transaction: jest.fn(async fn => fn(tx)) };
    const store = createTranscriptionPilotStore(db);
    await store.freezeMeetingPublicationFromJob({
      operationId: '00000000-0000-4000-8000-000000000001',
      jobId: '00000000-0000-4000-8000-000000000002',
      requestId: '00000000-0000-4000-8000-000000000003',
      siteVisitActivityId: '00000000-0000-4000-8000-000000000004',
      initiatorProfileId: 12, publishedByProfileId: 12,
      actingUserSystemId: '00000000-0000-4000-8000-000000000005', expectedVersion: 4,
      frozenInputSha256: 'a'.repeat(64), formatterVersion: '1', candidatePaths: {
        txt: `folder/00000000-0000-4000-8000-000000000001.txt`,
        vtt: `folder/00000000-0000-4000-8000-000000000001.vtt`,
        source: `folder/00000000-0000-4000-8000-000000000001.json`,
      },
    });
    expect(tx.query).toHaveBeenCalledTimes(2);
    expect(tx.query.mock.calls[0][0]).toMatch(/pg_advisory_xact_lock/);
    expect(tx.query.mock.calls[1][0]).toMatch(/NOT EXISTS[\s\S]*p\.request_id = \$3[\s\S]*'published_reconcile'/);
  });

  it('claims recovery only for a complete verified file set and binds the original fence', async () => {
    const tx = { query: jest.fn(async () => ({ rows: [] })) };
    const db = { query: jest.fn(async () => ({ rows: [] })), transaction: jest.fn(async fn => fn(tx)) };
    const store = createTranscriptionPilotStore(db);
    await store.claimMeetingPublicationForRecovery({
      operationId: '00000000-0000-4000-8000-000000000001',
      requestId: '00000000-0000-4000-8000-000000000002',
      siteVisitActivityId: '00000000-0000-4000-8000-000000000003',
    });
    expect(tx.query.mock.calls[0][0]).toMatch(/verified_files \?& ARRAY\['source','txt','vtt'\]/);
    expect(tx.query.mock.calls[0][0]).toMatch(/slot_fence_version IS NOT NULL/);
    expect(tx.query.mock.calls[0][0]).toMatch(/quarantine_until = GREATEST\(quarantine_until, NOW\(\).*INTERVAL '10 minutes'/);
  });

  it('closes a zero-write publication only with no fence/files and releases the exact active job lease', async () => {
    const publication = { operation_id: '00000000-0000-4000-8000-000000000001',
      request_id: '00000000-0000-4000-8000-000000000003',
      site_visit_activity_id: '00000000-0000-4000-8000-000000000004',
      input_job_id: '00000000-0000-4000-8000-000000000002' };
    const tx = { query: jest.fn()
      .mockResolvedValueOnce({ rows: [publication] })
      .mockResolvedValueOnce({ rows: [{ id: publication.input_job_id }] })
      .mockResolvedValueOnce({ rows: [{ ...publication, state: 'closed', closed_by_profile_id: 12 }] }) };
    const db = { query: jest.fn(), transaction: jest.fn(async fn => fn(tx)) };
    const store = createTranscriptionPilotStore(db);
    await expect(store.closeMeetingPublicationWithoutWrites({ operationId: publication.operation_id,
      requestId: publication.request_id, siteVisitActivityId: publication.site_visit_activity_id,
      leaseToken: publication.operation_id, actorProfileId: 12 })).resolves.toMatchObject({
      state: 'closed', closed_by_profile_id: 12,
    });
    expect(tx.query.mock.calls[0][0]).toMatch(/state = 'publishing'.*slot_fence_version IS NULL/s);
    expect(tx.query.mock.calls[0][0]).toMatch(/COALESCE\(verified_files, '\{\}'::jsonb\) = '\{\}'::jsonb/);
    expect(tx.query.mock.calls[1][0]).toMatch(/publication_operation_id = \$4 AND lease_token = \$5 AND lease_expires_at > NOW\(\)/);
    expect(tx.query.mock.calls[2][0]).toMatch(/closed_by_profile_id = \$5/);
    expect(tx.query.mock.calls[2][0]).toMatch(/slot_fence_version IS NULL AND COALESCE\(verified_files/);
  });

  it('refuses zero-write closure when any candidate descriptor is already persisted', async () => {
    const tx = { query: jest.fn(async () => ({ rows: [] })) };
    const db = { query: jest.fn(), transaction: jest.fn(async fn => fn(tx)) };
    const store = createTranscriptionPilotStore(db);
    await expect(store.closeMeetingPublicationWithoutWrites({ operationId: '00000000-0000-4000-8000-000000000001',
      requestId: '00000000-0000-4000-8000-000000000003',
      siteVisitActivityId: '00000000-0000-4000-8000-000000000004',
      leaseToken: '00000000-0000-4000-8000-000000000001', actorProfileId: 12 })).resolves.toBeNull();
    expect(tx.query).toHaveBeenCalledTimes(1);
  });

  it('permits a later freeze after transactional zero-write closure of the prior receipt', async () => {
    const op = '00000000-0000-4000-8000-000000000001';
    const request = '00000000-0000-4000-8000-000000000003';
    const visit = '00000000-0000-4000-8000-000000000004';
    const jobId = '00000000-0000-4000-8000-000000000002';
    const closeTx = { query: jest.fn()
      .mockResolvedValueOnce({ rows: [{ operation_id: op, request_id: request, site_visit_activity_id: visit,
        input_job_id: jobId }] })
      .mockResolvedValueOnce({ rows: [{ id: jobId }] })
      .mockResolvedValueOnce({ rows: [{ operation_id: op, state: 'closed' }] }) };
    const freezeTx = { query: jest.fn()
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ id: jobId, speaker_names: {} }] })
      .mockResolvedValueOnce({ rows: [{ version: 12 }] })
      .mockResolvedValueOnce({ rows: [{ operation_id: '99999999-9999-4999-8999-999999999999', state: 'publishing' }] }) };
    const db = { query: jest.fn(), transaction: jest.fn()
      .mockImplementationOnce(async fn => fn(closeTx))
      .mockImplementationOnce(async fn => fn(freezeTx)) };
    const store = createTranscriptionPilotStore(db);
    await expect(store.closeMeetingPublicationWithoutWrites({ operationId: op, requestId: request, siteVisitActivityId: visit,
      leaseToken: op, actorProfileId: 12 })).resolves.toMatchObject({ state: 'closed' });
    await expect(store.freezeMeetingPublicationFromJob({ operationId: '99999999-9999-4999-8999-999999999999',
      jobId, requestId: request, siteVisitActivityId: visit, initiatorProfileId: 12, publishedByProfileId: 12,
      actingUserSystemId: '00000000-0000-4000-8000-000000000005', expectedVersion: 11,
      frozenInputSha256: 'a'.repeat(64), formatterVersion: '1', candidatePaths: {
        txt: `folder/${'99999999-9999-4999-8999-999999999999'}.txt`,
        vtt: `folder/${'99999999-9999-4999-8999-999999999999'}.vtt`,
        source: `folder/${'99999999-9999-4999-8999-999999999999'}.json`,
      } })).resolves.toMatchObject({ jobLeaseToken: expect.any(String) });
    expect(freezeTx.query.mock.calls[1][0]).toMatch(/p\.state IN \('publishing','retryable','unknown','published_reconcile'\)/);
    expect(freezeTx.query.mock.calls[1][0]).not.toMatch(/p\.state IN \([^)]*'closed'/);
    expect(freezeTx.query.mock.calls[3][0]).toMatch(/candidate_paths, quarantine_until/);
    expect(freezeTx.query.mock.calls[3][0]).toMatch(/NOW\(\) \+ \(\$14 \|\| ' seconds'\)::interval \+ INTERVAL '10 minutes'/);
  });

  it('quarantine close is versioned, expiry-gated, and preserves candidate identities', async () => {
    const receipt = { operation_id: '00000000-0000-4000-8000-000000000001',
      request_id: '00000000-0000-4000-8000-000000000003',
      site_visit_activity_id: '00000000-0000-4000-8000-000000000004',
      input_job_id: '00000000-0000-4000-8000-000000000002', version: 9, lease_token: 'old-token',
      candidate_paths: { txt: 'request/transcript.txt' }, verified_files: { txt: { itemId: 'retained' } } };
    const tx = { query: jest.fn()
      .mockResolvedValueOnce({ rows: [receipt] })
      .mockResolvedValueOnce({ rows: [{ lease_token: 'different-manual-winner', active: true }] })
      .mockResolvedValueOnce({ rows: [{ id: receipt.input_job_id, lease_token: 'old-token', quarantine_passed: true,
        publication_operation_id: receipt.operation_id }] })
      .mockResolvedValueOnce({ rows: [{ id: receipt.input_job_id }] })
      .mockResolvedValueOnce({ rows: [{ ...receipt, state: 'closed', closed_by_profile_id: 12 }] }) };
    const db = { query: jest.fn(), transaction: jest.fn(async fn => fn(tx)) };
    const store = createTranscriptionPilotStore(db);
    await expect(store.closeMeetingPublicationAfterQuarantine({ operationId: receipt.operation_id,
      requestId: receipt.request_id, siteVisitActivityId: receipt.site_visit_activity_id,
      expectedVersion: 9, actorProfileId: 12, artifactType: 100000006 })).resolves.toMatchObject({
      state: 'closed', closed_by_profile_id: 12, candidate_paths: receipt.candidate_paths,
      verified_files: receipt.verified_files,
    });
    expect(tx.query.mock.calls[0][0]).toMatch(/version = \$4 AND quarantine_until <= NOW\(\)/);
    expect(tx.query.mock.calls[0][0]).toMatch(/lease_expires_at IS NULL OR lease_expires_at <= NOW\(\)/);
    expect(tx.query.mock.calls[1][1]).toEqual([receipt.request_id, 100000006]);
    expect(tx.query.mock.calls[2][0]).toMatch(/FOR UPDATE/);
    expect(tx.query.mock.calls[3][0]).toMatch(/publication_operation_id = \$2 AND lease_token = \$3/);
  });

  it.each(['slot', 'job'])('refuses closure until the matching %s lease quarantine has passed', async (kind) => {
    const op = '00000000-0000-4000-8000-000000000001';
    const requestId = '00000000-0000-4000-8000-000000000003';
    const siteVisitActivityId = '00000000-0000-4000-8000-000000000004';
    const receipt = { operation_id: op, request_id: requestId, site_visit_activity_id: siteVisitActivityId,
      input_job_id: '00000000-0000-4000-8000-000000000002', lease_token: 'original-token' };
    const tx = { query: jest.fn().mockResolvedValueOnce({ rows: [receipt] })
      .mockResolvedValueOnce({ rows: kind === 'slot' ? [{ lease_token: op, quarantine_passed: false }] : [] })
      .mockResolvedValueOnce({ rows: [{ id: receipt.input_job_id, lease_token: 'original-token',
        publication_operation_id: op, quarantine_passed: false }] }) };
    const store = createTranscriptionPilotStore({ query: jest.fn(), transaction: async fn => fn(tx) });
    await expect(store.closeMeetingPublicationAfterQuarantine({ operationId: op, requestId,
      siteVisitActivityId, expectedVersion: 9, actorProfileId: 12, artifactType: 100000006 })).resolves.toBeNull();
    expect(tx.query).toHaveBeenCalledTimes(kind === 'slot' ? 2 : 3);
    expect(tx.query.mock.calls[1][0]).toMatch(/lease_expires_at \+ INTERVAL '10 minutes' <= NOW\(\)/);
    if (kind === 'job') expect(tx.query.mock.calls[2][0]).toMatch(/lease_expires_at \+ INTERVAL '10 minutes' <= NOW\(\)/);
  });

  it('does not release an unrelated cleanup lease even when the job retains an old publication binding', async () => {
    const op = '00000000-0000-4000-8000-000000000001';
    const requestId = '00000000-0000-4000-8000-000000000003';
    const siteVisitActivityId = '00000000-0000-4000-8000-000000000004';
    const receipt = { operation_id: op, request_id: requestId, site_visit_activity_id: siteVisitActivityId,
      input_job_id: '00000000-0000-4000-8000-000000000002', lease_token: 'original-token' };
    const tx = { query: jest.fn().mockResolvedValueOnce({ rows: [receipt] }).mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ id: receipt.input_job_id, lease_token: 'cleanup-token',
        publication_operation_id: op, quarantine_passed: false }] })
      .mockResolvedValueOnce({ rows: [{ ...receipt, state: 'closed' }] }) };
    const store = createTranscriptionPilotStore({ query: jest.fn(), transaction: async fn => fn(tx) });
    await expect(store.closeMeetingPublicationAfterQuarantine({ operationId: op, requestId,
      siteVisitActivityId, expectedVersion: 9, actorProfileId: 12, artifactType: 100000006 })).resolves.toMatchObject({ state: 'closed' });
    expect(tx.query.mock.calls.some(([sql]) => /UPDATE transcription_jobs/.test(sql))).toBe(false);
  });

  it('persists crash-safe quarantine deadlines on correction freeze and every publication lease renewal', async () => {
    const operationId = '00000000-0000-4000-8000-000000000001';
    const requestId = '00000000-0000-4000-8000-000000000003';
    const siteVisitActivityId = '00000000-0000-4000-8000-000000000004';
    const tx = { query: jest.fn(async () => ({ rows: [{ version: 2 }] })) };
    const db = { query: jest.fn(async () => ({ rows: [] })), transaction: async fn => fn(tx) };
    const store = createTranscriptionPilotStore(db);
    await store.freezeMeetingCorrectionDraft({ operationId, requestId, siteVisitActivityId, actorProfileId: 12,
      actingUserSystemId: '00000000-0000-4000-8000-000000000005', expectedVersion: 1,
      frozenInputSha256: 'a'.repeat(64), candidatePaths: {
        txt: `folder/${operationId}.txt`, vtt: `folder/${operationId}.vtt`, source: `folder/${operationId}.json`,
      } });
    await store.renewMeetingPublicationJobLease({ operationId, jobId: requestId, leaseToken: operationId, expectedVersion: 1 });
    await store.renewMeetingPublicationReceiptLease({ operationId, leaseToken: operationId });
    for (const sql of [tx.query.mock.calls[0][0], tx.query.mock.calls[2][0], db.query.mock.calls[0][0]]) {
      expect(sql).toMatch(/quarantine_until = GREATEST\(quarantine_until, NOW\(\).*INTERVAL '10 minutes'/);
    }
  });

  it.each([
    null, ['not', 'a map'], { 'bad speaker': 'Name' }, { A: 'x'.repeat(81) }, { A: 'Name\nInjected' },
  ])('rejects malformed speaker overlays before SQL: %j', async (speakerNames) => {
    const db = fakeDatabase();
    const store = createTranscriptionPilotStore(db);
    await expect(store.updateSpeakerNames({ jobId: '00000000-0000-4000-8000-000000000001', ownerProfileId: 7,
      expectedVersion: 8, speakerNames })).rejects.toMatchObject({ code: 'transcription_invalid_value', httpStatus: 400 });
    expect(db.query).not.toHaveBeenCalled();
  });

  it('creates a workflow outbox record in the same queue transition query', async () => {
    const db = fakeDatabase();
    const store = createTranscriptionPilotStore(db);
    await store.queueJob({
      jobId: '00000000-0000-4000-8000-000000000001', ownerProfileId: 7,
      expectedVersion: 2, acknowledgementAt: new Date(), verifiedContentType: 'audio/mp4',
      verifiedBytes: 8192, durationMs: 5000, sha256: 'a'.repeat(64), etag: 'opaque-etag',
    });
    const [query, params] = db.query.mock.calls[0];
    expect(query).toMatch(/WITH queued AS \(\s*UPDATE transcription_jobs SET/s);
    expect(query).toMatch(/INSERT INTO transcription_workflow_dispatches \(job_id\)/);
    expect(query).toMatch(/SELECT id FROM queued/);
    expect(params[0]).toBe('00000000-0000-4000-8000-000000000001');
  });

  it('allows a handed-off workflow to recover a still-leased submitting job without reposting it', async () => {
    const db = fakeDatabase();
    const store = createTranscriptionPilotStore(db);
    await store.claimWorkflowDispatch({ jobId: '00000000-0000-4000-8000-000000000001' });
    const [query] = db.query.mock.calls[0];
    expect(query).toMatch(/job\.status IN \('queued','submitting','processing','saving','submission_uncertain'\)/);
    expect(query).toMatch(/AND job\.cleanup_requested_at IS NULL/);
  });

  it('lists active durable run metadata without treating an old heartbeat as failure', async () => {
    const db = fakeDatabase();
    const store = createTranscriptionPilotStore(db);
    await store.listRunningWorkflowDispatches({ limit: 20 });
    const [query, params] = db.query.mock.calls[0];
    expect(query).toMatch(/dispatch\.state = 'running' AND dispatch\.workflow_run_id IS NOT NULL/);
    expect(query).toMatch(/ORDER BY dispatch\.updated_at, dispatch\.job_id/);
    expect(query).not.toMatch(/updated_at < NOW\(\) - INTERVAL/);
    expect(query).toMatch(/job\.status IN \('queued','submitting','processing','saving'\)/);
    expect(query).toMatch(/job\.provider_id_conflict = FALSE/);
    expect(params).toEqual([20]);
  });

  it('recovers only a terminal run matching the current run id and attempt generation', async () => {
    const db = fakeDatabase();
    const store = createTranscriptionPilotStore(db);
    const jobId = '00000000-0000-4000-8000-000000000001';
    await store.recoverTerminalWorkflowDispatch({
      jobId, workflowRunId: 'run_fixture_old', attemptNo: 9, terminalStatus: 'failed',
    });
    const [query, params] = db.query.mock.calls[0];
    expect(query).toMatch(/dispatch\.state = 'running' AND dispatch\.workflow_run_id = \$2 AND dispatch\.attempt_no = \$3/);
    expect(query).toMatch(/job\.cleanup_requested_at IS NULL/);
    expect(query).toMatch(/job\.expires_at > NOW\(\)/);
    expect(query).toMatch(/job\.provider_id_conflict = FALSE/);
    expect(query).toMatch(/dispatch_token = NULL, lease_expires_at = NULL, workflow_run_id = NULL/);
    expect(params).toEqual([jobId, 'run_fixture_old', 9, 'workflow_failed']);
  });

  it('rejects unknown Workflow terminal states before SQL', async () => {
    const db = fakeDatabase();
    const store = createTranscriptionPilotStore(db);
    await expect(store.recoverTerminalWorkflowDispatch({
      jobId: '00000000-0000-4000-8000-000000000001', workflowRunId: 'run_fixture',
      attemptNo: 1, terminalStatus: 'workflow_suspended',
    })).rejects.toMatchObject({ code: 'transcription_invalid_value' });
    expect(db.query).not.toHaveBeenCalled();
  });

  it('fences dispatch acknowledgement and errors with opaque attempt tokens', async () => {
    const db = fakeDatabase();
    const store = createTranscriptionPilotStore(db);
    const id = '00000000-0000-4000-8000-000000000001';
    const token = '00000000-0000-4000-8000-000000000002';
    await expect(store.acknowledgeWorkflowDispatch({ jobId: id, dispatchToken: token, attemptNo: 1,
      workflowRunId: 'run_opaque_1' })).resolves.toBeNull();
    const [ackSql, ackParams] = db.query.mock.calls[0];
    expect(ackSql).toMatch(/WHERE job_id = \$1 AND dispatch_token = \$2 AND attempt_no = \$3/);
    expect(ackSql).toMatch(/state = 'dispatching' AND lease_expires_at > NOW\(\)/);
    expect(ackParams.slice(0, 4)).toEqual([id, token, 1, 'run_opaque_1']);

    await expect(store.failWorkflowDispatch({ jobId: id, dispatchToken: token, attemptNo: 1,
      errorCode: 'workflow_start_failed' })).resolves.toBeNull();
    const [failSql] = db.query.mock.calls[1];
    expect(failSql).toMatch(/WHERE job_id = \$1 AND dispatch_token = \$2 AND attempt_no = \$3/);
    await expect(store.failWorkflowDispatch({ jobId: id, dispatchToken: token, attemptNo: 1,
      errorCode: 'raw Provider message' })).rejects.toMatchObject({ code: 'transcription_invalid_value' });
    expect(db.query).toHaveBeenCalledTimes(2);
  });

  it('atomically rearms completed dispatches when verified reconciliation restores provider work', async () => {
    const db = fakeDatabase();
    const store = createTranscriptionPilotStore(db);
    await store.reconcileVerifiedProviderId({
      jobId: '00000000-0000-4000-8000-000000000001', ownerProfileId: 7,
      leaseToken: '00000000-0000-4000-8000-000000000002', expectedVersion: 4,
      providerTranscriptId: 'verified-provider-id',
    });
    const [query] = db.query.mock.calls[0];
    expect(query).toMatch(/WITH reconciled AS \(\s*UPDATE transcription_jobs SET/s);
    expect(query).toMatch(/UPDATE transcription_workflow_dispatches dispatch SET state = 'pending'/);
    expect(query).toMatch(/dispatch_token = NULL, lease_expires_at = NULL/);
    expect(query).not.toMatch(/dispatch\.state IN \('completed', 'pending'\)/);
  });

  it('suppresses populated evaluation metadata after receipt expiry without waiting for cron', () => {
    const row = { status: 'failed', receipt_expires_at: new Date(Date.now() - 1),
      original_filename: 'meeting.mp3', declared_bytes: 500, verified_bytes: 500,
      audio_duration_ms: 60000, requested_model: 'universal-2', returned_model: 'universal-2',
      word_accuracy_score: 5, speaker_accuracy_score: 4, correction_notes: 'notes',
      cleanup_requested_at: new Date(), local_cleanup_completed_at: null };
    const dto = projectOwnerTranscriptionJob(row);
    for (const key of ['original_filename', 'declared_bytes', 'verified_bytes', 'audio_duration_ms',
      'requested_model', 'returned_model', 'word_accuracy_score', 'speaker_accuracy_score', 'correction_notes']) expect(dto[key]).toBeNull();
    expect(dto.cleanupPending).toBe(true);
  });
});
