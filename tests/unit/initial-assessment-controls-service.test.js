/**
 * @jest-environment node
 */

import {
  createInitialAssessmentBoardSnapshot,
  restoreInitialAssessmentVersion,
} from '../../lib/services/initial-assessment/controls-service.js';
import {
  REQUEST_DOCUMENT_ARTIFACT_TYPE,
  REQUEST_DOCUMENT_LIFECYCLE_STATE,
  REQUEST_DOCUMENT_OPERATION_STATUS,
} from '../../shared/config/requestDocument.js';

const REQUEST_ID = '11111111-1111-4111-8111-111111111111';
const SOURCE_ID = '22222222-2222-4222-8222-222222222222';
const SNAPSHOT_ID = '33333333-3333-4333-8333-333333333333';
const ACTOR_ID = '44444444-4444-4444-8444-444444444444';

function sourceRow(overrides = {}) {
  return {
    wmkf_requestdocumentid: SOURCE_ID,
    _wmkf_request_value: REQUEST_ID,
    wmkf_artifacttype: REQUEST_DOCUMENT_ARTIFACT_TYPE.INITIAL_ASSESSMENT,
    wmkf_operationstatus: REQUEST_DOCUMENT_OPERATION_STATUS.READY,
    wmkf_lifecyclestate: REQUEST_DOCUMENT_LIFECYCLE_STATE.DRAFT,
    wmkf_cyclecode: 'D26',
    wmkf_producer: 'request-workbench',
    wmkf_sharepointsiteid: 'site',
    wmkf_sharepointdriveid: 'drive',
    wmkf_sharepointitemid: 'source-item',
    wmkf_sharepointfolderpath: '1000001_GUID/Artifacts/Initial Assessment',
    wmkf_filename: '1000001 Initial Assessment.docx',
    wmkf_sharepointversionid: '2.0',
    wmkf_contenthash: 'hash-original',
    _etag: 'source-etag-1',
    ...overrides,
  };
}

function metadata(overrides = {}) {
  return {
    siteId: 'site',
    driveId: 'drive',
    id: 'source-item',
    name: '1000001 Initial Assessment.docx',
    size: 100,
    webUrl: 'https://sharepoint.test/source',
    eTag: 'graph-etag-2',
    versionId: '2.0',
    lastModified: '2026-08-30T20:00:00Z',
    mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    ...overrides,
  };
}

function harness() {
  let source = sourceRow();
  let snapshot = null;
  let etag = 1;
  const dependencies = {
    resolveCanonical: jest.fn(async () => ({
      request: {
        akoya_requestid: REQUEST_ID,
        akoya_requestnum: '1000001',
        _wmkf_currentinitialassessment_value: SOURCE_ID,
      },
      row: source,
      rows: snapshot ? [source, snapshot] : [source],
    })),
    findByGenerationKey: jest.fn(async () => ({ records: snapshot ? [snapshot] : [] })),
    createDocument: jest.fn(async (payload) => {
      snapshot = {
        ...payload,
        wmkf_requestdocumentid: SNAPSHOT_ID,
        _wmkf_request_value: REQUEST_ID,
        _wmkf_sourcedocument_value: SOURCE_ID,
        _etag: `snapshot-etag-${etag++}`,
        createdon: '2026-08-30T20:01:00Z',
        modifiedon: '2026-08-30T20:01:00Z',
      };
      return SNAPSHOT_ID;
    }),
    updateDocument: jest.fn(async (id, patch) => {
      if (id === SOURCE_ID) {
        source = { ...source, ...patch, _etag: `source-etag-${etag++}` };
      } else if (id === SNAPSHOT_ID) {
        snapshot = { ...snapshot, ...patch, _etag: `snapshot-etag-${etag++}` };
      } else {
        throw new Error(`unexpected row ${id}`);
      }
    }),
    getFileMetadataById: jest.fn(),
    getFileMetadataByPath: jest.fn(),
    getFileVersionMetadata: jest.fn(),
    downloadFile: jest.fn(),
    downloadFileVersion: jest.fn(),
    restoreFileVersion: jest.fn(),
    ensureFolderPath: jest.fn(),
    uploadFile: jest.fn(),
    hashDocx: jest.fn(async (buffer) => `hash:${buffer.toString()}`),
    newClaimToken: jest.fn(() => '55555555-5555-4555-8555-555555555555'),
    now: jest.fn(() => new Date('2026-08-30T20:02:00Z')),
  };
  return {
    dependencies,
    getSource: () => source,
    getSnapshot: () => snapshot,
    setSnapshot: (value) => { snapshot = value; },
  };
}

