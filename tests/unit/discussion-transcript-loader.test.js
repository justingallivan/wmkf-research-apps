/** @jest-environment node */
jest.mock('../../lib/services/portal-upload-staging.js', () => ({
  PORTAL_UPLOAD_SCOPES: { POST_PRESENTATION_TRANSCRIPT: 'post_presentation_transcript' },
  createPortalUpload: jest.fn(), recordPortalUploadCandidate: jest.fn(), renewPortalUploadLease: jest.fn(),
  staffActorBinding: jest.fn((id) => `profile:${id}`),
}));

import { createHash } from 'node:crypto';
import { loadVerifiedDiscussionTranscript } from '../../lib/services/post-presentation-materials/transcript-summary-service.js';

const sha = (bytes) => createHash('sha256').update(bytes).digest('hex');
const TEXT = '[00:03] Dr. Lee: Strong team.\n';
const BYTES = Buffer.from(TEXT, 'utf8');
const END_MS = 2000;

const rowFor = (extra = {}) => ({ wmkf_requestdocumentid: 'doc-1', wmkf_sharepointdriveid: 'drive', wmkf_sharepointitemid: 'item',
  wmkf_sharepointsiteid: 'site', wmkf_contenthash: sha(BYTES), wmkf_sharepointetag: 'etag', ...extra });
const boundWith = (row, extra = {}) => ({
  boundary: { revisionId: 'rev', presentationEnd: { endMs: END_MS } },
  discussion: { reason: 'bound', staffDiscussionTranscript: row }, ...extra });

function makeDeps({ utterances = [{ end: 5000 }], buffer = BYTES, etag = 'etag' } = {}) {
  return {
    loadVerifiedSource: jest.fn(async () => ({ content: { utterances }, speakerNames: { A: 'Dr. Lee' } })),
    downloadFile: jest.fn(async () => ({ buffer })),
    getFileMetadataById: jest.fn(async () => ({ eTag: etag })),
    drafts: { recordEmptySummaryRun: jest.fn() },
  };
}
const load = (bound, deps) => loadVerifiedDiscussionTranscript(bound, { siteVisitActivityId: 'visit' }, 'req', deps);

test('returns the verified row, text, boundary, utterance count and names, with no write', async () => {
  const deps = makeDeps();
  const result = await load(boundWith(rowFor()), deps);
  expect(result).toMatchObject({ transcriptText: TEXT, utteranceCount: 1, speakerNames: { A: 'Dr. Lee' }, discussionContent: { utterances: [{ end: 5000 }] } });
  expect(result.discussionRow.wmkf_requestdocumentid).toBe('doc-1');
  expect(result.boundary.presentationEnd.endMs).toBe(END_MS);
  expect(deps.drafts.recordEmptySummaryRun).not.toHaveBeenCalled();
});

test('an empty discussion returns a zero count, reads no TXT and writes nothing', async () => {
  const deps = makeDeps({ utterances: [{ end: 1500 }] });
  const result = await load(boundWith(rowFor()), deps);
  expect(result).toMatchObject({ utteranceCount: 0, transcriptText: null });
  expect(deps.downloadFile).not.toHaveBeenCalled();
  expect(deps.drafts.recordEmptySummaryRun).not.toHaveBeenCalled();
});

test('no bound discussion or no boundary is 409 staff_discussion_transcript_not_ready', async () => {
  await expect(load({ boundary: null, discussion: { reason: 'bound', staffDiscussionTranscript: rowFor() } }, makeDeps()))
    .rejects.toMatchObject({ httpStatus: 409, code: 'staff_discussion_transcript_not_ready' });
  await expect(load(boundWith(rowFor(), { discussion: { reason: 'missing', staffDiscussionTranscript: rowFor() } }), makeDeps()))
    .rejects.toMatchObject({ httpStatus: 409, code: 'staff_discussion_transcript_not_ready' });
});

test('a hash or eTag mismatch is 409 staff_discussion_transcript_integrity_failed', async () => {
  await expect(load(boundWith(rowFor()), makeDeps({ buffer: Buffer.from('tampered') })))
    .rejects.toMatchObject({ httpStatus: 409, code: 'staff_discussion_transcript_integrity_failed' });
  await expect(load(boundWith(rowFor()), makeDeps({ etag: 'other' })))
    .rejects.toMatchObject({ httpStatus: 409, code: 'staff_discussion_transcript_integrity_failed' });
});

test('blank text is 422 empty and text over 400,000 characters is 422 too long', async () => {
  const blank = Buffer.from('  \n');
  await expect(load(boundWith(rowFor({ wmkf_contenthash: sha(blank) })), makeDeps({ buffer: blank })))
    .rejects.toMatchObject({ httpStatus: 422, code: 'staff_discussion_transcript_empty' });
  const big = Buffer.from('x'.repeat(400001));
  await expect(load(boundWith(rowFor({ wmkf_contenthash: sha(big) })), makeDeps({ buffer: big })))
    .rejects.toMatchObject({ httpStatus: 422, code: 'staff_discussion_transcript_too_long' });
});
