import {
  POST_PRESENTATION_TRANSCRIPT_MAX_BYTES,
  validatePostPresentationTranscript,
  validatePostPresentationTranscriptDescriptor,
} from '../../lib/utils/post-presentation-transcript-file.js';

test('descriptor enforces the code-owned 25 MiB cap and exact extension/MIME pairs', () => {
  expect(validatePostPresentationTranscriptDescriptor(
    'notes.txt', 'text/plain', POST_PRESENTATION_TRANSCRIPT_MAX_BYTES,
  )).toEqual({ ok: true, extension: 'txt', contentType: 'text/plain' });
  expect(validatePostPresentationTranscriptDescriptor(
    'notes.txt', 'text/plain', POST_PRESENTATION_TRANSCRIPT_MAX_BYTES + 1,
  )).toEqual({ ok: false, reason: 'file_too_large' });
  expect(validatePostPresentationTranscriptDescriptor('notes.exe', 'text/plain', 1))
    .toEqual({ ok: false, reason: 'extension_not_allowed' });
  expect(validatePostPresentationTranscriptDescriptor('notes.pdf', 'text/plain', 1))
    .toEqual({ ok: false, reason: 'content_type_mismatch' });
});

test('VTT accepts an optional BOM only when followed by a WEBVTT header', () => {
  expect(validatePostPresentationTranscript(
    'captions.vtt', 'text/vtt', Buffer.from('\uFEFFWEBVTT\n\n00:00.000 --> 00:01.000\nHi'),
  )).toMatchObject({ ok: true, extension: 'vtt' });
  expect(validatePostPresentationTranscript(
    'captions.vtt', 'text/vtt', Buffer.from('00:00.000 --> 00:01.000\nHi'),
  )).toEqual({ ok: false, reason: 'vtt_header_invalid' });
});

test('PDF and DOCX require signatures while TXT makes no magic-byte claim', () => {
  expect(validatePostPresentationTranscript('file.pdf', 'application/pdf', Buffer.from('%PDF-1.7')))
    .toMatchObject({ ok: true, extension: 'pdf' });
  expect(validatePostPresentationTranscript('file.docx', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', Buffer.from([0x50, 0x4b, 0x03, 0x04])))
    .toMatchObject({ ok: true, extension: 'docx' });
  expect(validatePostPresentationTranscript('file.pdf', 'application/pdf', Buffer.from('not pdf')))
    .toEqual({ ok: false, reason: 'signature_mismatch' });
  expect(validatePostPresentationTranscript('notes.txt', 'text/plain', Buffer.from([0x00, 0xff])))
    .toMatchObject({ ok: true, extension: 'txt' });
});
