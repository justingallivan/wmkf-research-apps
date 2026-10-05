import crypto from 'node:crypto';
import {
  formatTranscriptText, formatTranscriptVtt, normalizeSpeakerNames, normalizeUtteranceWordTimings,
  TRANSCRIPT_FORMATTER_VERSION, TRANSCRIPT_FORMATTER_VERSIONS,
} from '../transcription-pilot/transcript-format';

export const MEETING_TRANSCRIPT_BUNDLE_SCHEMA_VERSION = 4;
export const MEETING_TRANSCRIPT_FORMATTER_VERSION = TRANSCRIPT_FORMATTER_VERSION;
export const MEETING_TRANSCRIPT_SUPPORTED_FORMATTER_VERSIONS = TRANSCRIPT_FORMATTER_VERSIONS;
export const MEETING_TRANSCRIPT_SOURCE_MAX_BYTES = 4_000_000;
export const MEETING_TRANSCRIPT_TXT_MAX_BYTES = 4_000_000;
export const MEETING_TRANSCRIPT_VTT_MAX_BYTES = 4_000_000;
const FILE_ROLES = Object.freeze(['txt', 'vtt', 'source']);
const SUPPORTED_SCHEMA_VERSIONS = Object.freeze([1, 2, 3, 4]);
/** Schema version at which the bundle carries the confirmed presentation end (boundary). */
export const MEETING_TRANSCRIPT_BOUNDARY_SCHEMA_VERSION = 4;
const MANIFEST_KEYS = Object.freeze(['schemaVersion','requestId','siteVisitActivityId','revisionId','operationId','sourceRevisionId','formatterVersion','files']);
const SOURCE_KEYS = Object.freeze(['schemaVersion','requestId','siteVisitActivityId','revisionId','text','utterances','speakerNames']);
const PRESENTATION_END_KEYS = Object.freeze(['endMs','confirmedBy','confirmedAt']);
const ISO_INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/;
const SHA256 = /^[0-9a-f]{64}$/;
const DATAVERSE_GUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const GENERATED_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const exactKeys = (value, keys) => value && typeof value === 'object' && !Array.isArray(value)
  && Object.keys(value).sort().join(',') === [...keys].sort().join(',');

function fail() { const error = new TypeError('invalid_transcript_bundle'); error.code = 'invalid_transcript_bundle'; throw error; }
function carriesBoundary(schemaVersion) { return Number(schemaVersion) >= MEETING_TRANSCRIPT_BOUNDARY_SCHEMA_VERSION; }
function keysFor(base, schemaVersion) { return carriesBoundary(schemaVersion) ? [...base, 'presentationEnd'] : base; }

/**
 * The confirmed presentation end: `null` (not confirmed) or exactly
 * `{ endMs, confirmedBy, confirmedAt }`. `endMs` is milliseconds from the start
 * of the recording and must coincide with the end of a transcript utterance;
 * `confirmedBy` is the staff profile id; `confirmedAt` is a UTC instant.
 * Throws `invalid_transcript_bundle` on any other shape.
 */
export function normalizePresentationEnd(value, utterances = null) {
  if (value == null) return null;
  if (!exactKeys(value, PRESENTATION_END_KEYS)
    || !Number.isSafeInteger(value.endMs) || value.endMs < 0
    || !Number.isSafeInteger(value.confirmedBy) || value.confirmedBy < 1
    || typeof value.confirmedAt !== 'string' || !ISO_INSTANT.test(value.confirmedAt)
    || Number.isNaN(Date.parse(value.confirmedAt))) fail();
  if (Array.isArray(utterances) && !utterances.some(row => row.endMs === value.endMs)) fail();
  return Object.freeze({ endMs: value.endMs, confirmedBy: value.confirmedBy, confirmedAt: value.confirmedAt });
}
function utf8Size(value) { return Buffer.byteLength(value, 'utf8'); }
function digest(bytes) { return crypto.createHash('sha256').update(bytes).digest('hex'); }

function validateIdentity(identity) {
  if (!identity || !DATAVERSE_GUID.test(identity.requestId || '') || !DATAVERSE_GUID.test(identity.siteVisitActivityId || '')
    || !GENERATED_UUID.test(identity.revisionId || '') || !GENERATED_UUID.test(identity.operationId || '')
    || (identity.sourceRevisionId != null && !GENERATED_UUID.test(identity.sourceRevisionId))) fail();
  normalizePresentationEnd(identity.presentationEnd);
}

function schemaVersionFor(formatterVersion) {
  if (!MEETING_TRANSCRIPT_SUPPORTED_FORMATTER_VERSIONS.includes(formatterVersion)) fail();
  return Number(formatterVersion);
}

