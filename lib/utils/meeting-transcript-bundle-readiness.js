/** Independent readiness gate for the optional governed transcript manifest field. */
export const MEETING_TRANSCRIPT_BUNDLE_SCHEMA_READY_FLAG = 'MEETING_TRACKER_TRANSCRIPT_BUNDLE_SCHEMA_READY';

export function isMeetingTranscriptBundleSchemaReady(env = process.env) {
  return env?.[MEETING_TRANSCRIPT_BUNDLE_SCHEMA_READY_FLAG] === 'on';
}
