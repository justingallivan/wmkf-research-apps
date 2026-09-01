/**
 * Server-only suggestions used to seed the v1→v2 Admin migration draft.
 *
 * These stable Dataverse user IDs are presentation defaults, never runtime
 * authorization. The published v2 setting plus current direct reviewer-role
 * membership remain authoritative.
 */

import { FINAL_WRITEUP_PERSONA } from '../../../shared/config/finalWriteupPersonas.js';

export const FINAL_WRITEUP_PERSONA_SUGGESTIONS = Object.freeze([
  Object.freeze({
    reviewerId: '10b0de0d-4ff7-ee11-a1fd-000d3a3621c7',
    roles: Object.freeze([FINAL_WRITEUP_PERSONA.PROGRAM_DIRECTOR]),
  }),
  Object.freeze({
    reviewerId: 'b6f1cd38-0973-f011-bec3-6045bd0510d4',
    roles: Object.freeze([
      FINAL_WRITEUP_PERSONA.PROGRAM_DIRECTOR,
      FINAL_WRITEUP_PERSONA.LEADERSHIP,
    ]),
  }),
  Object.freeze({
    reviewerId: 'b53a3bf8-507f-ee11-8179-000d3a341e8f',
    roles: Object.freeze([FINAL_WRITEUP_PERSONA.PROGRAM_DIRECTOR]),
  }),
  Object.freeze({
    reviewerId: '73d32260-aa8b-f111-ab0f-70a8a59cded0',
    roles: Object.freeze([FINAL_WRITEUP_PERSONA.PROGRAM_DIRECTOR]),
  }),
  Object.freeze({
    reviewerId: '29b0de0d-4ff7-ee11-a1fd-000d3a3621c7',
    roles: Object.freeze([FINAL_WRITEUP_PERSONA.PROGRAM_DIRECTOR]),
  }),
  Object.freeze({
    reviewerId: '79dd1e0e-4ff7-ee11-a1fd-000d3a341fd9',
    roles: Object.freeze([FINAL_WRITEUP_PERSONA.PROGRAM_DIRECTOR]),
  }),
  Object.freeze({
    reviewerId: '4ff27133-2316-f011-998a-6045bd02b4cc',
    roles: Object.freeze([FINAL_WRITEUP_PERSONA.PROGRAM_DIRECTOR]),
  }),
  Object.freeze({
    reviewerId: 'e642f92d-3d99-ee11-be37-000d3a341fd9',
    roles: Object.freeze([FINAL_WRITEUP_PERSONA.PROGRAM_COORDINATOR]),
  }),
  Object.freeze({
    reviewerId: '700b842b-e769-f111-a826-000d3a3065b8',
    roles: Object.freeze([FINAL_WRITEUP_PERSONA.PROGRAM_COORDINATOR]),
  }),
  Object.freeze({
    reviewerId: 'd6f510f5-507f-ee11-8179-000d3a341fd9',
    roles: Object.freeze([FINAL_WRITEUP_PERSONA.PROGRAM_COORDINATOR]),
  }),
  Object.freeze({
    reviewerId: '975a6b00-4ff7-ee11-a1fd-000d3a341fd9',
    roles: Object.freeze([FINAL_WRITEUP_PERSONA.LEADERSHIP]),
  }),
]);
