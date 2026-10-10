import crypto from 'node:crypto';
import { getMeetingTranscriptionCandidates, loadMeetingTranscriptionBinding } from '../../lib/services/meeting-tracker-transcription/binding.js';
import {
  buildMeetingTranscriptFiles, buildMeetingTranscriptManifest,
  parseVerifiedMeetingTranscriptSource, validateMeetingTranscriptManifest,
} from '../../lib/services/meeting-tracker-transcription/bundle.js';
import {
  getMeetingTranscriptionControls, isMeetingTranscriptionRequestAllowed,
  isMeetingTranscriptionSchemaReady, parseMeetingTranscriptionAccess,
} from '../../lib/services/meeting-tracker-transcription/policy.js';

const REQUEST = '4236c2b3-b053-f111-bec7-6045bd015cb0';
const VISIT = '29b0de0d-4ff7-ee11-a1fd-000d3a3621c7';
const REVISION = '33333333-3333-4333-8333-333333333333';
const OPERATION = '44444444-4444-4444-8444-444444444444';
const digest = value => crypto.createHash('sha256').update(value).digest('hex');

describe('Meeting Tracker transcription rollout controls', () => {
  it('defaults unset and invalid values to disabled and requires literal-on schema readiness', () => {
    expect(parseMeetingTranscriptionAccess(undefined)).toEqual({ mode: 'off', requestId: null });
    expect(parseMeetingTranscriptionAccess('enabled').mode).toBe('off');
    expect(parseMeetingTranscriptionAccess('test:not-a-guid').mode).toBe('off');
    expect(isMeetingTranscriptionSchemaReady('true')).toBe(false);
    expect(isMeetingTranscriptionSchemaReady('on')).toBe(true);
    expect(getMeetingTranscriptionControls({}).schemaReady).toBe(false);
  });

  it('limits test access to one request and permits all requests only in on mode', () => {
    expect(parseMeetingTranscriptionAccess(`test:${REQUEST}`)).toEqual({ mode: 'test', requestId: REQUEST });
    expect(isMeetingTranscriptionRequestAllowed(REQUEST, `test:${REQUEST}`)).toBe(true);
    expect(isMeetingTranscriptionRequestAllowed(VISIT, `test:${REQUEST}`)).toBe(false);
    expect(isMeetingTranscriptionRequestAllowed(REQUEST, 'on')).toBe(true);
    expect(isMeetingTranscriptionRequestAllowed(REQUEST, 'off')).toBe(false);
  });
});