function formatterInputFromSource(source) {
  return { text: source.text, utterances: source.utterances.map((row) => ({
    speaker: row.speakerId, start: row.startMs, end: row.endMs, text: row.text,
    ...(row.words ? { words: row.words.map(word => ({ start: word.startMs, end: word.endMs, text: word.text })) } : {}),
  })) };
}

function normalizeSource(content, names, identity, formatterVersion) {
  const schemaVersion = schemaVersionFor(formatterVersion);
  const normalizedNames = normalizeSpeakerNames(content, names);
  const utterances = Array.isArray(content?.utterances) ? content.utterances.map((item) => {
    if (!item || !Number.isSafeInteger(item.start) || !Number.isSafeInteger(item.end)
      || item.start < 0 || item.end < item.start || typeof item.text !== 'string'
      || item.text.length > 20_000 || (item.speaker != null && !/^[A-Za-z0-9_-]{1,32}$/.test(item.speaker))) fail();
    const row = { speakerId: item.speaker || null, startMs: item.start, endMs: item.end, text: item.text };
    if (schemaVersion >= 2) {
      const words = normalizeUtteranceWordTimings(item);
      if (words) row.words = words.map(({ start, end, text }) => ({ startMs: start, endMs: end, text }));
    }
    return row;
  }) : [];
  const source = {
    schemaVersion,
    requestId: identity.requestId.toLowerCase(),
    siteVisitActivityId: identity.siteVisitActivityId.toLowerCase(),
    revisionId: identity.revisionId.toLowerCase(),
    text: typeof content?.text === 'string' ? content.text : '',
    utterances,
    speakerNames: normalizedNames,
  };
  // The boundary is frozen in the source envelope so recovery and identity
  // (inputSha256) cover it; pre-v4 envelopes cannot carry one.
  if (carriesBoundary(schemaVersion)) source.presentationEnd = normalizePresentationEnd(identity.presentationEnd ?? null, utterances);
  else if (identity.presentationEnd != null) fail();
  let bytes = Buffer.from(JSON.stringify(source));
  if (bytes.length > MEETING_TRANSCRIPT_SOURCE_MAX_BYTES && schemaVersion >= 2
    && source.utterances.some(row => row.words)) {
    source.utterances = source.utterances.map(({ words: _optionalWords, ...row }) => row);
    bytes = Buffer.from(JSON.stringify(source));
  }
  if (bytes.length > MEETING_TRANSCRIPT_SOURCE_MAX_BYTES) fail();
  return { source, bytes, speakerNames: normalizedNames };
}

/** Freeze only normalized transcript data and validated human labels. */
export function buildMeetingTranscriptFiles({ content, speakerNames, identity }) {
  validateIdentity(identity);
  const formatterVersion = identity.formatterVersion ?? MEETING_TRANSCRIPT_FORMATTER_VERSION;
  schemaVersionFor(formatterVersion);
  const { source, bytes: _initialSourceBytes, speakerNames: names } = normalizeSource(content, speakerNames, identity, formatterVersion);
  let sourceBytes = _initialSourceBytes;
  let formatterInput = formatterInputFromSource(source);
  const layout = Number(formatterVersion) >= 3 ? 'turn' : 'minute';
  let txt = Buffer.from(formatTranscriptText(formatterInput, names, { layout }));
  let vtt = source.utterances.length ? Buffer.from(formatTranscriptVtt(formatterInput, names)) : null;
  if ((txt.length > MEETING_TRANSCRIPT_TXT_MAX_BYTES || (vtt && vtt.length > MEETING_TRANSCRIPT_VTT_MAX_BYTES))
    && Number(formatterVersion) >= 2 && source.utterances.some(row => row.words)) {
    source.utterances = source.utterances.map(({ words: _optionalWords, ...row }) => row);
    sourceBytes = Buffer.from(JSON.stringify(source));
    formatterInput = formatterInputFromSource(source);
    txt = Buffer.from(formatTranscriptText(formatterInput, names, { layout }));
    vtt = source.utterances.length ? Buffer.from(formatTranscriptVtt(formatterInput, names)) : null;
  }
  if (sourceBytes.length > MEETING_TRANSCRIPT_SOURCE_MAX_BYTES || txt.length > MEETING_TRANSCRIPT_TXT_MAX_BYTES
    || (vtt && vtt.length > MEETING_TRANSCRIPT_VTT_MAX_BYTES)) fail();
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
    inputSha256: digest(Buffer.from(JSON.stringify({ source, formatterVersion }))),
    formatterVersion,
    presentationEnd: carriesBoundary(formatterVersion) ? source.presentationEnd : null,
  });
}