it('restores a historical version, verifies the copied bytes, and patches post-restore metadata', async () => {
  const h = harness();
  const before = metadata();
  const after = metadata({ versionId: '3.0', eTag: 'graph-etag-3', lastModified: '2026-08-30T20:03:00Z' });
  h.dependencies.getFileMetadataById
    .mockResolvedValueOnce(before)
    .mockResolvedValueOnce(before)
    .mockResolvedValueOnce(after);
  h.dependencies.getFileVersionMetadata.mockResolvedValue({ versionId: '1.0' });
  h.dependencies.downloadFileVersion.mockResolvedValue(Buffer.from('old-version'));
  h.dependencies.downloadFile.mockResolvedValue({ buffer: Buffer.from('old-version') });

  const result = await restoreInitialAssessmentVersion({
    requestId: REQUEST_ID,
    expectedArtifactId: SOURCE_ID,
    targetVersionId: '1.0',
    expectedCurrentVersionId: '2.0',
  }, { actingUserSystemId: ACTOR_ID, dependencies: h.dependencies });

  expect(result).toMatchObject({ restored: true, reconciled: false, targetVersionId: '1.0' });
  expect(result.artifact.file).toMatchObject({
    versionId: '3.0',
    metadataStatus: 'current',
    metadataCheckedAt: '2026-08-30T20:02:00.000Z',
  });
  expect(h.dependencies.restoreFileVersion).toHaveBeenCalledWith('drive', 'source-item', '1.0');
  expect(h.getSource()).toMatchObject({
    wmkf_sharepointversionid: '3.0',
    wmkf_contenthash: 'hash:old-version',
  });
  expect(h.dependencies.updateDocument).toHaveBeenCalledWith(
    SOURCE_ID,
    expect.objectContaining({ wmkf_contenthash: 'hash:old-version' }),
    expect.objectContaining({ ifMatch: 'source-etag-1', actingUserSystemId: ACTOR_ID }),
  );
});

it('refuses a stale restore when current bytes do not match the selected target', async () => {
  const h = harness();
  h.dependencies.getFileMetadataById.mockResolvedValue(metadata({ versionId: '3.0' }));
  h.dependencies.getFileVersionMetadata.mockResolvedValue({ versionId: '1.0' });
  h.dependencies.downloadFileVersion.mockResolvedValue(Buffer.from('old-version'));
  h.dependencies.downloadFile.mockResolvedValue({ buffer: Buffer.from('new-current') });

  await expect(restoreInitialAssessmentVersion({
    requestId: REQUEST_ID,
    expectedArtifactId: SOURCE_ID,
    targetVersionId: '1.0',
    expectedCurrentVersionId: '2.0',
  }, { dependencies: h.dependencies })).rejects.toMatchObject({
    body: expect.objectContaining({ code: 'initial_assessment_restore_stale' }),
  });
  expect(h.dependencies.restoreFileVersion).not.toHaveBeenCalled();
  expect(h.dependencies.updateDocument).not.toHaveBeenCalled();
});

it('refuses a stale restore when normalized hashes match but exact bytes differ', async () => {
  const h = harness();
  h.dependencies.hashDocx.mockResolvedValue('same-governed-hash');
  h.dependencies.getFileMetadataById.mockResolvedValue(metadata({ versionId: '3.0' }));
  h.dependencies.getFileVersionMetadata.mockResolvedValue({ versionId: '1.0' });
  h.dependencies.downloadFileVersion.mockResolvedValue(Buffer.from('selected-version-bytes'));
  h.dependencies.downloadFile.mockResolvedValue({ buffer: Buffer.from('different-current-bytes') });

  await expect(restoreInitialAssessmentVersion({
    requestId: REQUEST_ID,
    expectedArtifactId: SOURCE_ID,
    targetVersionId: '1.0',
    expectedCurrentVersionId: '2.0',
  }, { dependencies: h.dependencies })).rejects.toMatchObject({
    body: expect.objectContaining({ code: 'initial_assessment_restore_stale' }),
  });
  expect(h.dependencies.restoreFileVersion).not.toHaveBeenCalled();
  expect(h.dependencies.updateDocument).not.toHaveBeenCalled();
});

