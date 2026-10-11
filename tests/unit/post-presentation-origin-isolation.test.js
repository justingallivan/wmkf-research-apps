/** @jest-environment node */
// Version-skew guard for Stage 3b step 0: a server-origin ('zoom_copy') intent
// must be invisible to every browser MP4 path and unchanged by it. The fake
// `sql` models only the origin predicate: a statement whose text carries
// `origin = 'browser'` matches a row only when the row's origin is 'browser';
// any other statement matches the seeded row. Dropping the predicate from a
// browser query therefore lets that path see or change the seeded row.
jest.mock('@vercel/postgres', () => ({ sql: jest.fn() }));

import { sql } from '@vercel/postgres';
import {
  POST_PRESENTATION_MATERIALS_DEPENDENCIES,
  cancelMp4Upload,
  finalizeMp4Upload,
  getMp4UploadStatus,
  getPresentationMaterials,
  mintMp4Upload,
  retryMp4Upload,
} from '../../lib/services/post-presentation-materials/material-service.js';
import {
  claimPresentationMaterialUpload,
  claimPresentationMaterialUploadRecovery,
  claimPresentationMaterialUploadsForCleanup,
  markPresentationMaterialUploadFailed,
  markPresentationMaterialUploadSessionClosed,
  recordPresentationMaterialUploadCandidate,
  recordPresentationMaterialUploadSession,
  refreshPresentationMaterialUploadSession,
} from '../../lib/services/post-presentation-materials/upload-intent-store.js';

const REQUEST_ID = '11111111-1111-4111-8111-111111111111';
const VISIT_ID = '22222222-2222-4222-8222-222222222222';
const ACTOR_ID = '33333333-3333-4333-8333-333333333333';
const UPLOAD_ID = '44444444-4444-4444-8444-444444444444';
const FINGERPRINT = 'a'.repeat(64);
const PAST = '2026-09-01T00:00:00Z';
const FUTURE = '2026-12-01T00:00:00Z';

function seeded(overrides) {
  return {
    id: UPLOAD_ID, request_id: REQUEST_ID, site_visit_id: VISIT_ID, actor_id: ACTOR_ID,
    artifact_type: 100000005, origin: 'zoom_copy', state: 'initiated',
    original_display_filename: 'recording.mp4', validated_mime_type: 'video/mp4', declared_size: 100,
    client_resume_fingerprint: FINGERPRINT, library_name: 'akoya_request',
    folder_path: '1003220/Post Site Visit Materials', physical_filename: `1003220-Recording-${UPLOAD_ID}.mp4`,
    generation_key: 'b'.repeat(64), upload_url_ciphertext: null, upload_session_expires_at: null,
    intent_expires_at: FUTURE, lease_token: null, lease_expires_at: null,
    candidate_item_id: null, request_document_id: null, last_error: null,
    created_at: PAST, updated_at: PAST,
    ...overrides,
  };
}

const SHAPES = {
  'initiated without ciphertext': seeded({}),
  'initiated with ciphertext': seeded({ upload_url_ciphertext: 'sealed', upload_session_expires_at: FUTURE }),
  'failed without candidate': seeded({ state: 'failed', last_error: 'session_expired', upload_url_ciphertext: 'sealed' }),
  'uploaded with candidate': seeded({ state: 'uploaded', candidate_item_id: 'item', upload_url_ciphertext: 'sealed' }),
  'finalizing with an expired lease': seeded({
    state: 'finalizing', candidate_item_id: 'item', lease_token: UPLOAD_ID, lease_expires_at: PAST,
  }),
};

let row;
let applied;

function installFakeSql() {
  sql.mockReset();
  applied = [];
  sql.mockImplementation(async (strings) => {
    const text = strings.join('?').replace(/\s+/g, ' ');
    const guarded = text.includes("origin = 'browser'");
    if (text.includes('ON CONFLICT (id) DO NOTHING')) return { rows: [] };
    if (guarded && row.origin !== 'browser') return { rows: [] };
    if (/\b(UPDATE|INSERT)\b/.test(text)) applied.push(text);
    return { rows: [row] };
  });
}

function dependencies(overrides = {}) {
  return {
    ...POST_PRESENTATION_MATERIALS_DEPENDENCIES,
    schemaReady: () => true,
    requestAllowed: () => true,
    getRequest: async () => ({
      akoya_requestid: REQUEST_ID, akoya_requestnum: '1003220', wmkf_meetingdate: '2026-12-10T00:00:00Z',
    }),
    findActiveSiteVisit: async () => ({ records: [{ activityid: VISIT_ID, _regardingobjectid_value: REQUEST_ID }] }),
    findDocuments: async () => ({ records: [] }),
    getSharePointBuckets: async () => [{ library: 'akoya_request', folder: '1003220', source: 'dynamics' }],
    ensureFolderPath: async () => ({}),
    now: () => new Date('2026-10-01T00:00:00Z'),
    sleep: async () => {},
    recordEvent: async () => {},
    ...overrides,
  };
}

