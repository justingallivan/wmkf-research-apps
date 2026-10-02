import crypto from 'node:crypto';
import { formatTranscriptText, formatTranscriptVtt, normalizeSpeakerNames } from '../transcription-pilot/transcript-format';

export const MEETING_TRANSCRIPT_BUNDLE_SCHEMA_VERSION = 1;
export const MEETING_TRANSCRIPT_FORMATTER_VERSION = '1';
export const MEETING_TRANSCRIPT_SOURCE_MAX_BYTES = 4_000_000;
export const MEETING_TRANSCRIPT_TXT_MAX_BYTES = 4_000_000;
export const MEETING_TRANSCRIPT_VTT_MAX_BYTES = 4_000_000;
const FILE_ROLES = Object.freeze(['txt', 'vtt', 'source']);
const SHA256 = /^[0-9a-f]{64}$/;
const GUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const exactKeys = (value, keys) => value && typeof value === 'object' && !Array.isArray(value)
  && Object.keys(value).sort().join(',') === [...keys].sort().join(',');

function fail() { const error = new TypeError('invalid_transcript_bundle'); error.code = 'invalid_transcript_bundle'; throw error; }
function utf8Size(value) { return Buffer.byteLength(value, 'utf8'); }
function digest(bytes) { return crypto.createHash('sha256').update(bytes).digest('hex'); }

function validateIdentity(identity) {
  if (!identity || !GUID.test(identity.requestId || '') || !GUID.test(identity.siteVisitActivityId || '')
    || !GUID.test(identity.revisionId || '') || !GUID.test(identity.operationId || '')
    || (identity.sourceRevisionId != null && !GUID.test(identity.sourceRevisionId))) fail();
}

function normalizeSource(content, names, identity) {
  const normalizedNames = normalizeSpeakerNames(content, names);
  const utterances = Array.isArray(content?.utterances) ? content.utterances.map((item) => {
    if (!item || !Number.isSafeInteger(item.start) || !Number.isSafeInteger(item.end)
      || item.start < 0 || item.end < item.start || typeof item.text !== 'string'
      || item.text.length > 20_000 || (item.speaker != null && !/^[A-Za-z0-9_-]{1,32}$/.test(item.speaker))) fail();
    return { speakerId: item.speaker || null, startMs: item.start, endMs: item.end, text: item.text };
  }) : [];
  const source = {
    schemaVersion: MEETING_TRANSCRIPT_BUNDLE_SCHEMA_VERSION,
    requestId: identity.requestId.toLowerCase(),
    siteVisitActivityId: identity.siteVisitActivityId.toLowerCase(),
    revisionId: identity.revisionId.toLowerCase(),
    text: typeof content?.text === 'string' ? content.text : '',
    utterances,
    speakerNames: normalizedNames,
  };
  const bytes = Buffer.from(JSON.stringify(source));
  if (bytes.length > MEETING_TRANSCRIPT_SOURCE_MAX_BYTES) fail();
  return { source, bytes, speakerNames: normalizedNames };
}

/** Freeze only normalized transcript data and validated human labels. */
export function buildMeetingTranscriptFiles({ content, speakerNames, identity }) {
  validateIdentity(identity);
  const { source, bytes: sourceBytes, speakerNames: names } = normalizeSource(content, speakerNames, identity);
  const formatterInput = { text: source.text, utterances: source.utterances.map((row) => ({
    speaker: row.speakerId, start: row.startMs, end: row.endMs, text: row.text,
  })) };
  const txt = Buffer.from(formatTranscriptText(formatterInput, names));
  const vtt = source.utterances.length ? Buffer.from(formatTranscriptVtt(formatterInput, names)) : null;
  if (txt.length > MEETING_TRANSCRIPT_TXT_MAX_BYTES || (vtt && vtt.length > MEETING_TRANSCRIPT_VTT_MAX_BYTES)) fail();
  const files = Object.freeze({
    txt: Object.freeze({ bytes: txt, sha256: digest(txt), filename: `transcript-${identity.revisionId}.txt`, contentType: 'text/plain; charset=utf-8' }),
    source: Object.freeze({ bytes: sourceBytes, sha256: digest(sourceBytes), filename: `transcript-source-${identity.revisionId}.json`, contentType: 'application/json' }),
    ...(vtt ? { vtt: Object.freeze({ bytes: vtt, sha256: digest(vtt), filename: `transcript-${identity.revisionId}.vtt`, contentType: 'text/vtt; charset=utf-8' }) } : {}),
  });
  return Object.freeze({
    files,
    sourceContent: source,
    speakerNames: names,
    publishable: Boolean(vtt),
    inputSha256: digest(Buffer.from(JSON.stringify({ source, formatterVersion: MEETING_TRANSCRIPT_FORMATTER_VERSION }))),
    formatterVersion: MEETING_TRANSCRIPT_FORMATTER_VERSION,
  });
}

function stableId(value) { return typeof value === 'string' && value.length > 0 && value.length <= 512 && !/[\u0000-\u001f\u007f]/.test(value); }

