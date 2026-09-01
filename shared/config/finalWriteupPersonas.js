/**
 * Final Writeup audience and persona contract.
 *
 * The reviewer security role defines the complete acknowledgement audience.
 * Explicit, multi-valued persona assignments live in the versioned Final
 * Writeup staffing setting. Runtime authorization always comes from the
 * published v2 setting plus current direct reviewer-role membership.
 */

export const FINAL_WRITEUP_REVIEWER_ROLE_NAME = 'WMKF Final Writeup Reviewer';

export const FINAL_WRITEUP_PERSONA = Object.freeze({
  PROGRAM_DIRECTOR: 'program-director',
  PROGRAM_COORDINATOR: 'program-coordinator',
  LEADERSHIP: 'leadership',
});

export const FINAL_WRITEUP_PERSONA_ORDER = Object.freeze([
  FINAL_WRITEUP_PERSONA.PROGRAM_DIRECTOR,
  FINAL_WRITEUP_PERSONA.PROGRAM_COORDINATOR,
  FINAL_WRITEUP_PERSONA.LEADERSHIP,
]);

// Remains false until v2 is published/read back and representative PC and
// leadership Word access is proved.
export const FINAL_WRITEUP_PERSONA_LENSES_ENABLED = false;