describe('Meeting Tracker generated transcript bundle', () => {
  const identity = { requestId: REQUEST, siteVisitActivityId: VISIT, revisionId: REVISION, operationId: OPERATION };
  const content = { utterances: [
    { speaker: 'A', start: 62000, end: 62900, text: 'Hello, team.' },
    { speaker: 'B', start: 125000, end: 127300, text: 'WEBVTT and --> are transcript text.' },
  ] };

  it('accepts an utterance over the former 20,000-character cap and rejects one over the shared cap', () => {
    const long = { utterances: [{ speaker: 'A', start: 0, end: 600000, text: 'y'.repeat(24_213) }] };
    const generated = buildMeetingTranscriptFiles({ content: long, speakerNames: { A: 'PI' }, identity });
    const parsed = parseVerifiedMeetingTranscriptSource(generated.files.source.bytes, {
      size: generated.files.source.bytes.length, sha256: generated.files.source.sha256,
    }, identity);
    expect(parsed.content.utterances[0].text).toHaveLength(24_213);
    const tooLong = { utterances: [{ speaker: 'A', start: 0, end: 600000, text: 'y'.repeat(200_001) }] };
    expect(() => buildMeetingTranscriptFiles({ content: tooLong, speakerNames: {}, identity })).toThrow();
  });

  it('round-trips exact bounded source bytes and hash for later corrections', () => {
    const generated = buildMeetingTranscriptFiles({ content, speakerNames: { A: 'PI', B: 'Co-PI' }, identity });
    expect(generated.files.source.bytes.length).toBeLessThanOrEqual(4_000_000);
    expect(digest(generated.files.source.bytes)).toBe(generated.files.source.sha256);
    const parsed = parseVerifiedMeetingTranscriptSource(generated.files.source.bytes, {
      size: generated.files.source.bytes.length, sha256: generated.files.source.sha256,
    }, identity);
    expect(parsed.content).toEqual({ text: '', ...content });
    expect(parsed.speakerNames).toEqual({ A: 'PI', B: 'Co-PI' });
    expect(generated.files.txt.bytes.toString()).toContain('[01:02] PI: Hello, team.');
    expect(generated.files.vtt.bytes.toString()).toContain('00:01:02.000 --> 00:01:02.900\nPI: Hello, team.');
  });

  it('keeps formatter v1 source and rendered bytes identical to the pre-timing contract', () => {
    const generated = buildMeetingTranscriptFiles({ content, speakerNames: { A: 'PI', B: 'Co-PI' },
      identity: { ...identity, formatterVersion: '1' } });
    expect(generated.files.source.bytes.toString()).toBe(
      `{"schemaVersion":1,"requestId":"${REQUEST}","siteVisitActivityId":"${VISIT}","revisionId":"${REVISION}","text":"","utterances":[{"speakerId":"A","startMs":62000,"endMs":62900,"text":"Hello, team."},{"speakerId":"B","startMs":125000,"endMs":127300,"text":"WEBVTT and --> are transcript text."}],"speakerNames":{"A":"PI","B":"Co-PI"}}`,
    );
    expect(generated.files.txt.bytes.toString()).toBe(
      '1:00\nPI: Hello, team.\n\n2:00\nCo-PI: WEBVTT and --> are transcript text.\n',
    );
    expect(generated.files.vtt.bytes.toString()).toBe(
      'WEBVTT\n\n00:01:02.000 --> 00:01:02.900\nPI: Hello, team.\n\n00:02:05.000 --> 00:02:07.300\nCo-PI: WEBVTT and —&gt; are transcript text.\n',
    );
    const parsed = parseVerifiedMeetingTranscriptSource(generated.files.source.bytes,
      { size: generated.files.source.bytes.length, sha256: generated.files.source.sha256 }, identity);
    const replay = buildMeetingTranscriptFiles({ content: parsed.content, speakerNames: parsed.speakerNames,
      identity: { ...identity, formatterVersion: parsed.formatterVersion } });
    for (const role of ['source', 'txt', 'vtt']) {
      expect(replay.files[role].bytes.equals(generated.files[role].bytes)).toBe(true);
      expect(replay.files[role].sha256).toBe(generated.files[role].sha256);
    }
  });

  const timedContent = { text: 'go now', utterances: [{ speaker: 'A', start: 0, end: 70_000,
    text: 'go now', words: [{ start: 58_000, end: 59_000, text: 'go' }, { start: 61_000, end: 62_000, text: 'now' }] }] };

  it('embeds fully aligned optional word timings in formatter v2+ source; the default v6 TXT is one turn paragraph, BOM-prefixed, with no boundary', () => {
    const generated = buildMeetingTranscriptFiles({ content: timedContent, speakerNames: {}, identity });
    const parsed = parseVerifiedMeetingTranscriptSource(generated.files.source.bytes,
      { size: generated.files.source.bytes.length, sha256: generated.files.source.sha256 }, identity);
    expect(parsed.formatterVersion).toBe('6');
    expect(generated.sourceContent.schemaVersion).toBe(6);
    expect(generated.sourceContent.presentationEnd).toBeNull();
    expect(generated.presentationEnd).toBeNull();
    expect(parsed.presentationEnd).toBeNull();
    expect(parsed.content.utterances[0].words).toEqual(timedContent.utterances[0].words);
    expect(generated.files.txt.bytes.toString()).toBe('\uFEFF[00:00] Speaker A: go now\n');
    expect([...generated.files.txt.bytes.subarray(0, 3)]).toEqual([0xef, 0xbb, 0xbf]);
  });

  it('formatter v5 adds a UTF-8 byte-order mark to the TXT only; v4 TXT is byte-identical to before and VTT/source never carry one', () => {
    const content = { text: 'x', utterances: [{ speaker: 'A', start: 0, end: 1000, text: 'you\u2014 I think, José said \u201cyes\u201d' }] };
    const v4 = buildMeetingTranscriptFiles({ content, speakerNames: {}, identity: { ...identity, formatterVersion: '4' } });
    const v5 = buildMeetingTranscriptFiles({ content, speakerNames: {}, identity: { ...identity, formatterVersion: '5' } });
    expect(v4.files.txt.bytes[0]).toBe(0x5b);
    expect(v5.files.txt.bytes.equals(Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), v4.files.txt.bytes]))).toBe(true);
    expect(v5.files.vtt.bytes.equals(v4.files.vtt.bytes)).toBe(true);
    expect(v5.files.source.bytes[0]).toBe(0x7b);
    // Decoding the v5 TXT as UTF-8 recovers the em dash and accents intact.
    expect(v5.files.txt.bytes.subarray(3).toString('utf8')).toContain('you\u2014 I think, José said');
  });

  describe('version 4 presentation end (boundary)', () => {
    const boundary = { endMs: 70_000, confirmedBy: 12, confirmedAt: '2026-10-05T18:00:00.000Z' };

    it('freezes the confirmed boundary in the source envelope, the identity hash, and the manifest; v3 cannot carry one', () => {
      const plain = buildMeetingTranscriptFiles({ content: timedContent, speakerNames: {}, identity });
      const bounded = buildMeetingTranscriptFiles({ content: timedContent, speakerNames: {}, identity: { ...identity, presentationEnd: boundary } });
      expect(bounded.presentationEnd).toEqual(boundary);
      expect(bounded.sourceContent.presentationEnd).toEqual(boundary);
      expect(bounded.inputSha256).not.toBe(plain.inputSha256);
      // Same TXT and VTT bytes: the boundary changes identity, never the readable files.
      expect(bounded.files.txt.bytes.equals(plain.files.txt.bytes)).toBe(true);
      expect(bounded.files.vtt.bytes.equals(plain.files.vtt.bytes)).toBe(true);
      const parsed = parseVerifiedMeetingTranscriptSource(bounded.files.source.bytes,
        { size: bounded.files.source.bytes.length, sha256: bounded.files.source.sha256 }, identity);
      expect(parsed.presentationEnd).toEqual(boundary);
      const rebuilt = buildMeetingTranscriptFiles({ content: parsed.content, speakerNames: parsed.speakerNames,
        identity: { ...identity, formatterVersion: parsed.formatterVersion, presentationEnd: parsed.presentationEnd } });
      expect(rebuilt.inputSha256).toBe(bounded.inputSha256);
      expect(() => buildMeetingTranscriptFiles({ content: timedContent, speakerNames: {},
        identity: { ...identity, formatterVersion: '3', presentationEnd: boundary } })).toThrow('invalid_transcript_bundle');
      const files = Object.fromEntries(['txt','vtt','source'].map((role, index) => [role, {
        siteId: 'site-1', driveId: 'drive-1', itemId: `item-${index}`, versionId: 'version-1', eTag: 'etag-1',
        sha256: bounded.files[role === 'vtt' ? 'txt' : role].sha256, size: 10, filename: `f.${role}`,
        contentType: { txt: 'text/plain; charset=utf-8', vtt: 'text/vtt; charset=utf-8', source: 'application/json' }[role],
      }]));
      const manifest = buildMeetingTranscriptManifest({ identity: { ...identity, presentationEnd: boundary }, files });
      expect(manifest.schemaVersion).toBe(6);
      expect(manifest.presentationEnd).toEqual(boundary);
      expect(validateMeetingTranscriptManifest({ ...manifest, presentationEnd: null })).toBeTruthy();
      expect(() => validateMeetingTranscriptManifest({ ...manifest, schemaVersion: 3, formatterVersion: '3' })).toThrow('invalid_transcript_bundle');
      const { presentationEnd: _dropped, ...withoutBoundaryKey } = manifest;
      expect(() => validateMeetingTranscriptManifest(withoutBoundaryKey)).toThrow('invalid_transcript_bundle');
    });

    it('rejects a boundary that is not an utterance end or has extra, missing, or malformed fields', () => {
      const build = (presentationEnd) => buildMeetingTranscriptFiles({ content: timedContent, speakerNames: {}, identity: { ...identity, presentationEnd } });
      expect(() => build({ ...boundary, endMs: 69_999 })).toThrow('invalid_transcript_bundle');
      expect(() => build({ ...boundary, endMs: -1 })).toThrow('invalid_transcript_bundle');
      expect(() => build({ ...boundary, confirmedBy: 0 })).toThrow('invalid_transcript_bundle');
      expect(() => build({ ...boundary, confirmedAt: 'yesterday' })).toThrow('invalid_transcript_bundle');
      expect(() => build({ ...boundary, extra: true })).toThrow('invalid_transcript_bundle');
      expect(() => build({ endMs: 70_000 })).toThrow('invalid_transcript_bundle');
      expect(() => build('70000')).toThrow('invalid_transcript_bundle');
    });
  });

  it('keeps formatter v2 minute-split TXT reproducible from a frozen v2 source', () => {
    // Fails if the v2 layout is dropped: existing publications rebuild through their recorded version.
    const generated = buildMeetingTranscriptFiles({ content: timedContent, speakerNames: {}, identity: { ...identity, formatterVersion: '2' } });
    expect(generated.formatterVersion).toBe('2');
    expect(generated.files.txt.bytes.toString()).toBe('0:00\nSpeaker A: go\n\n1:00\nSpeaker A: now\n');
    const parsed = parseVerifiedMeetingTranscriptSource(generated.files.source.bytes,
      { size: generated.files.source.bytes.length, sha256: generated.files.source.sha256 }, identity);
    expect(parsed.formatterVersion).toBe('2');
    const replay = buildMeetingTranscriptFiles({ content: parsed.content, speakerNames: parsed.speakerNames,
      identity: { ...identity, formatterVersion: parsed.formatterVersion } });
    for (const role of ['source', 'txt', 'vtt']) expect(replay.files[role].sha256).toBe(generated.files[role].sha256);
  });

  it('drops only optional timings when they would exceed the source-byte cap', () => {
    const text = `${'word '.repeat(999)}word`;
    const words = Array.from({ length: 1000 }, (_, index) => ({ start: index * 10, end: index * 10 + 1, text: 'word' }));
    const large = { text: '', utterances: Array.from({ length: 120 }, () => ({
      speaker: 'A', start: 0, end: 10_000, text, words,
    })) };
    const generated = buildMeetingTranscriptFiles({ content: large, speakerNames: {}, identity });
    expect(generated.files.source.bytes.length).toBeLessThanOrEqual(4_000_000);
    expect(generated.sourceContent.utterances.every(row => row.words === undefined)).toBe(true);
    const parsed = parseVerifiedMeetingTranscriptSource(generated.files.source.bytes,
      { size: generated.files.source.bytes.length, sha256: generated.files.source.sha256 }, identity);
    expect(parsed.content.utterances.every(row => row.words === undefined)).toBe(true);
    expect(parsed.content.utterances[0].text).toBe(text);
  });

  it('preserves provider text when diarization returned no utterances', () => {
    const transcriptText = 'A complete plain text transcript without diarized turns.';
    const generated = buildMeetingTranscriptFiles({ content: { text: transcriptText, utterances: [] }, speakerNames: {}, identity });
    expect(generated.files.txt.bytes.toString()).toBe(`\uFEFF${transcriptText}\n`);
    expect(generated.publishable).toBe(false);
    expect(generated.files.vtt).toBeUndefined();
    const parsed = parseVerifiedMeetingTranscriptSource(generated.files.source.bytes, {
      size: generated.files.source.bytes.length, sha256: generated.files.source.sha256,
    }, identity);
    expect(parsed.content).toEqual({ text: transcriptText, utterances: [] });
  });

  it('rejects source hash/size mismatches and identity mismatch', () => {
    const generated = buildMeetingTranscriptFiles({ content, speakerNames: {}, identity });
    const badBytes = Buffer.from(generated.files.source.bytes);
    badBytes[badBytes.length - 2] ^= 1;
    expect(() => parseVerifiedMeetingTranscriptSource(badBytes, {
      size: generated.files.source.bytes.length, sha256: generated.files.source.sha256,
    }, identity)).toThrow('invalid_transcript_bundle');
    expect(() => parseVerifiedMeetingTranscriptSource(generated.files.source.bytes, {
      size: generated.files.source.bytes.length, sha256: generated.files.source.sha256,
    }, { ...identity, requestId: VISIT })).toThrow('invalid_transcript_bundle');
  });

  it('accepts canonical Dataverse GUIDs with non-RFC version/variant nibbles but keeps generated IDs strict', () => {
    expect(() => buildMeetingTranscriptFiles({ content, speakerNames: {}, identity })).not.toThrow();
    expect(() => buildMeetingTranscriptFiles({ content, speakerNames: {}, identity: {
      ...identity, revisionId: '33333333-3333-f111-bec7-333333333333',
    } })).toThrow('invalid_transcript_bundle');
  });

  it('requires exactly three typed file descriptors with matching primary TXT identity', () => {
    const generated = buildMeetingTranscriptFiles({ content, speakerNames: {}, identity });
    const files = Object.fromEntries(Object.entries(generated.files).map(([role, file], index) => [role, ({
      siteId: 'site-1', driveId: 'drive-1', itemId: `item-${index}`, versionId: 'version-1', eTag: 'etag-1',
      sha256: file.sha256, size: file.bytes.length, filename: file.filename, contentType: file.contentType,
    })]));
    const manifest = buildMeetingTranscriptManifest({ identity, files });
    expect(validateMeetingTranscriptManifest(manifest, { ...identity, primaryFile: files.txt })).toBe(manifest);
    expect(() => validateMeetingTranscriptManifest({ ...manifest, extraUrl: 'https://example.test' })).toThrow('invalid_transcript_bundle');
    expect(() => validateMeetingTranscriptManifest(manifest, { ...identity, primaryFile: { ...files.txt, itemId: 'other' } })).toThrow('invalid_transcript_bundle');
    expect(() => validateMeetingTranscriptManifest(manifest, { ...identity, primaryFile: { ...files.txt, sha256: 'f'.repeat(64) } })).toThrow('invalid_transcript_bundle');
  });

  it('rejects any attempt to carry additional provider or URL data in source JSON', () => {
    const generated = buildMeetingTranscriptFiles({ content, speakerNames: {}, identity });
    const parsed = JSON.parse(generated.files.source.bytes.toString());
    parsed.audioUrl = 'https://example.test/audio';
    const bytes = Buffer.from(JSON.stringify(parsed));
    expect(() => parseVerifiedMeetingTranscriptSource(bytes, { size: bytes.length, sha256: digest(bytes) }, identity))
      .toThrow('invalid_transcript_bundle');
  });
});

