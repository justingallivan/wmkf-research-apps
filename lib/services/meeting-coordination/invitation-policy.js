/** Disabled-by-default request-scoped presentation invitation admission; no storage reads. */
import {isGuid} from '../../utils/guid.js';
import {parseMeetingTranscriptionAccess} from '../meeting-tracker-transcription/policy.js';
export function invitationEnabled(requestId){
 if(!isGuid(requestId||''))return false;
 const access=parseMeetingTranscriptionAccess(process.env.MEETING_PRESENTATION_INVITATION_ACCESS);
 return access.mode==='on'||(access.mode==='test'&&access.requestId===requestId.toLowerCase());
}
