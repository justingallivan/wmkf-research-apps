'use strict';

// Client-safe identity for the single, synthetic, no-CRM rehearsal fixture.
// Keep this module free of server-only imports and credentials.
const REHEARSAL_REQUEST_ID = '37eea062-5888-44a5-b338-c6e6a14c783e';
const REHEARSAL_SITE_VISIT_ACTIVITY_ID = '70a3b1a6-4893-4ad4-911a-5a80c9bcbdbc';
const REHEARSAL_JOB_ID = '6f6f99ea-3d73-44a9-85e4-6fd6ec931f04';
const REHEARSAL_OWNER_PROFILE_ID = 1;
const REHEARSAL_OUTPUT_PATH = `transcription-pilot/${REHEARSAL_OWNER_PROFILE_ID}/${REHEARSAL_JOB_ID}/output/transcript.json`;
const REHEARSAL_TRANSCRIPT = Object.freeze({
  text: 'Synthetic rehearsal transcript. No recording or provider response was used.',
  utterances: Object.freeze([
    Object.freeze({ start: 0, end: 1800, speaker: 'A', text: 'This is a fictional speaker-label rehearsal.' }),
    Object.freeze({ start: 62000, end: 64100, speaker: 'B', text: 'The sample project will review a make-believe community grant.' }),
    Object.freeze({ start: 124000, end: 126300, speaker: 'C', text: 'Speaker names are saved only to the isolated test database.' }),
  ]),
});
const REHEARSAL_CANDIDATES = Object.freeze([
  Object.freeze({ id: 'fixture-pi', displayName: 'Dr. Ada Example', source: 'pi' }),
  Object.freeze({ id: 'fixture-co-pi', displayName: 'Dr. Noah Sample', source: 'co_pi' }),
  Object.freeze({ id: 'fixture-staff', displayName: 'Riley Fiction', source: 'saved_staff' }),
  Object.freeze({ id: 'fixture-attendee', displayName: 'Morgan Imaginary', source: 'saved_attendee' }),
]);
const REHEARSAL_CANDIDATE_SOURCES = Object.freeze({
  pi: Object.freeze({ status: 'available' }),
  coPIs: Object.freeze({ status: 'available' }),
  savedAttendees: Object.freeze({ status: 'available' }),
});

module.exports = {
  REHEARSAL_REQUEST_ID,
  REHEARSAL_SITE_VISIT_ACTIVITY_ID,
  REHEARSAL_JOB_ID,
  REHEARSAL_OWNER_PROFILE_ID,
  REHEARSAL_OUTPUT_PATH,
  REHEARSAL_TRANSCRIPT,
  REHEARSAL_CANDIDATES,
  REHEARSAL_CANDIDATE_SOURCES,
};