test('binding accepts canonical Dataverse request and Site Visit IDs with non-RFC GUID nibbles', async () => {
  const result = await loadMeetingTranscriptionBinding(REQUEST, VISIT, {
    getRequest: async () => ({ akoya_requestid: REQUEST, akoya_requeststatus: 'Phase II Pending',
      wmkf_triagestatus: null, wmkf_meetingdate: '2026-12-11' }),
    findActiveByRequest: async () => ({ records: [{ activityid: VISIT, _regardingobjectid_value: REQUEST }] }),
  });
  expect(result.requestId).toBe(REQUEST);
  expect(result.siteVisitActivityId).toBe(VISIT);
});

test('speaker candidates include the saved organizer and reject email-only directory names', async () => {
  const binding = {
    requestId: REQUEST,
    request: { _wmkf_projectleader_value: 'contact-pi', _wmkf_researchleader_value: null },
    siteVisitActivityId: VISIT,
    siteVisit: { wmkf_attendeerefsjson: JSON.stringify({ version: 1,
      organizer: { kind: 'staff', profileId: 7 }, requiredAttendees: [], optionalAttendees: [] }) },
  };
  const result = await getMeetingTranscriptionCandidates(binding, {
    getContactsByIds: async () => [{ contactid: 'contact-pi', fullname: 'pi@example.org' }],
    queryCoPIs: async () => ({ records: [{ _wmkf_contact_value: 'contact-copi', wmkf_Contact: { fullname: 'co_pi@example.org' } }] }),
    getRecipientDirectory: async () => ({
      staff: [{ profileId: 7, name: 'Organizer Name' }], external: [],
    }),
  });
  expect(result.candidates).toEqual([{ id: 'attendee:staff:7', source: 'saved_staff', displayName: 'Organizer Name' }]);
  expect(result.candidateSources.savedAttendees.status).toBe('ready');
});

test('missing saved invitation map is reported unavailable rather than an empty successful source', async () => {
  const result = await getMeetingTranscriptionCandidates({
    requestId: REQUEST, request: {}, siteVisitActivityId: VISIT, siteVisit: {},
  }, {
    queryCoPIs: async () => ({ records: [] }), getRecipientDirectory: async () => ({ staff: [], external: [] }),
  });
  expect(result.candidateSources.savedAttendees).toEqual({ status: 'unavailable', reason: 'no_saved_invitation' });
});
