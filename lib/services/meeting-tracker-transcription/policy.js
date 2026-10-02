/** Independent, fail-closed controls for Meeting Tracker transcription. */
export const MEETING_TRANSCRIPTION_ACCESS_ENV = 'MEETING_TRACKER_TRANSCRIPTION_ACCESS';
export const MEETING_TRANSCRIPTION_SCHEMA_ENV = 'MEETING_TRACKER_TRANSCRIPTION_SCHEMA_READY';

export function parseMeetingTranscriptionAccess(value) {
  if (value === 'on') return Object.freeze({ mode: 'on', requestId: null });
  if (typeof value === 'string') {
    const match = value.match(/^test:([0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})$/i);
    if (match) return Object.freeze({ mode: 'test', requestId: match[1].toLowerCase() });
  }
  return Object.freeze({ mode: 'off', requestId: null });
}

export function isMeetingTranscriptionSchemaReady(value) {
  return value === 'on';
}

export function isMeetingTranscriptionRequestAllowed(requestId, accessValue) {
  const access = parseMeetingTranscriptionAccess(accessValue);
  if (access.mode === 'on') return true;
  return access.mode === 'test' && typeof requestId === 'string'
    && requestId.toLowerCase() === access.requestId;
}

export function getMeetingTranscriptionControls(env = process.env) {
  return Object.freeze({
    schemaReady: isMeetingTranscriptionSchemaReady(env[MEETING_TRANSCRIPTION_SCHEMA_ENV]),
    access: parseMeetingTranscriptionAccess(env[MEETING_TRANSCRIPTION_ACCESS_ENV]),
  });
}

export function requireMeetingTranscriptionEnabled(requestId, env = process.env) {
  const controls = getMeetingTranscriptionControls(env);
  if (!controls.schemaReady || !isMeetingTranscriptionRequestAllowed(requestId, env[MEETING_TRANSCRIPTION_ACCESS_ENV])) {
    const error = new Error('meeting_transcription_disabled');
    error.code = 'meeting_transcription_disabled';
    error.httpStatus = 503;
    throw error;
  }
  return controls;
}
