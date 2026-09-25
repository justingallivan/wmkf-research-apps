/**
 * Rollout boundaries for post-presentation materials.
 *
 * Schema readiness and feature access are deliberately independent: metadata
 * can be present without authorizing any producer or consumer. Both controls
 * fail closed on unset or malformed values.
 */

import { isGuid } from './guid.js';

export const POST_PRESENTATION_MATERIALS_SCHEMA_READY_FLAG =
  'POST_PRESENTATION_MATERIALS_SCHEMA_READY';
export const POST_PRESENTATION_MATERIALS_ACCESS_FLAG =
  'POST_PRESENTATION_MATERIALS_ACCESS';

export function isPostPresentationMaterialsSchemaReady(env = process.env) {
  return env?.[POST_PRESENTATION_MATERIALS_SCHEMA_READY_FLAG] === 'on';
}

export function postPresentationMaterialsAccess(env = process.env) {
  const value = env?.[POST_PRESENTATION_MATERIALS_ACCESS_FLAG];
  if (value === undefined || value === '' || value === 'off') {
    return { mode: 'off', requestId: null, valid: true };
  }
  if (value === 'on') return { mode: 'on', requestId: null, valid: true };
  if (typeof value === 'string' && value === value.trim() && value.startsWith('test:')) {
    const requestId = value.slice('test:'.length);
    if (isGuid(requestId)) {
      return { mode: 'test', requestId: requestId.toLowerCase(), valid: true };
    }
  }
  return { mode: 'off', requestId: null, valid: false };
}

export function isPostPresentationMaterialsRequestAllowed(requestId, env = process.env) {
  const access = postPresentationMaterialsAccess(env);
  if (!access.valid || !isGuid(requestId)) return false;
  if (access.mode === 'on') return true;
  return access.mode === 'test' && requestId.toLowerCase() === access.requestId;
}
