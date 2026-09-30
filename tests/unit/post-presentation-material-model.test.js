import {
  materialBacking,
  normalizeZoomPaste,
  projectPostPresentationDescriptors,
  projectPostPresentationMaterials,
} from '../../lib/services/post-presentation-materials/material-model.js';
import {
  REQUEST_DOCUMENT_ARTIFACT_TYPE,
  REQUEST_DOCUMENT_LIFECYCLE_STATE,
  REQUEST_DOCUMENT_OPERATION_STATUS,
} from '../../shared/config/requestDocument.js';

const REQUEST_ID = '11111111-1111-4111-8111-111111111111';

function row(id, overrides = {}) {
  return {
    wmkf_requestdocumentid: id,
    _wmkf_request_value: REQUEST_ID,
    wmkf_artifacttype: REQUEST_DOCUMENT_ARTIFACT_TYPE.RECORDING,
    wmkf_operationstatus: REQUEST_DOCUMENT_OPERATION_STATUS.READY,
    wmkf_lifecyclestate: REQUEST_DOCUMENT_LIFECYCLE_STATE.DRAFT,
    wmkf_externalurl: 'https://us02web.zoom.us/rec/share/abc?pwd=secret',
    wmkf_slotversion: 1,
    createdon: '2026-09-25T12:00:00Z',
    ...overrides,
  };
}

describe('Zoom paste normalization', () => {
  test('accepts a bare or multiline zoom.us recording URL and retains embedded pwd', () => {
    expect(normalizeZoomPaste('https://us02web.zoom.us/rec/share/abc?pwd=secret'))
      .toBe('https://us02web.zoom.us/rec/share/abc?pwd=secret');
    expect(normalizeZoomPaste('Join the recording\nhttps://zoom.us/rec/play/abc?pwd=x\nPasscode: embedded'))
      .toContain('pwd=x');
  });

  test.each([
    ['no url', 'hello'],
    ['two urls', 'https://zoom.us/rec/share/a https://zoom.us/rec/share/b'],
    ['mixed-scheme urls', 'https://zoom.us/rec/share/a http://zoom.us/rec/share/b'],
    ['non-HTTPS', 'http://zoom.us/rec/share/a'],
    ['zoom.com', 'https://zoom.com/rec/share/a'],
    ['suffix confusion', 'https://zoom.us.evil.example/rec/share/a'],
    ['userinfo', 'https://user:pass@zoom.us/rec/share/a'],
    ['unreviewed path', 'https://zoom.us/j/123'],
    ['separate passcode', 'https://zoom.us/rec/share/a\nPasscode: 1234'],
    ['empty embedded passcode', 'https://zoom.us/rec/share/a?pwd=\nPasscode: 1234'],
    ['owner recording detail', 'https://zoom.us/recording/detail?id=123'],
  ])('rejects %s', (_label, value) => {
    expect(() => normalizeZoomPaste(value)).toThrow();
  });

  test('rejects a normalized URL above the Dataverse 2,000-character field limit', () => {
    expect(() => normalizeZoomPaste(`https://zoom.us/rec/share/${'a'.repeat(2000)}`)).toThrow(/2,000/);
  });
});

describe('backing and latest-only projection', () => {
  test('accepts external Recording and file Transcript, but rejects both/neither/external Transcript', () => {
    expect(materialBacking(row('a'))).toMatchObject({ kind: 'external' });
    expect(materialBacking(row('b', {
      wmkf_artifacttype: REQUEST_DOCUMENT_ARTIFACT_TYPE.TRANSCRIPT,
      wmkf_externalurl: null,
      wmkf_sharepointdriveid: 'drive',
      wmkf_sharepointitemid: 'item',
    }))).toEqual({ kind: 'file' });
    expect(materialBacking(row('c', { wmkf_sharepointdriveid: 'drive', wmkf_sharepointitemid: 'item' })))
      .toEqual({ kind: 'invalid', reason: 'multiple_backings' });
    expect(materialBacking(row('d', { wmkf_externalurl: null })))
      .toEqual({ kind: 'invalid', reason: 'missing_backing' });
    expect(materialBacking(row('e', { wmkf_artifacttype: REQUEST_DOCUMENT_ARTIFACT_TYPE.TRANSCRIPT })))
      .toEqual({ kind: 'invalid', reason: 'external_non_recording' });
  });

  test('higher fence wins even when older; legacy/equal-fence ties use timestamp then id', () => {
    const lowerLater = row('ffffffff-ffff-4fff-8fff-ffffffffffff', {
      wmkf_slotversion: 2,
      createdon: '2026-09-25T14:00:00Z',
    });
    const higherEarlier = row('11111111-1111-4111-8111-111111111112', {
      wmkf_slotversion: 3,
      createdon: '2026-09-25T13:00:00Z',
    });
    const projected = projectPostPresentationMaterials([lowerLater, higherEarlier], REQUEST_ID);
    expect(projected.winners).toEqual([higherEarlier]);
    expect(projected.conflicts).toContainEqual(expect.objectContaining({
      artifactId: lowerLater.wmkf_requestdocumentid,
      reason: 'eligible_non_winner',
    }));

    const sameTimeA = row('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', { wmkf_slotversion: null });
    const sameTimeB = row('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', { wmkf_slotversion: null });
    expect(projectPostPresentationMaterials([sameTimeA, sameTimeB], REQUEST_ID).winners[0])
      .toBe(sameTimeB);
  });

  test('filters failed, Superseded, foreign, and invalid rows and never leaks URLs unless requested', () => {
    const eligible = row('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa');
    const projection = projectPostPresentationDescriptors([
      eligible,
      row('b', { wmkf_operationstatus: REQUEST_DOCUMENT_OPERATION_STATUS.FAILED }),
      row('c', { wmkf_lifecyclestate: REQUEST_DOCUMENT_LIFECYCLE_STATE.SUPERSEDED }),
      row('d', { _wmkf_request_value: '22222222-2222-4222-8222-222222222222' }),
      row('e', { wmkf_externalurl: null }),
    ], REQUEST_ID);
    expect(projection.materials).toHaveLength(1);
    expect(projection.materials[0]).not.toHaveProperty('externalUrl');
    expect(projection.conflicts).toContainEqual(expect.objectContaining({ reason: 'missing_backing' }));
    expect(projectPostPresentationDescriptors([eligible], REQUEST_ID, { includeStaffUrls: true }).materials[0])
      .toHaveProperty('externalUrl');
  });
});
