/** @jest-environment node */
import { normalizeSourceProvenance, normalizeRecordingCapture, provenanceFromJob, resolveSourceProvenance } from '../../lib/services/meeting-tracker-transcription/source-provenance';
import { buildMeetingTranscriptFiles, buildMeetingTranscriptManifest, parseVerifiedMeetingTranscriptSource, validateMeetingTranscriptManifest } from '../../lib/services/meeting-tracker-transcription/bundle';
import { formatTranscriptText, formatTranscriptVtt, TRANSCRIPT_FORMATTER_VERSION } from '../../lib/services/transcription-pilot/transcript-format';

const sourceId = '11111111-1111-4111-8111-111111111111';
const revisionId = '22222222-2222-4222-8222-222222222222';
const audioFile = { fileId: 'audio-1', recordingType: 'audio_only', bytes: 5,
  recordingStart: '2026-10-09T16:31:01Z', recordingEnd: '2026-10-09T17:25:41Z', sha256: 'a'.repeat(64) };
const capture = { version: 1, audioOnlyFileCount: 1, audioFile, transcriptFile: null };
const job = { id: sourceId, audio_sha256: audioFile.sha256, verified_bytes: '5', audio_duration_ms: '3280000' };
const imported = { id: revisionId, zoom_meeting_uuid: 'occurrence==', zoom_host_id: 'host', selected_recording_files: capture };
const provenance = provenanceFromJob(job, imported);
const content = { text: 'Synthetic words.', utterances: [{ speaker: 'A', start: 0, end: 1000, text: 'Synthetic words.',
  words: [{ start: 0, end: 500, text: 'Synthetic' }, { start: 500, end: 1000, text: 'words.' }] }] };
const identity = { requestId: sourceId, siteVisitActivityId: sourceId, revisionId, operationId: revisionId };
const build = (extra = {}) => buildMeetingTranscriptFiles({ content, speakerNames: { A: 'Presenter' }, identity: { ...identity, ...extra } });
const parse = (result, extra = {}) => parseVerifiedMeetingTranscriptSource(result.files.source.bytes,
  { size: result.files.source.bytes.length, sha256: result.files.source.sha256 }, { ...identity, ...extra });

it('freezes exact Zoom audio origin without requiring a VTT; imported hash mismatch blocks', () => {
  expect(provenance.zoom.transcriptFile).toBeNull();
  expect(provenance.zoom.audioFile.recordingStart).toBe('2026-10-09T16:31:01.000Z');
  expect(() => provenanceFromJob({ ...job, audio_sha256: 'b'.repeat(64) }, imported)).toThrow('invalid_source_provenance');
  expect(provenanceFromJob(job, { ...imported, selected_recording_files: null })).toBeNull();
  expect(provenanceFromJob(job, null).kind).toBe('upload');
});

it('preserves the number of audio-only files, including segmented occurrences', () => {
  expect(normalizeRecordingCapture({ ...capture, audioOnlyFileCount: 2 }).audioOnlyFileCount).toBe(2);
  expect(() => normalizeRecordingCapture({ ...capture, audioOnlyFileCount: 0 })).toThrow();
});

it.each([
  p => ({ ...p, downloadUrl: 'https://example.test/private' }),
  p => ({ ...p, kind: 'unknown' }),
  p => ({ ...p, zoom: { ...p.zoom, audioOnlyFileCount: 0 } }),
  p => ({ ...p, zoom: { ...p.zoom, audioFile: { ...p.zoom.audioFile, recordingEnd: '2020-01-01T00:00:00Z' } } }),
])('rejects malformed, secret-bearing or contradictory provenance', mutate => {
  expect(() => normalizeSourceProvenance(mutate(provenance))).toThrow('invalid_source_provenance');
  expect(resolveSourceProvenance(mutate(provenance)).status).toBe('invalid');
});

it('freezes provenance into source, fingerprint and manifest, while leaving words and timing unchanged', () => {
  const result = build({ sourceProvenance: provenance });
  expect(result.inputSha256).not.toBe(build().inputSha256);
  expect(parse(result, { sourceProvenance: provenance })).toMatchObject({ sourceProvenance: provenance, content });
  expect(() => parse(result, { sourceProvenance: null })).toThrow('invalid_transcript_bundle');
  const files = Object.fromEntries(Object.entries(result.files).map(([role, file]) => [role, {
    siteId: 'site', driveId: 'drive', itemId: role, versionId: '1', eTag: role,
    sha256: file.sha256, size: file.bytes.length, filename: file.filename, contentType: file.contentType,
  }]));
  const manifest = buildMeetingTranscriptManifest({ identity: { ...identity, sourceProvenance: provenance }, files });
  expect(manifest.sourceProvenance).toEqual(provenance);
  expect(() => validateMeetingTranscriptManifest({ ...manifest, sourceProvenance: { broken: true } })).toThrow();
});

it('names/boundary revisions retain source identity and frozen evidence after job cleanup', () => {
  const first = parse(build({ sourceProvenance: provenance }));
  const cleanedJob = { ...job, audio_sha256: null };
  expect(provenanceFromJob(cleanedJob, imported)).toBeNull();
  const revised = buildMeetingTranscriptFiles({ content: first.content, speakerNames: { A: 'Corrected' },
    identity: { ...identity, revisionId: sourceId, operationId: sourceId, sourceRevisionId: revisionId,
      sourceProvenance: first.sourceProvenance, presentationEnd: { endMs: 1000, confirmedBy: 1, confirmedAt: '2026-10-09T20:00:00Z' } } });
  expect(revised.sourceContent.sourceProvenance).toEqual(provenance);
  expect(revised.sourceContent.utterances).toEqual(build().sourceContent.utterances);
});

it('v6 preserves v5 rendered text/VTT and pilot rendering; legacy source bytes rebuild identically', () => {
  const legacy = build({ formatterVersion: '5' });
  const current = build({ sourceProvenance: provenance });
  expect(TRANSCRIPT_FORMATTER_VERSION).toBe('7');
  expect(current.files.txt.bytes).toEqual(legacy.files.txt.bytes);
  expect(current.files.vtt.bytes).toEqual(legacy.files.vtt.bytes);
  expect(formatTranscriptText(content, { A: 'Presenter' }, { layout: 'turn' })).toBe(legacy.files.txt.bytes.toString('utf8').slice(1));
  expect(formatTranscriptVtt(content, { A: 'Presenter' })).toBe(legacy.files.vtt.bytes.toString('utf8'));
  const parsed = parse(legacy);
  const replay = buildMeetingTranscriptFiles({ content: parsed.content, speakerNames: parsed.speakerNames,
    identity: { ...identity, formatterVersion: parsed.formatterVersion } });
  expect(replay.files.source.bytes).toEqual(legacy.files.source.bytes);
  expect(replay.inputSha256).toBe(legacy.inputSha256);
  expect(() => build({ formatterVersion: '5', sourceProvenance: provenance })).toThrow();
  expect(resolveSourceProvenance(null).status).toBe('legacy_unknown');
});


it('rejects unsafe database integers and a VTT hash that differs from the verified job', () => {
  expect(() => provenanceFromJob({ ...job, verified_bytes: '9007199254740993' }, imported)).toThrow();
  const withVtt = { ...imported, selected_recording_files: { ...capture,
    transcriptFile: { ...audioFile, fileId: 'vtt-1', recordingType: 'audio_transcript' } } };
  expect(() => provenanceFromJob(job, withVtt)).toThrow();
  expect(provenanceFromJob({ ...job, zoom_transcript_sha256: audioFile.sha256 }, withVtt).zoom.transcriptFile.fileId).toBe('vtt-1');
});
