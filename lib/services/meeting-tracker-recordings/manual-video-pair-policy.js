import {isMeetingTranscriptionRequestAllowed} from '../meeting-tracker-transcription/policy.js';
/** Separate rollout gate: existing Zoom split admission does not opt requests into manual pairing. */
export const manualVideoPairEnabled=requestId=>isMeetingTranscriptionRequestAllowed(requestId,process.env.MEETING_MANUAL_VIDEO_PAIRING_ACCESS);