/** Strictly validate typed bundle metadata; media bytes remain out of the manifest. */
export function validateMeetingTranscriptManifest(manifest, expected = {}) {
  if (!exactKeys(manifest, ['schemaVersion','requestId','siteVisitActivityId','revisionId','operationId','sourceRevisionId','formatterVersion','files'])
    || manifest.schemaVersion !== MEETING_TRANSCRIPT_BUNDLE_SCHEMA_VERSION
    || !GUID.test(manifest.requestId || '') || !GUID.test(manifest.siteVisitActivityId || '')
    || !GUID.test(manifest.revisionId || '') || !GUID.test(manifest.operationId || '')
    || (manifest.sourceRevisionId != null && !GUID.test(manifest.sourceRevisionId))
    || manifest.formatterVersion !== MEETING_TRANSCRIPT_FORMATTER_VERSION
    || !manifest.files || typeof manifest.files !== 'object' || Array.isArray(manifest.files)
    || Object.keys(manifest.files).sort().join(',') !== [...FILE_ROLES].sort().join(',')) fail();
  if ((expected.requestId && expected.requestId.toLowerCase() !== manifest.requestId.toLowerCase())
    || (expected.siteVisitActivityId && expected.siteVisitActivityId.toLowerCase() !== manifest.siteVisitActivityId.toLowerCase())
    || (expected.revisionId && expected.revisionId.toLowerCase() !== manifest.revisionId.toLowerCase())) fail();
  const limits = { txt: MEETING_TRANSCRIPT_TXT_MAX_BYTES, vtt: MEETING_TRANSCRIPT_VTT_MAX_BYTES, source: MEETING_TRANSCRIPT_SOURCE_MAX_BYTES };
  for (const role of FILE_ROLES) {
    const file = manifest.files[role];
    if (!exactKeys(file, ['siteId','driveId','itemId','versionId','eTag','sha256','size','filename','contentType'])
      || !stableId(file.siteId) || !stableId(file.driveId) || !stableId(file.itemId)
      || !stableId(file.versionId) || !stableId(file.eTag) || !SHA256.test(file.sha256 || '')
      || !Number.isSafeInteger(file.size) || file.size < 1 || file.size > limits[role]
      || !stableId(file.filename) || !stableId(file.contentType)) fail();
  }
  if (manifest.files.txt.contentType !== 'text/plain; charset=utf-8'
    || manifest.files.vtt.contentType !== 'text/vtt; charset=utf-8'
    || manifest.files.source.contentType !== 'application/json') fail();
  const primary = expected.primaryFile;
  if (primary && ['siteId','driveId','itemId','versionId','eTag','filename','contentType','size','sha256']
    .some(key => String(primary[key] ?? '') !== String(manifest.files.txt[key] ?? ''))) fail();
  return manifest;
}

export function parseVerifiedMeetingTranscriptSource(bytes, descriptor, expected) {
  if (!Buffer.isBuffer(bytes) || !descriptor || bytes.length !== descriptor.size
    || bytes.length > MEETING_TRANSCRIPT_SOURCE_MAX_BYTES || digest(bytes) !== descriptor.sha256) fail();
  let source;
  try { source = JSON.parse(bytes.toString('utf8')); } catch { fail(); }
  if (!exactKeys(source, ['schemaVersion','requestId','siteVisitActivityId','revisionId','text','utterances','speakerNames'])
    || source.schemaVersion !== MEETING_TRANSCRIPT_BUNDLE_SCHEMA_VERSION
    || typeof source.text !== 'string'
    || source.requestId?.toLowerCase() !== expected.requestId.toLowerCase()
    || source.siteVisitActivityId?.toLowerCase() !== expected.siteVisitActivityId.toLowerCase()
    || source.revisionId?.toLowerCase() !== expected.revisionId.toLowerCase()
    || !Array.isArray(source.utterances)) fail();
  if (source.utterances.some(row => !exactKeys(row, ['speakerId','startMs','endMs','text']))) fail();
  const content = { text: source.text, utterances: source.utterances.map((row) => ({
    speaker: row.speakerId, start: row.startMs, end: row.endMs, text: row.text,
  })) };
  const names = normalizeSpeakerNames(content, source.speakerNames);
  normalizeSource(content, names, { ...expected, revisionId: source.revisionId, operationId: expected.operationId || source.revisionId });
  return Object.freeze({ content, speakerNames: names });
}

export function buildMeetingTranscriptManifest({ identity, files }) {
  validateIdentity(identity);
  const manifest = {
    schemaVersion: MEETING_TRANSCRIPT_BUNDLE_SCHEMA_VERSION,
    requestId: identity.requestId.toLowerCase(),
    siteVisitActivityId: identity.siteVisitActivityId.toLowerCase(),
    revisionId: identity.revisionId.toLowerCase(),
    operationId: identity.operationId.toLowerCase(),
    sourceRevisionId: identity.sourceRevisionId?.toLowerCase() || null,
    formatterVersion: MEETING_TRANSCRIPT_FORMATTER_VERSION,
    files,
  };
  return validateMeetingTranscriptManifest(manifest, identity);
}