const base = { requestId: REQUEST_ID, uploadId: UPLOAD_ID, actingUserSystemId: ACTOR_ID };
const withFingerprint = { ...base, resumeFingerprint: FINGERPRINT };
const mintArgs = {
  requestId: REQUEST_ID, operationId: UPLOAD_ID, actingUserSystemId: ACTOR_ID,
  filename: 'recording.mp4', contentType: 'video/mp4', size: 100, resumeFingerprint: FINGERPRINT,
};

beforeEach(() => {
  row = SHAPES['initiated without ciphertext'];
  installFakeSql();
});

describe.each(Object.entries(SHAPES))('a zoom_copy intent that is %s', (_shape, seed) => {
  beforeEach(() => { row = seed; });

  test('is not listed or projected for the same actor and request', async () => {
    const result = await getPresentationMaterials({ requestId: REQUEST_ID, actingUserSystemId: ACTOR_ID }, dependencies());
    expect(result.uploads).toEqual([]);
    expect(applied).toEqual([]);
  });

  test.each([
    ['status', (d) => getMp4UploadStatus(withFingerprint, d)],
    ['retry', (d) => retryMp4Upload(withFingerprint, d)],
    ['cancel', (d) => cancelMp4Upload(base, d)],
    ['finalize', (d) => finalizeMp4Upload(base, d)],
  ])('%s answers 404 and changes no row', async (_path, run) => {
    await expect(run(dependencies())).rejects.toMatchObject({
      httpStatus: 404, code: 'post_presentation_upload_not_found',
    });
    expect(applied).toEqual([]);
  });

  test('a mint replay of the same id is refused and changes no row', async () => {
    await expect(mintMp4Upload(mintArgs, dependencies())).rejects.toMatchObject({
      httpStatus: 409, code: 'post_presentation_replay_mismatch',
    });
    expect(applied).toEqual([]);
  });

  test('the claims and unleased store writers match nothing', async () => {
    const candidate = { siteId: 's', driveId: 'd', itemId: 'i', versionId: '1', eTag: 'e', size: 100 };
    const common = { uploadId: UPLOAD_ID, requestId: REQUEST_ID, actorId: ACTOR_ID };
    await expect(claimPresentationMaterialUpload({ uploadId: UPLOAD_ID, requestId: REQUEST_ID, actorId: ACTOR_ID }))
      .resolves.toEqual({ state: 'not_found' });
    await expect(claimPresentationMaterialUploadRecovery({ uploadId: UPLOAD_ID, requestId: REQUEST_ID, actorId: ACTOR_ID }))
      .resolves.toBeNull();
    await expect(recordPresentationMaterialUploadSession({
      uploadId: UPLOAD_ID, uploadUrlCiphertext: 'new', expiresAt: FUTURE, intentExpiresAt: FUTURE,
    })).resolves.toBeNull();
    await expect(markPresentationMaterialUploadFailed({ uploadId: UPLOAD_ID, lastError: 'x' })).resolves.toBeNull();
    await expect(markPresentationMaterialUploadSessionClosed({
      ...common, uploadUrlCiphertext: 'sealed', lastError: 'x',
    })).resolves.toBeNull();
    await expect(refreshPresentationMaterialUploadSession({
      ...common, uploadUrlCiphertext: 'sealed', expiresAt: FUTURE, intentExpiresAt: FUTURE,
    })).resolves.toBeNull();
    await expect(recordPresentationMaterialUploadCandidate({ ...common, candidate })).resolves.toBeNull();
    expect(applied).toEqual([]);
  });

  test('cleanup still claims it', async () => {
    const claimed = await claimPresentationMaterialUploadsForCleanup();
    expect(claimed.rows).toEqual([seed]);
    expect(applied).toHaveLength(1);
  });
});

describe('a browser-origin intent is unaffected', () => {
  beforeEach(() => { row = seeded({ origin: 'browser', upload_url_ciphertext: 'sealed' }); });

  test('it is still listed', async () => {
    const result = await getPresentationMaterials({ requestId: REQUEST_ID, actingUserSystemId: ACTOR_ID }, dependencies());
    expect(result.uploads).toHaveLength(1);
  });

  test('status and mint replay still find it', async () => {
    await expect(getMp4UploadStatus({ ...base, resumeFingerprint: 'c'.repeat(64) }, dependencies())).rejects.toMatchObject({
      httpStatus: 409, code: 'post_presentation_resume_fingerprint_mismatch',
    });
    sql.mockClear();
    sql.mockImplementation(async (strings) => {
      const text = strings.join('?');
      return { rows: text.includes('ON CONFLICT') ? [] : [row] };
    });
    await expect(mintMp4Upload(mintArgs, dependencies())).rejects.toMatchObject({ code: 'post_presentation_upload_exists' });
  });
});
