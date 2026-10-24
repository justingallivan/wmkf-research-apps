import fs from 'node:fs';
import {fencedMeetingFetch} from './meeting-rehearsal-write-fence.mjs';
if(!process.env.MEETING_REHEARSAL_SCOPE_FILE)throw Error('rehearsal_scope_required');
if(!globalThis.__meetingRehearsalFetchFence){globalThis.fetch=fencedMeetingFetch(globalThis.fetch.bind(globalThis),JSON.parse(fs.readFileSync(process.env.MEETING_REHEARSAL_SCOPE_FILE)));globalThis.__meetingRehearsalFetchFence=true;}
