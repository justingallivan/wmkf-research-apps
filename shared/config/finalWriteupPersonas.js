/**
 * Final Writeup audience and persona contract.
 *
 * The reviewer security role defines the complete acknowledgement audience.
 * Persona teams are deliberately separate, no-privilege Dataverse teams. A
 * staff member may belong to more than one team (for example, leadership and
 * Program Director). Team GUIDs stay null until the teams are created and
 * independently verified; persona lenses must fail closed until then.
 */

export const FINAL_WRITEUP_REVIEWER_ROLE_NAME = 'WMKF Final Writeup Reviewer';

export const FINAL_WRITEUP_PERSONA = Object.freeze({
  PROGRAM_DIRECTOR: 'program-director',
  PROGRAM_COORDINATOR: 'program-coordinator',
  LEADERSHIP: 'leadership',
});

export const FINAL_WRITEUP_PERSONA_TEAMS = Object.freeze([
  Object.freeze({
    persona: FINAL_WRITEUP_PERSONA.PROGRAM_DIRECTOR,
    teamName: 'WMKF Final Writeup Program Directors',
    teamId: null,
  }),
  Object.freeze({
    persona: FINAL_WRITEUP_PERSONA.PROGRAM_COORDINATOR,
    teamName: 'WMKF Final Writeup Program Coordinators',
    teamId: null,
  }),
  Object.freeze({
    persona: FINAL_WRITEUP_PERSONA.LEADERSHIP,
    teamName: 'WMKF Final Writeup Leadership',
    teamId: null,
  }),
]);

// Remains false until representative PC and leadership Word access is proved
// and the exact no-privilege team GUIDs above are pinned.
export const FINAL_WRITEUP_PERSONA_LENSES_ENABLED = false;
