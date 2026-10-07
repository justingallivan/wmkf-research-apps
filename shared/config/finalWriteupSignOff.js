/**
 * Final Writeup sign-off roster contract (group-review handoff Stage 3).
 *
 * The acknowledgement service produces these values for the lead Program
 * Director and superusers; the Workbench Final Writeup tab consumes them.
 * Both sides import this module so a new value cannot drift between them.
 */

// One person's sign-off on the current writeup. A sign-off on an earlier
// SharePoint version still counts (owner decision A, 2026-10-06).
export const FINAL_WRITEUP_SIGN_OFF_STATE = Object.freeze({
  SIGNED: 'signed',
  SIGNED_EDITED_SINCE: 'signed-edited-since',
  NOT_YET: 'not-yet',
});

// Whether the request has a list of expected Program Directors at all.
export const FINAL_WRITEUP_SIGN_OFF_ROSTER_STATUS = Object.freeze({
  CONFIGURED: 'configured',
  // The request's Grant Program has no entry in the staffing setting.
  PROGRAM_NOT_CONFIGURED: 'program-not-configured',
  // No published v2 staffing setting, so there are no persona assignments.
  STAFFING_NOT_CONFIGURED: 'staffing-not-configured',
  // The staffing setting or reviewer roster could not be read.
  UNAVAILABLE: 'unavailable',
});

export function isFinalWriteupSignedOff(state) {
  return state === FINAL_WRITEUP_SIGN_OFF_STATE.SIGNED
    || state === FINAL_WRITEUP_SIGN_OFF_STATE.SIGNED_EDITED_SINCE;
}