it('fails restore readback when normalized hashes match but exact restored bytes differ', async () => {
  const h = harness();
  const before = metadata();
  h.dependencies.hashDocx.mockResolvedValue('same-governed-hash');
  h.dependencies.getFileMetadataById
    .mockResolvedValueOnce(before)
    .mockResolvedValueOnce(before)
    .mockResolvedValueOnce(metadata({ versionId: '3.0', eTag: 'graph-etag-3' }));
  h.dependencies.getFileVersionMetadata.mockResolvedValue({ versionId: '1.0' });
  h.dependencies.downloadFileVersion.mockResolvedValue(Buffer.from('selected-version-bytes'));
  h.dependencies.downloadFile.mockResolvedValue({ buffer: Buffer.from('different-restored-bytes') });

  await expect(restoreInitialAssessmentVersion({
    requestId: REQUEST_ID,
    expectedArtifactId: SOURCE_ID,
    targetVersionId: '1.0',
    expectedCurrentVersionId: '2.0',
  }, { dependencies: h.dependencies })).rejects.toMatchObject({
    body: expect.objectContaining({ code: 'initial_assessment_restore_bytes_mismatch' }),
  });
  expect(h.dependencies.restoreFileVersion).toHaveBeenCalledTimes(1);
  expect(h.dependencies.updateDocument).not.toHaveBeenCalled();
});

it('refuses restore when the canonical registry row changes after Graph preflight', async () => {
  const h = harness();
  const request = {
    akoya_requestid: REQUEST_ID,
    akoya_requestnum: '1000001',
    _wmkf_currentinitialassessment_value: SOURCE_ID,
  };
  h.dependencies.resolveCanonical
    .mockResolvedValueOnce({ request, row: h.getSource(), rows: [h.getSource()] })
    .mockResolvedValueOnce({
      request,
      row: sourceRow({ _etag: 'source-etag-concurrent-change' }),
      rows: [sourceRow({ _etag: 'source-etag-concurrent-change' })],
    });
  h.dependencies.getFileMetadataById.mockResolvedValue(metadata());
  h.dependencies.getFileVersionMetadata.mockResolvedValue({ versionId: '1.0' });
  h.dependencies.downloadFileVersion.mockResolvedValue(Buffer.from('selected-version-bytes'));

  await expect(restoreInitialAssessmentVersion({
    requestId: REQUEST_ID,
    expectedArtifactId: SOURCE_ID,
    targetVersionId: '1.0',
    expectedCurrentVersionId: '2.0',
  }, { dependencies: h.dependencies })).rejects.toMatchObject({
    body: expect.objectContaining({ code: 'initial_assessment_restore_stale' }),
  });
  expect(h.dependencies.restoreFileVersion).not.toHaveBeenCalled();
});

it('reconciles an already-applied restore without restoring the same version twice', async () => {
  const h = harness();
  h.dependencies.getFileMetadataById.mockResolvedValue(metadata({ versionId: '3.0' }));
  h.dependencies.getFileVersionMetadata.mockResolvedValue({ versionId: '1.0' });
  h.dependencies.downloadFileVersion.mockResolvedValue(Buffer.from('old-version'));
  h.dependencies.downloadFile.mockResolvedValue({ buffer: Buffer.from('old-version') });

  const result = await restoreInitialAssessmentVersion({
    requestId: REQUEST_ID,
    expectedArtifactId: SOURCE_ID,
    targetVersionId: '1.0',
    expectedCurrentVersionId: '2.0',
  }, { dependencies: h.dependencies });

  expect(result).toMatchObject({ restored: false, reconciled: true });
  expect(h.dependencies.restoreFileVersion).not.toHaveBeenCalled();
  expect(h.getSource().wmkf_contenthash).toBe('hash:old-version');
});

