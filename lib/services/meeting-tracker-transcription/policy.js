/** Independent, fail-closed controls for Meeting Tracker transcription. */
import { isGuid } from '../../utils/guid.js';

export const MEETING_TRANSCRIPTION_ACCESS_ENV = 'MEETING_TRACKER_TRANSCRIPTION_ACCESS';
export const MEETING_TRANSCRIPTION_SCHEMA_ENV = 'MEETING_TRACKER_TRANSCRIPTION_SCHEMA_READY';

export function parseMeetingTranscriptionAccess(value) {
  if (value === 'on') return Object.freeze({ mode: 'on', requestId: null });
  if (typeof value === 'string') {
    const match = value.match(/^test:(.+)$/i);
    if (match && isGuid(match[1])) return Object.freeze({ mode: 'test', requestId: match[1].toLowerCase() });
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
