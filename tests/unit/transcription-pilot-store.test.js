jest.mock('@vercel/blob', () => ({ del: jest.fn(), get: jest.fn(), put: jest.fn() }));
jest.mock('@vercel/blob/client', () => ({ generateClientTokenFromReadWriteToken: jest.fn() }));
import {
  TRANSCRIPTION_JOB_LABELS, TRANSCRIPTION_JOB_STATUSES, TRANSCRIPTION_JOB_STATUS,
  projectOwnerTranscriptionJob,
} from '../../lib/services/transcription-pilot/model.js';
import { createTranscriptionPilotStore } from '../../lib/services/transcription-pilot/store.js';

const NON_RFC_REQUEST_ID = '4236c2b3-b053-f111-bec7-6045bd015cb0';
const NON_RFC_SITE_VISIT_ID = '38bf47c0-c1aa-46fc-b9d0-167aa76ad962';
const NON_RFC_ACTOR_ID = '29b0de0d-4ff7-ee11-a1fd-000d3a3621c7';
const NON_RFC_DOCUMENT_ID = 'a923b5ed-60f4-f111-9b0d-6045bd015cb0';

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
      content_purged_at: new Date(), upload_valid_until: new Date(Date.now() + 60000),
    };
    const projected = projectOwnerTranscriptionJob(row);
    expect(projected.original_filename).toBeNull();
    expect(projected.correction_notes).toBeNull();
    expect(projected.speaker_names).toBeNull();
    expect(projected.contentAccessAllowed).toBe(false);
    expect(projected.cleanupPending).toBe(true);
    expect(projected.providerCleanupPending).toBe(true);
    expect(projected.contentDeletionObserved).toBe(true);
    expect(projected.lateUploadWatchPending).toBe(true);
    for (const secret of ['output_pathname', 'input_cleanup_pathname', 'upload_valid_until', 'provider_transcript_id', 'provider_upload_ref_ciphertext', 'lease_token',
      'zoom_transcript_pathname', 'zoom_transcript_sha256', 'zoom_transcript_cleanup_pathname']) {
      expect(projected).not.toHaveProperty(secret);
    }

    const expired = projectOwnerTranscriptionJob({ ...row, cleanup_requested_at: null, expires_at: new Date(Date.now() - 1) });
    expect(expired.original_filename).toBeNull();
    expect(expired.correction_notes).toBeNull();
    expect(expired.speaker_names).toBeNull();
  });

  it.each([
    ['partially deleted content retains the upload watch', {
      cleanup_requested_at: new Date(), local_cleanup_completed_at: null,
      content_purged_at: null, input_cleanup_pathname: 'private/path', upload_valid_until: new Date(),
      provider_cleanup_completed_at: new Date(),
    }, { contentDeletionObserved: false, lateUploadWatchPending: true, cleanupPending: true, providerCleanupPending: false }],
    ['content deletion observed while provider cleanup is unresolved', {
      cleanup_requested_at: new Date(), local_cleanup_completed_at: null,
      content_purged_at: new Date(), input_cleanup_pathname: 'private/path', upload_valid_until: new Date(),
      provider_cleanup_completed_at: null,
    }, { contentDeletionObserved: true, lateUploadWatchPending: true, cleanupPending: true, providerCleanupPending: true }],
    ['no upload capability leaves no late-upload watch', {
      cleanup_requested_at: new Date(), local_cleanup_completed_at: null,
      content_purged_at: null, input_cleanup_pathname: null, upload_valid_until: null,
      provider_cleanup_completed_at: new Date(),
    }, { contentDeletionObserved: false, lateUploadWatchPending: false, cleanupPending: true, providerCleanupPending: false }],
    ['completed cleanup closes the watch without changing deletion evidence', {
      cleanup_requested_at: new Date(), local_cleanup_completed_at: new Date(),
      content_purged_at: new Date(), input_cleanup_pathname: null, upload_valid_until: new Date(),
      provider_cleanup_completed_at: new Date(),
    }, { contentDeletionObserved: true, lateUploadWatchPending: false, cleanupPending: false, providerCleanupPending: false }],
    ['an ordinary ready job does not display a cleanup watch just because its upload token exists', {
      status: 'ready',
      cleanup_requested_at: null, local_cleanup_completed_at: null,
      content_purged_at: null, input_cleanup_pathname: 'private/path', upload_valid_until: new Date(),
      provider_cleanup_completed_at: new Date(),
    }, { contentDeletionObserved: false, lateUploadWatchPending: false, cleanupPending: false, providerCleanupPending: false }],
  ])('%s', (_label, fields, expected) => {
    expect(projectOwnerTranscriptionJob({ status: 'expired', ...fields })).toMatchObject(expected);
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

  it('releases only a still-ready cleanup lease using a schema-compatible publication fence', async () => {
    const db = fakeDatabase();
    const store = createTranscriptionPilotStore(db);
    await store.releaseReadyCleanupLease({ jobId: '00000000-0000-4000-8000-000000000001',
      leaseToken: '00000000-0000-4000-8000-000000000002', expectedVersion: 7 });
    const [sql, params] = db.query.mock.calls[0];
    expect(sql).toContain("status = 'ready'");
    expect(sql).toContain('cleanup_requested_at IS NULL');
    expect(sql).toContain("COALESCE(to_jsonb(transcription_jobs)->>'publication_operation_id', '') = ''");
    expect(sql).not.toMatch(/AND\s+publication_operation_id\s+IS NULL/);
    expect(params).toEqual(['00000000-0000-4000-8000-000000000001',
      '00000000-0000-4000-8000-000000000002', 7]);
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

  describe('correction draft presentation end', () => {
    const ids = {
      operationId: '00000000-0000-4000-8000-000000000001',
      requestId: '00000000-0000-4000-8000-000000000002',
      siteVisitActivityId: '00000000-0000-4000-8000-000000000003',
    };
    const end = { endMs: 90_000, confirmedBy: 12, confirmedAt: '2026-10-05T12:00:00.000Z' };

    it('seeds the three boundary columns on create with typed parameters, null when absent', async () => {
      const db = fakeDatabase();
      const store = createTranscriptionPilotStore(db);
      const draft = { ...ids, initiatorProfileId: 12, sourceArtifactId: NON_RFC_DOCUMENT_ID,
        sourceRevisionId: '00000000-0000-4000-8000-000000000004', expectedCurrentArtifactId: NON_RFC_DOCUMENT_ID,
        expectedCurrentFingerprint: 'a'.repeat(64), speakerNames: {}, expiresAt: new Date() };
      await store.createMeetingCorrectionDraft({ ...draft, presentationEnd: end });
      const [query, params] = db.query.mock.calls[0];
      expect(query).toMatch(/presentation_end_ms, presentation_end_confirmed_by, presentation_end_confirmed_at/);
      expect(query).toMatch(/\$11::integer,\$12::integer,\$13::timestamptz/);
      expect(params.slice(10, 13)).toEqual([90_000, 12, '2026-10-05T12:00:00.000Z']);
      await store.createMeetingCorrectionDraft(draft);
      expect(db.query.mock.calls[1][1].slice(10, 13)).toEqual([null, null, null]);
    });

    it('leaves the boundary untouched when presentationEnd is undefined', async () => {
      const db = fakeDatabase();
      await createTranscriptionPilotStore(db).updateMeetingCorrectionDraft({ ...ids, actorProfileId: 12,
        expectedVersion: 3, speakerNames: { A: 'Chair' } });
      const [query, params] = db.query.mock.calls[0];
      expect(query).not.toMatch(/presentation_end/);
      expect(params).toHaveLength(5);
    });

    it('clears all three columns on null and sets all three on a boundary, keeping every guard', async () => {
      const db = fakeDatabase();
      const store = createTranscriptionPilotStore(db);
      await store.updateMeetingCorrectionDraft({ ...ids, actorProfileId: 12, expectedVersion: 3,
        speakerNames: { A: 'Chair' }, presentationEnd: null });
      await store.updateMeetingCorrectionDraft({ ...ids, actorProfileId: 12, expectedVersion: 3,
        speakerNames: { A: 'Chair' }, presentationEnd: { ...end, confirmedAt: new Date(end.confirmedAt) } });
      const [clearSql, clearParams] = db.query.mock.calls[0];
      const [setSql, setParams] = db.query.mock.calls[1];
      expect(clearParams.slice(5)).toEqual([null, null, null]);
      expect(setParams.slice(5)).toEqual([90_000, 12, '2026-10-05T12:00:00.000Z']);
      for (const sql of [clearSql, setSql]) {
        expect(sql).toMatch(/presentation_end_ms = \$6::integer, presentation_end_confirmed_by = \$7::integer/);
        expect(sql).toMatch(/presentation_end_confirmed_at = \$8::timestamptz/);
        expect(sql).toMatch(/state = 'draft' AND expires_at > NOW\(\)/);
        expect(sql).toMatch(/AND version = \$5 RETURNING/);
      }
    });

    it.each([
      { endMs: -1, confirmedBy: 12, confirmedAt: '2026-10-05T12:00:00.000Z' },
      { endMs: 1.5, confirmedBy: 12, confirmedAt: '2026-10-05T12:00:00.000Z' },
      { endMs: 1, confirmedBy: 0, confirmedAt: '2026-10-05T12:00:00.000Z' },
      { endMs: 1, confirmedBy: 12, confirmedAt: 'not a date' },
    ])('rejects a malformed boundary before SQL: %j', async bad => {
      const db = fakeDatabase();
      await expect(createTranscriptionPilotStore(db).updateMeetingCorrectionDraft({ ...ids, actorProfileId: 12,
        expectedVersion: 3, speakerNames: {}, presentationEnd: bad }))
        .rejects.toMatchObject({ code: 'transcription_invalid_value', httpStatus: 400 });
      expect(db.query).not.toHaveBeenCalled();
    });
  });

  it('accepts canonical Dataverse GUIDs with non-RFC nibbles but keeps internal UUIDs strict', async () => {
    const db = fakeDatabase();
    const store = createTranscriptionPilotStore(db);
    const operationId = '00000000-0000-4000-8000-000000000001';

    await store.getMeetingPublication({ operationId, requestId: NON_RFC_REQUEST_ID,
      siteVisitActivityId: NON_RFC_SITE_VISIT_ID });
    expect(db.query.mock.calls[0][1]).toEqual([operationId, NON_RFC_REQUEST_ID, NON_RFC_SITE_VISIT_ID]);
    await expect(store.getMeetingPublication({ operationId: NON_RFC_REQUEST_ID,
      requestId: NON_RFC_REQUEST_ID, siteVisitActivityId: NON_RFC_SITE_VISIT_ID }))
      .rejects.toMatchObject({ code: 'transcription_invalid_value', httpStatus: 400 });
    expect(db.query).toHaveBeenCalledTimes(1);

    await store.createMeetingCorrectionDraft({ operationId, requestId: NON_RFC_REQUEST_ID,
      siteVisitActivityId: NON_RFC_SITE_VISIT_ID, initiatorProfileId: 12,
      sourceArtifactId: NON_RFC_DOCUMENT_ID, sourceRevisionId: '00000000-0000-4000-8000-000000000002',
      expectedCurrentArtifactId: NON_RFC_DOCUMENT_ID, expectedCurrentFingerprint: 'a'.repeat(64),
      speakerNames: {}, expiresAt: new Date() });
    expect(db.query.mock.calls[1][1]).toEqual([
      operationId, NON_RFC_REQUEST_ID, NON_RFC_SITE_VISIT_ID, 12, NON_RFC_DOCUMENT_ID,
      '00000000-0000-4000-8000-000000000002', NON_RFC_DOCUMENT_ID, 'a'.repeat(64), '{}', expect.any(Date),
      null, null, null, null,
    ]);

    await store.transitionMeetingPublication({ operationId, requestId: NON_RFC_REQUEST_ID,
      siteVisitActivityId: NON_RFC_SITE_VISIT_ID, expectedState: 'publishing', state: 'published',
      resultingDocumentId: NON_RFC_DOCUMENT_ID });
    expect(db.query.mock.calls[2][1][1]).toBe(NON_RFC_REQUEST_ID);
    expect(db.query.mock.calls[2][1][2]).toBe(NON_RFC_SITE_VISIT_ID);
    expect(db.query.mock.calls[2][1][6]).toBe(NON_RFC_DOCUMENT_ID);
  });

  it('stores non-RFC request and visit GUIDs on new Meeting Tracker jobs', async () => {
    const db = fakeDatabase();
    db.query.mockResolvedValueOnce({ rows: [{ id: '00000000-0000-4000-8000-000000000001' }] });
    const store = createTranscriptionPilotStore(db);
    await store.createMeetingJob({
      id: '00000000-0000-4000-8000-000000000001', ownerProfileId: 7,
      idempotencyKey: '00000000-0000-4000-8000-000000000002',
      requestId: NON_RFC_REQUEST_ID, siteVisitActivityId: NON_RFC_SITE_VISIT_ID,
      originalFilename: 'recording.m4a', declaredContentType: 'audio/mp4', declaredBytes: 100,
      inputPathname: 'transcription-pilot/7/00000000-0000-4000-8000-000000000001/input.m4a',
      requestedModel: 'universal-3-5-pro',
    });
    expect(db.query.mock.calls[0][1][3]).toBe(NON_RFC_REQUEST_ID);
    expect(db.query.mock.calls[0][1][4]).toBe(NON_RFC_SITE_VISIT_ID);
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
      requestId: NON_RFC_REQUEST_ID,
      siteVisitActivityId: NON_RFC_SITE_VISIT_ID,
      initiatorProfileId: 12, publishedByProfileId: 12,
      actingUserSystemId: NON_RFC_ACTOR_ID, expectedVersion: 4,
      expectedCurrentArtifactId: NON_RFC_DOCUMENT_ID, expectedCurrentFingerprint: 'b'.repeat(64),
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

describe('Zoom transcript and speaker alignment persistence', () => {
  const JOB = '00000000-0000-4000-8000-000000000001';
  const TOKEN = '00000000-0000-4000-8000-0000000000aa';
  const meetingArgs = {
    ownerProfileId: 7, idempotencyKey: '00000000-0000-4000-8000-000000000009', requestId: NON_RFC_REQUEST_ID,
    siteVisitActivityId: NON_RFC_SITE_VISIT_ID, originalFilename: 'a.m4a', declaredContentType: 'audio/mp4',
    declaredBytes: 10, providerRegion: 'us', requestedModel: 'universal-2', optionsSnapshot: {},
    expiresAt: new Date(), receiptExpiresAt: new Date(),
  };

  it('createMeetingJob inserts the Zoom cleanup path only under the job prefix', async () => {
    const db = fakeDatabase();
    db.query.mockResolvedValueOnce({ rows: [{ id: JOB }] });
    const store = createTranscriptionPilotStore(db);
    const good = `transcription-pilot/7/${JOB}/input/zoom-transcript.vtt`;
    await store.createMeetingJob({ ...meetingArgs, id: JOB, inputPathname: `transcription-pilot/7/${JOB}/input/a.m4a`,
      zoomTranscriptCleanupPathname: good });
    expect(db.query.mock.calls[0][0]).toMatch(/zoom_transcript_cleanup_pathname/);
    expect(db.query.mock.calls[0][1]).toContain(good);
    await expect(store.createMeetingJob({ ...meetingArgs, id: JOB, inputPathname: `transcription-pilot/7/${JOB}/input/a.m4a`,
      zoomTranscriptCleanupPathname: `transcription-pilot/7/other/zoom.vtt` })).rejects.toMatchObject({ code: 'transcription_invalid_value' });
  });

  it('queueMeetingJob promotes the Zoom cleanup path to the live pointer with its hash', async () => {
    const db = fakeDatabase();
    const store = createTranscriptionPilotStore(db);
    await store.queueMeetingJob({ jobId: JOB, requestId: NON_RFC_REQUEST_ID, siteVisitActivityId: NON_RFC_SITE_VISIT_ID,
      actorProfileId: 7, expectedVersion: 1, acknowledgementAt: new Date(), verifiedContentType: 'audio/mp4',
      verifiedBytes: 10, durationMs: 1000, sha256: 'a'.repeat(64), etag: null,
      zoomTranscriptSha256: 'b'.repeat(64), speakerAlignment: { status: 'no_speakers' } });
    const [query, params] = db.query.mock.calls[0];
    expect(query).toMatch(/zoom_transcript_pathname = zoom_transcript_cleanup_pathname/);
    expect(params).toContain('b'.repeat(64));
    expect(params).toContain('{"status":"no_speakers"}');
  });

  it('publishReady stamps a pending marker only when a Zoom pathname exists', async () => {
    const db = fakeDatabase();
    const store = createTranscriptionPilotStore(db);
    await store.publishReady({ jobId: JOB, leaseToken: TOKEN, expectedVersion: 3,
      outputPathname: 'transcription-pilot/x/output.json', outputSha256: 'c'.repeat(64) });
    const query = db.query.mock.calls[0][0];
    expect(query).toMatch(/speaker_alignment = CASE WHEN zoom_transcript_pathname IS NOT NULL AND speaker_alignment IS NULL\s+THEN '\{"status":"pending","attempts":0\}'::jsonb ELSE speaker_alignment END/);
  });

  it('updateMeetingSpeakerNames supersedes a pending or running alignment, including an empty save', async () => {
    const db = fakeDatabase();
    const store = createTranscriptionPilotStore(db);
    await store.updateMeetingSpeakerNames({ jobId: JOB, requestId: NON_RFC_REQUEST_ID, siteVisitActivityId: NON_RFC_SITE_VISIT_ID,
      expectedVersion: 2, actorProfileId: 7, speakerNames: {} });
    const [query, params] = db.query.mock.calls[0];
    expect(query).toMatch(/speaker_alignment->>'status' IN \('pending','running'\)\s+THEN jsonb_set\(speaker_alignment, '\{status\}', '"superseded"'\)/);
    expect(params).toContain('{}');
  });

  it('claimJobForAlignment is lease-, status-, attempt-, and fence-guarded', async () => {
    const db = fakeDatabase();
    const store = createTranscriptionPilotStore(db);
    await expect(store.claimJobForAlignment({ jobId: JOB })).resolves.toBeNull();
    const [query, params] = db.query.mock.calls[0];
    expect(params[2]).toBe(180);
    for (const fragment of [
      /status = 'ready' AND output_pathname IS NOT NULL/, /zoom_transcript_pathname IS NOT NULL/,
      /speaker_names = '\{\}'::jsonb/, /publication_operation_id IS NULL/, /cleanup_requested_at IS NULL/,
      /\(lease_token IS NULL OR lease_expires_at <= NOW\(\)\)/,
      /speaker_alignment->>'status' = 'pending' OR speaker_alignment->>'status' = 'running'/,
      /\(speaker_alignment->>'attempts'\)::int < 3/, /version = version \+ 1/,
    ]) expect(query).toMatch(fragment);
    await expect(store.claimJobForAlignment({ jobId: JOB, leaseSeconds: 181 })).rejects.toMatchObject({ code: 'transcription_invalid_value' });
  });

  it('completeAlignment fences on lease, version, and empty hand-edit names', async () => {
    const db = fakeDatabase();
    const store = createTranscriptionPilotStore(db);
    await expect(store.completeAlignment({ jobId: JOB, leaseToken: TOKEN, expectedVersion: 4,
      speakerNames: { A: 'Chair' }, alignment: { status: 'applied', attempts: 1 } })).resolves.toBeNull();
    const [query, params] = db.query.mock.calls[0];
    expect(query).toMatch(/lease_token = \$2 AND lease_expires_at > NOW\(\) AND version = \$3/);
    expect(query).toMatch(/speaker_names = '\{\}'::jsonb/);
    expect(query).toMatch(/version = version \+ 1/);
    expect(params.slice(3)).toEqual(['{"A":"Chair"}', '{"status":"applied","attempts":1}']);
    await expect(store.completeAlignment({ jobId: JOB, leaseToken: TOKEN, expectedVersion: 4,
      speakerNames: {}, alignment: [] })).rejects.toMatchObject({ code: 'transcription_invalid_value' });
    await expect(store.completeAlignment({ jobId: JOB, leaseToken: TOKEN, expectedVersion: 4,
      speakerNames: {}, alignment: { status: 'applied', blob: 'x'.repeat(70000) } })).rejects.toMatchObject({ code: 'transcription_invalid_value' });
  });

  it('failAlignment is fenced, caps at three attempts, and validates its code', async () => {
    const db = fakeDatabase();
    const store = createTranscriptionPilotStore(db);
    await store.failAlignment({ jobId: JOB, leaseToken: TOKEN, expectedVersion: 4, terminal: true, code: 'zoom_transcript_missing' });
    const [query, params] = db.query.mock.calls[0];
    expect(query).toMatch(/lease_token = \$2 AND lease_expires_at > NOW\(\) AND version = \$3/);
    expect(query).toMatch(/\(speaker_alignment->>'attempts'\)::int >= 3/);
    expect(query).toMatch(/lease_token = NULL, lease_expires_at = NULL/);
    expect(params[3]).toBe(true);
    await expect(store.failAlignment({ jobId: JOB, leaseToken: TOKEN, expectedVersion: 4, code: 'Bad Code' }))
      .rejects.toMatchObject({ code: 'transcription_invalid_value' });
  });

  it('recovery scan and exhaustion expiry both match a free or expired lease and never a live one', async () => {
    const db = fakeDatabase();
    db.query.mockResolvedValueOnce({ rows: [{ id: JOB }] });
    const store = createTranscriptionPilotStore(db);
    await expect(store.claimNextPendingAlignmentJob({ limit: 3 })).resolves.toEqual([JOB]);
    await store.expireExhaustedAlignments({ limit: 3 });
    const [scan, expire] = db.query.mock.calls.map(call => call[0]);
    expect(scan).toMatch(/\(lease_token IS NULL OR lease_expires_at <= NOW\(\)\)/);
    expect(scan).toMatch(/speaker_alignment->>'status' = 'pending' AND updated_at < NOW\(\) - INTERVAL '2 minutes'/);
    expect(scan).toMatch(/speaker_alignment->>'status' = 'running'/);
    expect(scan).toMatch(/\(speaker_alignment->>'attempts'\)::int < 3/);
    expect(expire).toMatch(/speaker_alignment->>'status' = 'running'/);
    expect(expire).toMatch(/\(lease_token IS NULL OR lease_expires_at <= NOW\(\)\)/);
    expect(expire).toMatch(/\(speaker_alignment->>'attempts'\)::int >= 3/);
    expect(expire).toMatch(/"attempts_exhausted"/);
    expect(expire).toMatch(/version = version \+ 1/);
  });

  describe('finishLocalCleanup with a Zoom transcript path', () => {
    const zoom = 'transcription-pilot/7/job/input/zoom-transcript.vtt';
    const baseRow = {
      id: JOB, status: 'ready', version: 5, cleanup_requested_at: new Date(), upload_valid_until: null,
      input_cleanup_pathname: null, audio_pathname: null, output_cleanup_pathname: null, output_pathname: null,
      diagnostic_cleanup_pathname: null, diagnostic_pathname: null,
      zoom_transcript_cleanup_pathname: zoom, zoom_transcript_pathname: zoom,
    };
    function run(row, deletedPaths) {
      const tx = { query: jest.fn().mockResolvedValueOnce({ rows: [row] }).mockResolvedValueOnce({ rows: [{ id: JOB }] }) };
      const db = { query: jest.fn(), transaction: jest.fn(async fn => fn(tx)) };
      return createTranscriptionPilotStore(db).finishLocalCleanup({ jobId: JOB, leaseToken: TOKEN, expectedVersion: 5, deletedPaths })
        .then(() => tx.query.mock.calls[1]);
    }

    it('does not mark content purged while the Zoom path is unacknowledged', async () => {
      const [query, params] = await run(baseRow, []);
      expect(query).not.toMatch(/content_purged_at/);
      expect(query).not.toMatch(/local_cleanup_completed_at/);
      expect(params).not.toContain(null);
    });

    it('acknowledged Zoom deletion clears both pointers, purges, and nulls speaker_alignment', async () => {
      const [query, params] = await run(baseRow, ['zoom_transcript_cleanup_pathname']);
      expect(query).toMatch(/zoom_transcript_cleanup_pathname = \$/);
      expect(query).toMatch(/zoom_transcript_pathname = \$/);
      expect(query).toMatch(/content_purged_at = \$/);
      expect(query).toMatch(/speaker_alignment = \$/);
      expect(query).toMatch(/local_cleanup_completed_at = NOW\(\)/);
      expect(params.filter(value => value === null).length).toBeGreaterThanOrEqual(3);
    });

    it('late-upload retention keeps the Zoom cleanup path like the input path', async () => {
      const [query] = await run({ ...baseRow, upload_valid_until: new Date(Date.now() + 60000) }, ['zoom_transcript_cleanup_pathname']);
      expect(query).not.toMatch(/zoom_transcript_cleanup_pathname = \$/);
      expect(query).not.toMatch(/local_cleanup_completed_at/);
    });

    it('rejects a non-column acknowledgement', async () => {
      await expect(run(baseRow, ['zoom_transcript_pathname'])).rejects.toMatchObject({ code: 'transcription_invalid_value' });
    });
  });

  it('expireContent nulls the live Zoom pointer and speaker_alignment', async () => {
    const tx = { query: jest.fn().mockResolvedValueOnce({ rows: [] }) };
    const db = { query: jest.fn(), transaction: jest.fn(async fn => fn(tx)) };
    await createTranscriptionPilotStore(db).expireContent({ jobId: JOB, leaseToken: TOKEN, expectedVersion: 2 });
    expect(tx.query.mock.calls[0][0]).toMatch(/zoom_transcript_pathname = NULL/);
    expect(tx.query.mock.calls[0][0]).toMatch(/speaker_alignment = NULL/);
  });

  it('owner projection redacts alignment on blocked content and watches the Zoom path under an upload window', () => {
    const base = { id: 'j', status: 'ready', version: 1, expires_at: new Date(Date.now() + 60000),
      speaker_alignment: { status: 'applied' }, upload_valid_until: new Date(Date.now() + 60000) };
    expect(projectOwnerTranscriptionJob(base).speaker_alignment).toEqual({ status: 'applied' });
    expect(projectOwnerTranscriptionJob({ ...base, cleanup_requested_at: new Date() }).speaker_alignment).toBeNull();
    expect(projectOwnerTranscriptionJob({ ...base, receipt_expires_at: new Date(Date.now() - 1) }).speaker_alignment).toBeNull();
    const watch = projectOwnerTranscriptionJob({ ...base, cleanup_requested_at: new Date(), zoom_transcript_cleanup_pathname: 'p' });
    expect(watch.lateUploadWatchPending).toBe(true);
    expect(watch).not.toHaveProperty('zoom_transcript_cleanup_pathname');
  });
});

describe('speaker alignment validation and projection allowlist', () => {
  const JOB = '00000000-0000-4000-8000-000000000001';
  const TOKEN = '00000000-0000-4000-8000-0000000000aa';

  it('completeAlignment accepts only terminal result statuses and integer attempts', async () => {
    const store = createTranscriptionPilotStore(fakeDatabase());
    const base = { jobId: JOB, leaseToken: TOKEN, expectedVersion: 2, speakerNames: {} };
    await expect(store.completeAlignment({ ...base, alignment: { status: 'pending', attempts: 0 } })).rejects.toMatchObject({ code: 'transcription_invalid_value' });
    await expect(store.completeAlignment({ ...base, alignment: { status: 'applied', attempts: '1' } })).rejects.toMatchObject({ code: 'transcription_invalid_value' });
    await expect(store.completeAlignment({ ...base, alignment: { status: 'applied', attempts: 4 } })).rejects.toMatchObject({ code: 'transcription_invalid_value' });
    await expect(store.completeAlignment({ ...base, alignment: { status: 'bogus' } })).rejects.toMatchObject({ code: 'transcription_invalid_value' });
    await expect(store.completeAlignment({ ...base, alignment: { status: 'partial', attempts: 2 } })).resolves.toBeNull();
  });

  it('queueMeetingJob accepts only a no_speakers marker and only with a Zoom hash, and refuses to queue a VTT job without one', async () => {
    const db = fakeDatabase();
    const store = createTranscriptionPilotStore(db);
    const args = { jobId: JOB, requestId: NON_RFC_REQUEST_ID, siteVisitActivityId: NON_RFC_SITE_VISIT_ID, actorProfileId: 7,
      expectedVersion: 1, acknowledgementAt: new Date(), verifiedContentType: 'audio/mp4', verifiedBytes: 10,
      durationMs: 1000, sha256: 'a'.repeat(64), etag: null };
    await expect(store.queueMeetingJob({ ...args, zoomTranscriptSha256: 'b'.repeat(64), speakerAlignment: { status: 'pending' } }))
      .rejects.toMatchObject({ code: 'transcription_invalid_value' });
    await expect(store.queueMeetingJob({ ...args, speakerAlignment: { status: 'no_speakers' } }))
      .rejects.toMatchObject({ code: 'transcription_invalid_value' });
    await store.queueMeetingJob({ ...args, zoomTranscriptSha256: 'b'.repeat(64) });
    expect(db.query.mock.calls[0][0]).toMatch(/AND \(zoom_transcript_cleanup_pathname IS NULL OR \$12::text IS NOT NULL\)/);
  });

  it('alignment claim excludes any job that was ever published', async () => {
    const db = fakeDatabase();
    const store = createTranscriptionPilotStore(db);
    await store.claimJobForAlignment({ jobId: JOB });
    await store.claimNextPendingAlignmentJob({ limit: 1 });
    for (const [query] of db.query.mock.calls) {
      expect(query).toMatch(/NOT EXISTS \(SELECT 1 FROM meeting_transcript_publications p WHERE p\.input_job_id = transcription_jobs\.id\)/);
    }
  });

  it('projects only allowlisted alignment keys through the owner and Meeting projections', () => {
    const row = { id: 'j', status: 'ready', version: 1, expires_at: new Date(Date.now() + 60000),
      output_pathname: 'p', zoom_transcript_cleanup_pathname: 'z',
      speaker_alignment: { status: 'applied', attempts: 1, code: null, model: 'm', floor: 0.8, secretTop: 'LEAK',
        speakers: { A: { name: 'Chair', confidence: 0.9, prior: { x: 1 }, pairIds: ['p1'], extra: 'LEAK' } },
        suggestions: { B: ['Vice'] } } };
    const owner = projectOwnerTranscriptionJob(row);
    expect(owner.speaker_alignment).toEqual({ status: 'applied', attempts: 1, code: null,
      speakers: { A: { name: 'Chair', confidence: 0.9 } }, suggestions: { B: ['Vice'] } });
    expect(JSON.stringify(owner)).not.toMatch(/pairIds|LEAK|prior|floor/);
    const { projectMeetingTranscriptionJob } = jest.requireActual('../../lib/services/transcription-pilot/runtime.js');
    const meeting = projectMeetingTranscriptionJob(row);
    expect(JSON.stringify(meeting.speaker_alignment)).not.toMatch(/pairIds|LEAK|prior|floor/);
    expect(meeting.speaker_alignment.speakers.A).toEqual({ name: 'Chair', confidence: 0.9 });
  });
});


test('publication freezes normalized provenance and checks it against the locked audio job', async () => {
  const op = '11111111-1111-4111-8111-111111111111';
  const jobId = '22222222-2222-4222-8222-222222222222';
  const provenance = { version: 1, sourceId: jobId, kind: 'upload', audioSha256: 'a'.repeat(64), audioBytes: 5, audioDurationMs: 1000, zoom: null };
  const args = { operationId: op, jobId, requestId: NON_RFC_REQUEST_ID, siteVisitActivityId: NON_RFC_SITE_VISIT_ID,
    initiatorProfileId: 12, publishedByProfileId: 12, actingUserSystemId: NON_RFC_ACTOR_ID, expectedVersion: 4,
    frozenInputSha256: 'b'.repeat(64), formatterVersion: '6', sourceProvenance: provenance,
    candidatePaths: { txt: `folder/${op}.txt`, vtt: `folder/${op}.vtt`, source: `folder/${op}.json` } };
  const locked = { id: jobId, audio_sha256: provenance.audioSha256, verified_bytes: '5', audio_duration_ms: '1000' };
  const tx = { query: jest.fn().mockResolvedValueOnce({ rows: [] }).mockResolvedValueOnce({ rows: [locked] })
    .mockResolvedValueOnce({ rows: [{ version: 5 }] }).mockResolvedValueOnce({ rows: [{ operation_id: op }] }) };
  const db = { query: jest.fn(), transaction: async fn => fn(tx) };
  await createTranscriptionPilotStore(db).freezeMeetingPublicationFromJob(args);
  expect(tx.query.mock.calls[3][0]).toContain('frozen_source_provenance');
  expect(JSON.parse(tx.query.mock.calls[3][1][16])).toEqual(provenance);
  tx.query.mockReset().mockResolvedValueOnce({ rows: [] }).mockResolvedValueOnce({ rows: [{ ...locked, audio_sha256: 'c'.repeat(64) }] });
  await expect(createTranscriptionPilotStore(db).freezeMeetingPublicationFromJob(args)).rejects.toMatchObject({ code: 'transcription_source_changed' });
  expect(tx.query).toHaveBeenCalledTimes(2);
});