it('creates a distinct retained Board snapshot when SharePoint repackages equivalent content', async () => {
  const h = harness();
  h.dependencies.hashDocx.mockImplementation(async (buffer) => (
    ['source-bytes', 'sharepoint-packaged-bytes'].includes(buffer.toString())
      ? 'hash:governed-source'
      : `hash:${buffer.toString()}`
  ));
  h.dependencies.getFileMetadataById.mockResolvedValue(metadata());
  h.dependencies.downloadFile
    .mockResolvedValueOnce({ buffer: Buffer.from('source-bytes') })
    .mockResolvedValueOnce({ buffer: Buffer.from('sharepoint-packaged-bytes') });
  h.dependencies.getFileMetadataByPath.mockResolvedValue(null);
  h.dependencies.uploadFile.mockResolvedValue(metadata({
    id: 'snapshot-item',
    name: '1000001 Initial Assessment Board v2.0.docx',
    webUrl: 'https://sharepoint.test/snapshot',
    versionId: '1.0',
    eTag: 'snapshot-graph-etag',
  }));

  const result = await createInitialAssessmentBoardSnapshot({
    requestId: REQUEST_ID,
    expectedArtifactId: SOURCE_ID,
    expectedCurrentVersionId: '2.0',
  }, { actingUserSystemId: ACTOR_ID, dependencies: h.dependencies });

  expect(result).toMatchObject({ reused: false, recovered: false });
  expect(h.dependencies.createDocument).toHaveBeenCalledWith(
    expect.objectContaining({
      'wmkf_SourceDocument@odata.bind': `/wmkf_requestdocuments(${SOURCE_ID})`,
      wmkf_sourceversionid: '2.0',
      wmkf_sourcecontenthash: 'hash:governed-source',
      wmkf_lifecyclestate: REQUEST_DOCUMENT_LIFECYCLE_STATE.BOARD_READY,
    }),
    { actingUserSystemId: ACTOR_ID },
  );
  expect(h.getSnapshot()).toMatchObject({
    wmkf_operationstatus: REQUEST_DOCUMENT_OPERATION_STATUS.READY,
    wmkf_lifecyclestate: REQUEST_DOCUMENT_LIFECYCLE_STATE.BOARD_READY,
    wmkf_sharepointitemid: 'snapshot-item',
    wmkf_contenthash: 'hash:governed-source',
  });
  expect(h.getSnapshot().wmkf_sharepointitemid).not.toBe(h.getSource().wmkf_sharepointitemid);
  expect(h.dependencies.uploadFile).toHaveBeenCalledWith(
    'akoya_request',
    expect.stringContaining('Board Milestones'),
    expect.stringMatching(/\.docx$/),
    Buffer.from('source-bytes'),
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    { conflictBehavior: 'fail' },
  );
});

it('rejects a Board snapshot when the source changes during byte capture', async () => {
  const h = harness();
  h.dependencies.getFileMetadataById
    .mockResolvedValueOnce(metadata())
    .mockResolvedValueOnce(metadata({ versionId: '3.0', eTag: 'changed' }));
  h.dependencies.downloadFile.mockResolvedValue({ buffer: Buffer.from('source-bytes') });

  await expect(createInitialAssessmentBoardSnapshot({
    requestId: REQUEST_ID,
    expectedArtifactId: SOURCE_ID,
    expectedCurrentVersionId: '2.0',
  }, { dependencies: h.dependencies })).rejects.toMatchObject({
    body: expect.objectContaining({ code: 'initial_assessment_snapshot_stale' }),
  });
  expect(h.dependencies.createDocument).not.toHaveBeenCalled();
  expect(h.dependencies.uploadFile).not.toHaveBeenCalled();
});

