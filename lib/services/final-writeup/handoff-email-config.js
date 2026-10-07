/**
 * Which Grant Programs send the group-review handoff email (Stage 4).
 *
 * FINAL_WRITEUP_HANDOFF_EMAIL_PROGRAM_IDS is a JSON list of Grant Program
 * GUIDs (owner 2026-10-07: Research only). Unset, invalid JSON, or entries
 * that are not GUIDs mean no email anywhere. Kept free of store imports so
 * the status readers can use it.
 */

import { isGuid } from '../../utils/guid.js';

export const FINAL_WRITEUP_HANDOFF_EMAIL_PROGRAM_IDS_ENV = 'FINAL_WRITEUP_HANDOFF_EMAIL_PROGRAM_IDS';

function normalizedGuid(value) {
  return isGuid(value) ? String(value).toLowerCase() : null;
}

export function readHandoffEmailProgramIds(env = process.env) {
  const raw = env?.[FINAL_WRITEUP_HANDOFF_EMAIL_PROGRAM_IDS_ENV];
  if (!raw) return [];
  let value;
  try { value = JSON.parse(raw); } catch { return []; }
  if (!Array.isArray(value)) return [];
  return [...new Set(value.map(normalizedGuid).filter(Boolean))];
}

export function isHandoffEmailEnabledForProgram(grantProgramId, env = process.env) {
  const programId = normalizedGuid(grantProgramId);
  return Boolean(programId) && readHandoffEmailProgramIds(env).includes(programId);
}
