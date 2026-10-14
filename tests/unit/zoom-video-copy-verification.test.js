/** @jest-environment node */
import { needsVideoCopyVerification, verifiedVideoCopyMetadata } from '../../lib/services/meeting-tracker-recordings/video-copy-verification.js';
const row = () => ({ state: 'copied', intent_state: 'finalized', intent_origin: 'zoom_copy', request_document_id: 'doc', intent_request_document_id: 'doc',
  sharepoint_drive_id: 'drive', candidate_drive_id: 'drive', sharepoint_item_id: 'item', candidate_item_id: 'item', declared_size: '100', candidate_size: '100',
  zoom_meeting_uuid: 'meeting', zoom_host_id: 'host', zoom_file_id: 'file', zoom_recording_type: 'shared', candidate_version_id: '1.0', candidate_etag: 'old',
  recording_start: null, recording_end: null, sharepoint_quickxor_hash: null });
const file = () => ({ id: 'file', status: 'completed', file_extension: 'MP4', recording_type: 'shared', file_size: 100,
  recording_start: '2026-10-09T16:31:01Z', recording_end: '2026-10-09T17:25:41Z' });
const meeting = () => ({ uuid: 'meeting', host_id: 'host', recording_files: [file()] });
const item = () => ({ id: 'item', driveId: 'drive', size: 100, versionId: '1.0', eTag: 'metadata-only-change', quickXorHash: 'hash' });
test('fills missing evidence from an unchanged finalized content version despite an eTag metadata change', () => {
  expect(needsVideoCopyVerification(row())).toBe(true);
  expect(verifiedVideoCopyMetadata(row(), meeting(), item())).toEqual({ recordingStart: '2026-10-09T16:31:01.000Z', recordingEnd: '2026-10-09T17:25:41.000Z', quickXorHash: 'hash' });
});
test('exact original eTag also proves identity when a version is unavailable', () => {
  expect(verifiedVideoCopyMetadata({ ...row(), candidate_version_id: null }, meeting(), { ...item(), versionId: null, eTag: 'old' })).toBeTruthy();
});
test.each([
  ['nonterminal', r => { r.state = 'copying'; }], ['wrong origin', r => { r.intent_origin = 'browser'; }],
  ['unfinalized receipt', r => { r.intent_state = 'initiated'; }], ['document changed', r => { r.intent_request_document_id = 'other'; }],
  ['receipt drive changed', r => { r.candidate_drive_id = 'other'; }], ['receipt item changed', r => { r.candidate_item_id = 'other'; }],
  ['receipt size changed', r => { r.candidate_size = 101; }], ['missing original identity', r => { r.candidate_version_id = null; r.candidate_etag = null; }],
  ['existing conflicting hash', r => { r.sharepoint_quickxor_hash = 'different'; }],
  ['existing conflicting time', r => { r.recording_start = '2026-10-09T16:30:00Z'; }],
])('refuses %s', (_label, mutate) => { const r = row(); mutate(r); expect(() => verifiedVideoCopyMetadata(r, meeting(), item())).toThrow('zoom_video_verification_failed'); });
test.each([
  ['different meeting', m => { m.uuid = 'other'; }], ['different host', m => { m.host_id = 'other'; }],
  ['missing file', m => { m.recording_files = []; }], ['duplicate file', m => { m.recording_files.push(file()); }],
  ['different size', m => { m.recording_files[0].file_size = 101; }], ['unfinished', m => { m.recording_files[0].status = 'processing'; }],
  ['different type', m => { m.recording_files[0].recording_type = 'gallery'; }], ['invalid time', m => { m.recording_files[0].recording_end = 'bad'; }],
  ['reversed time', m => { m.recording_files[0].recording_end = '2026-10-08T16:31:01Z'; }],
])('refuses Zoom %s', (_label, mutate) => { const m = meeting(); mutate(m); expect(() => verifiedVideoCopyMetadata(row(), m, item())).toThrow(); });
test.each([
  ['different version', { versionId: '2.0' }], ['different drive', { driveId: 'other' }], ['different item', { id: 'other' }],
  ['different size', { size: 101 }], ['missing hash', { quickXorHash: null }], ['empty hash', { quickXorHash: '' }],
])('refuses SharePoint %s', (_label, over) => { expect(() => verifiedVideoCopyMetadata(row(), meeting(), { ...item(), ...over })).toThrow(); });
test('complete copied records and active copies do not offer repair', () => {
  expect(needsVideoCopyVerification({ ...row(), recording_start: 'start', recording_end: 'end', sharepoint_quickxor_hash: 'hash' })).toBe(false);
  expect(needsVideoCopyVerification({ ...row(), state: 'copying' })).toBe(false);
});