it('does not claim a pre-existing path collision as an orphan owned by the snapshot attempt', async () => {
  const h = harness();
  h.dependencies.getFileMetadataById.mockResolvedValue(metadata());
  h.dependencies.downloadFile
    .mockResolvedValueOnce({ buffer: Buffer.from('source-bytes') })
    .mockResolvedValueOnce({ buffer: Buffer.from('someone-elses-bytes') });
  h.dependencies.getFileMetadataByPath.mockResolvedValue(metadata({ id: 'pre-existing-item' }));

  await expect(createInitialAssessmentBoardSnapshot({
    requestId: REQUEST_ID,
    expectedArtifactId: SOURCE_ID,
    expectedCurrentVersionId: '2.0',
  }, { dependencies: h.dependencies })).rejects.toMatchObject({
    body: expect.objectContaining({ code: 'initial_assessment_snapshot_path_collision' }),
  });

  expect(h.dependencies.uploadFile).not.toHaveBeenCalled();
  expect(h.getSnapshot()).toMatchObject({
    wmkf_operationstatus: REQUEST_DOCUMENT_OPERATION_STATUS.FAILED,
  });
  expect(h.getSnapshot().wmkf_orphancleanupjson).toBeUndefined();
});

it('retains exact cleanup identity when an owned upload has different governed content', async () => {
  const h = harness();
  h.dependencies.getFileMetadataById.mockResolvedValue(metadata());
  h.dependencies.downloadFile
    .mockResolvedValueOnce({ buffer: Buffer.from('source-bytes') })
    .mockResolvedValueOnce({ buffer: Buffer.from('corrupt-upload') });
  h.dependencies.getFileMetadataByPath.mockResolvedValue(null);
  h.dependencies.uploadFile.mockResolvedValue(metadata({ id: 'snapshot-item', versionId: '1.0' }));

  await expect(createInitialAssessmentBoardSnapshot({
    requestId: REQUEST_ID,
    expectedArtifactId: SOURCE_ID,
    expectedCurrentVersionId: '2.0',
  }, { dependencies: h.dependencies })).rejects.toMatchObject({
    body: expect.objectContaining({ code: 'initial_assessment_snapshot_hash_mismatch' }),
  });

  expect(JSON.parse(h.getSnapshot().wmkf_orphancleanupjson)).toEqual([
    expect.objectContaining({ driveId: 'drive', itemId: 'snapshot-item' }),
  ]);
});

it('retains uploaded cleanup identity when the source changes before snapshot publication', async () => {
  const h = harness();
  h.dependencies.getFileMetadataById
    .mockResolvedValueOnce(metadata())
    .mockResolvedValueOnce(metadata())
    .mockResolvedValueOnce(metadata({ versionId: '3.0', eTag: 'source-changed' }));
  h.dependencies.downloadFile.mockResolvedValue({ buffer: Buffer.from('source-bytes') });
  h.dependencies.getFileMetadataByPath.mockResolvedValue(null);
  h.dependencies.uploadFile.mockResolvedValue(metadata({ id: 'snapshot-item', versionId: '1.0' }));

  await expect(createInitialAssessmentBoardSnapshot({
    requestId: REQUEST_ID,
    expectedArtifactId: SOURCE_ID,
    expectedCurrentVersionId: '2.0',
  }, { dependencies: h.dependencies })).rejects.toMatchObject({
    body: expect.objectContaining({ code: 'initial_assessment_snapshot_stale' }),
  });

  expect(h.getSnapshot()).toMatchObject({
    wmkf_operationstatus: REQUEST_DOCUMENT_OPERATION_STATUS.FAILED,
  });
  expect(JSON.parse(h.getSnapshot().wmkf_orphancleanupjson)).toEqual([
    expect.objectContaining({ driveId: 'drive', itemId: 'snapshot-item' }),
  ]);
});

it('recovers a failed attempt from a repackaged equivalent deterministic file', async () => {
  const h = harness();
  h.dependencies.hashDocx.mockImplementation(async (buffer) => (
    ['source-bytes', 'sharepoint-packaged-bytes'].includes(buffer.toString())
      ? 'hash:governed-source'
      : `hash:${buffer.toString()}`
  ));
  h.dependencies.getFileMetadataById.mockResolvedValue(metadata());
  h.dependencies.downloadFile
    .mockResolvedValueOnce({ buffer: Buffer.from('source-bytes') })
    .mockResolvedValue({ buffer: Buffer.from('sharepoint-packaged-bytes') });
  h.dependencies.getFileMetadataByPath.mockResolvedValue(metadata({
    id: 'snapshot-item',
    versionId: '1.0',
  }));

  await expect(createInitialAssessmentBoardSnapshot({
    requestId: REQUEST_ID,
    expectedArtifactId: SOURCE_ID,
    expectedCurrentVersionId: '2.0',
  }, { dependencies: h.dependencies })).resolves.toMatchObject({
    reused: false,
    recovered: true,
  });

  expect(h.dependencies.uploadFile).not.toHaveBeenCalled();
  expect(h.getSnapshot()).toMatchObject({
    wmkf_operationstatus: REQUEST_DOCUMENT_OPERATION_STATUS.READY,
    wmkf_sharepointitemid: 'snapshot-item',
  });
});

