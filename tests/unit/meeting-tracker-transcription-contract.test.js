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

  it('round-trips exact bounded source bytes and hash for later corrections', () => {
    const generated = buildMeetingTranscriptFiles({ content, speakerNames: { A: 'PI', B: 'Co-PI' }, identity });
    expect(generated.files.source.bytes.length).toBeLessThanOrEqual(4_000_000);
    expect(digest(generated.files.source.bytes)).toBe(generated.files.source.sha256);
    const parsed = parseVerifiedMeetingTranscriptSource(generated.files.source.bytes, {
      size: generated.files.source.bytes.length, sha256: generated.files.source.sha256,
    }, identity);
    expect(parsed.content).toEqual({ text: '', ...content });
    expect(parsed.speakerNames).toEqual({ A: 'PI', B: 'Co-PI' });
    expect(generated.files.txt.bytes.toString()).toContain('1:00\nPI: Hello, team.');
    expect(generated.files.vtt.bytes.toString()).toContain('00:01:02.000 --> 00:01:02.900\nPI: Hello, team.');
  });

  it('preserves provider text when diarization returned no utterances', () => {
    const transcriptText = 'A complete plain text transcript without diarized turns.';
    const generated = buildMeetingTranscriptFiles({ content: { text: transcriptText, utterances: [] }, speakerNames: {}, identity });
    expect(generated.files.txt.bytes.toString()).toBe(`${transcriptText}\n`);
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