function stableId(value) { return typeof value === 'string' && value.length > 0 && value.length <= 512 && !/[\u0000-\u001f\u007f]/.test(value); }

/** Strictly validate typed bundle metadata; media bytes remain out of the manifest. */
export function validateMeetingTranscriptManifest(manifest, expected = {}) {
  if (!manifest || !SUPPORTED_SCHEMA_VERSIONS.includes(manifest.schemaVersion)
    || !exactKeys(manifest, keysFor(MANIFEST_KEYS, manifest.schemaVersion))
    || String(manifest.schemaVersion) !== manifest.formatterVersion
    || !DATAVERSE_GUID.test(manifest.requestId || '') || !DATAVERSE_GUID.test(manifest.siteVisitActivityId || '')
    || !GENERATED_UUID.test(manifest.revisionId || '') || !GENERATED_UUID.test(manifest.operationId || '')
    || (manifest.sourceRevisionId != null && !GENERATED_UUID.test(manifest.sourceRevisionId))
    || !manifest.files || typeof manifest.files !== 'object' || Array.isArray(manifest.files)
    || Object.keys(manifest.files).sort().join(',') !== [...FILE_ROLES].sort().join(',')) fail();
  if (carriesBoundary(manifest.schemaVersion)) normalizePresentationEnd(manifest.presentationEnd);
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
  if (!source || !SUPPORTED_SCHEMA_VERSIONS.includes(source.schemaVersion)
    || !exactKeys(source, keysFor(SOURCE_KEYS, source.schemaVersion))
    || typeof source.text !== 'string'
    || source.requestId?.toLowerCase() !== expected.requestId.toLowerCase()
    || source.siteVisitActivityId?.toLowerCase() !== expected.siteVisitActivityId.toLowerCase()
    || source.revisionId?.toLowerCase() !== expected.revisionId.toLowerCase()
    || !Array.isArray(source.utterances)) fail();
  if (source.utterances.some(row => {
    const legacyKeys = ['speakerId','startMs','endMs','text'];
    if (source.schemaVersion === 1) return !exactKeys(row, legacyKeys);
    return !exactKeys(row, row?.words == null ? legacyKeys : [...legacyKeys, 'words']);
  })) fail();
  if (source.schemaVersion >= 2 && source.utterances.some(row => row.words != null && !Array.isArray(row.words))) fail();
  const content = { text: source.text, utterances: source.utterances.map((row) => ({
    speaker: row.speakerId, start: row.startMs, end: row.endMs, text: row.text,
    ...(row.words ? { words: row.words.map(word => ({ start: word.startMs, end: word.endMs, text: word.text })) } : {}),
  })) };
  if (source.schemaVersion >= 2 && content.utterances.some((utterance, index) => {
    const sourceWords = source.utterances[index].words;
    return sourceWords != null && (!Array.isArray(sourceWords)
      || sourceWords.some(word => !exactKeys(word, ['startMs','endMs','text'])
        || !Number.isSafeInteger(word.startMs) || !Number.isSafeInteger(word.endMs)
        || typeof word.text !== 'string')
      || !normalizeUtteranceWordTimings(utterance));
  })) fail();
  const names = normalizeSpeakerNames(content, source.speakerNames);
  const presentationEnd = carriesBoundary(source.schemaVersion) ? normalizePresentationEnd(source.presentationEnd, source.utterances) : null;
  normalizeSource(content, names, { ...expected, revisionId: source.revisionId, operationId: expected.operationId || source.revisionId, presentationEnd }, String(source.schemaVersion));
  return Object.freeze({ content, speakerNames: names, formatterVersion: String(source.schemaVersion), presentationEnd });
}

export function buildMeetingTranscriptManifest({ identity, files }) {
  validateIdentity(identity);
  const formatterVersion = identity.formatterVersion ?? MEETING_TRANSCRIPT_FORMATTER_VERSION;
  const schemaVersion = schemaVersionFor(formatterVersion);
  const manifest = {
    schemaVersion,
    requestId: identity.requestId.toLowerCase(),
    siteVisitActivityId: identity.siteVisitActivityId.toLowerCase(),
    revisionId: identity.revisionId.toLowerCase(),
    operationId: identity.operationId.toLowerCase(),
    sourceRevisionId: identity.sourceRevisionId?.toLowerCase() || null,
    formatterVersion,
    files,
    ...(carriesBoundary(schemaVersion) ? { presentationEnd: normalizePresentationEnd(identity.presentationEnd ?? null) } : {}),
  };
  return validateMeetingTranscriptManifest(manifest, identity);
}