it('reuses a governed-equivalent Ready Board snapshot without uploading a duplicate item', async () => {
  const h = harness();
  h.dependencies.hashDocx.mockImplementation(async (buffer) => (
    ['source-bytes', 'sharepoint-packaged-bytes'].includes(buffer.toString())
      ? 'hash:governed-source'
      : `hash:${buffer.toString()}`
  ));
  h.dependencies.getFileMetadataById.mockResolvedValue(metadata());
  h.dependencies.downloadFile.mockResolvedValue({ buffer: Buffer.from('source-bytes') });
  h.dependencies.getFileMetadataByPath.mockResolvedValue(null);
  h.dependencies.uploadFile.mockResolvedValue(metadata({
    id: 'snapshot-item',
    versionId: '1.0',
    eTag: 'snapshot-etag',
  }));
  await createInitialAssessmentBoardSnapshot({
    requestId: REQUEST_ID,
    expectedArtifactId: SOURCE_ID,
    expectedCurrentVersionId: '2.0',
  }, { dependencies: h.dependencies });
  h.dependencies.createDocument.mockClear();
  h.dependencies.uploadFile.mockClear();
  h.dependencies.downloadFile.mockReset();
  h.dependencies.downloadFile
    .mockResolvedValueOnce({ buffer: Buffer.from('source-bytes') })
    .mockResolvedValueOnce({ buffer: Buffer.from('sharepoint-packaged-bytes') });
  h.dependencies.getFileMetadataById.mockResolvedValueOnce(metadata()).mockResolvedValueOnce(metadata())
    .mockResolvedValueOnce(metadata({ id: 'snapshot-item', versionId: '1.0' }));

  const result = await createInitialAssessmentBoardSnapshot({
    requestId: REQUEST_ID,
    expectedArtifactId: SOURCE_ID,
    expectedCurrentVersionId: '2.0',
  }, { dependencies: h.dependencies });

  expect(result).toMatchObject({ reused: true });
  expect(h.dependencies.createDocument).not.toHaveBeenCalled();
  expect(h.dependencies.uploadFile).not.toHaveBeenCalled();
});

it('accepts repackaged governed-equivalent content when a concurrent creator wins', async () => {
  const h = harness();
  h.dependencies.hashDocx.mockImplementation(async (buffer) => (
    ['source-bytes', 'sharepoint-packaged-bytes'].includes(buffer.toString())
      ? 'hash:governed-source'
      : `hash:${buffer.toString()}`
  ));
  h.dependencies.getFileMetadataById
    .mockResolvedValueOnce(metadata())
    .mockResolvedValueOnce(metadata())
    .mockResolvedValueOnce(metadata({ id: 'snapshot-item', versionId: '1.0' }));
  h.dependencies.downloadFile
    .mockResolvedValueOnce({ buffer: Buffer.from('source-bytes') })
    .mockResolvedValueOnce({ buffer: Buffer.from('sharepoint-packaged-bytes') });
  h.dependencies.createDocument.mockImplementation(async (payload) => {
    h.setSnapshot({
      ...payload,
      wmkf_requestdocumentid: SNAPSHOT_ID,
      _wmkf_request_value: REQUEST_ID,
      _wmkf_sourcedocument_value: SOURCE_ID,
      _etag: 'snapshot-etag-ready',
      wmkf_operationstatus: REQUEST_DOCUMENT_OPERATION_STATUS.READY,
      wmkf_lifecyclestate: REQUEST_DOCUMENT_LIFECYCLE_STATE.BOARD_READY,
      wmkf_claimtoken: null,
      wmkf_contenthash: 'hash:governed-source',
      wmkf_sharepointsiteid: 'site',
      wmkf_sharepointdriveid: 'drive',
      wmkf_sharepointitemid: 'snapshot-item',
      wmkf_sharepointversionid: '1.0',
    });
    const conflict = new Error('duplicate alternate key');
    conflict.status = 409;
    throw conflict;
  });

  await expect(createInitialAssessmentBoardSnapshot({
    requestId: REQUEST_ID,
    expectedArtifactId: SOURCE_ID,
    expectedCurrentVersionId: '2.0',
  }, { dependencies: h.dependencies })).resolves.toMatchObject({
    reused: true,
    recovered: false,
  });
  expect(h.dependencies.uploadFile).not.toHaveBeenCalled();
});

it('rechecks retained governed content when a concurrent creator wins the snapshot row race', async () => {
  const h = harness();
  h.dependencies.getFileMetadataById
    .mockResolvedValueOnce(metadata())
    .mockResolvedValueOnce(metadata())
    .mockResolvedValueOnce(metadata({ id: 'snapshot-item', versionId: '1.0' }));
  h.dependencies.downloadFile
    .mockResolvedValueOnce({ buffer: Buffer.from('source-bytes') })
    .mockResolvedValueOnce({ buffer: Buffer.from('different-retained-bytes') });
  h.dependencies.createDocument.mockImplementation(async (payload) => {
    h.setSnapshot({
      ...payload,
      wmkf_requestdocumentid: SNAPSHOT_ID,
      _wmkf_request_value: REQUEST_ID,
      _wmkf_sourcedocument_value: SOURCE_ID,
      _etag: 'snapshot-etag-ready',
      wmkf_operationstatus: REQUEST_DOCUMENT_OPERATION_STATUS.READY,
      wmkf_lifecyclestate: REQUEST_DOCUMENT_LIFECYCLE_STATE.BOARD_READY,
      wmkf_claimtoken: null,
      wmkf_contenthash: 'hash:source-bytes',
      wmkf_sharepointsiteid: 'site',
      wmkf_sharepointdriveid: 'drive',
      wmkf_sharepointitemid: 'snapshot-item',
      wmkf_sharepointversionid: '1.0',
    });
    const conflict = new Error('duplicate alternate key');
    conflict.status = 409;
    throw conflict;
  });

  await expect(createInitialAssessmentBoardSnapshot({
    requestId: REQUEST_ID,
    expectedArtifactId: SOURCE_ID,
    expectedCurrentVersionId: '2.0',
  }, { dependencies: h.dependencies })).rejects.toMatchObject({
    body: expect.objectContaining({ code: 'initial_assessment_snapshot_file_invalid' }),
  });
  expect(h.dependencies.uploadFile).not.toHaveBeenCalled();
});

it('fails closed and records cleanup when an owned upload readback is not a valid DOCX', async () => {
  const h = harness();
  h.dependencies.hashDocx.mockImplementation(async (buffer) => {
    if (buffer.toString() === 'source-bytes') return 'hash:governed-source';
    throw new Error('Initial Assessment producer returned an invalid DOCX package.');
  });
  h.dependencies.getFileMetadataById.mockResolvedValue(metadata());
  h.dependencies.downloadFile
    .mockResolvedValueOnce({ buffer: Buffer.from('source-bytes') })
    .mockResolvedValueOnce({ buffer: Buffer.from('invalid-docx') });
  h.dependencies.getFileMetadataByPath.mockResolvedValue(null);
  h.dependencies.uploadFile.mockResolvedValue(metadata({ id: 'snapshot-item', versionId: '1.0' }));

  await expect(createInitialAssessmentBoardSnapshot({
    requestId: REQUEST_ID,
    expectedArtifactId: SOURCE_ID,
    expectedCurrentVersionId: '2.0',
  }, { dependencies: h.dependencies })).rejects.toThrow('invalid DOCX package');

  expect(h.getSnapshot()).toMatchObject({
    wmkf_operationstatus: REQUEST_DOCUMENT_OPERATION_STATUS.FAILED,
  });
  expect(JSON.parse(h.getSnapshot().wmkf_orphancleanupjson)).toEqual([
    expect.objectContaining({ driveId: 'drive', itemId: 'snapshot-item' }),
  ]);
});
