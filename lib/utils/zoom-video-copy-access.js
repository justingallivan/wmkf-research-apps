/**
 * Rollout control for the Zoom meeting video copy (Stage 3b). Same idiom as
 * postPresentationMaterialsAccess: unset/off, on, or one exact `test:<request GUID>`;
 * any other value fails closed as off with valid:false.
 */

import { isGuid } from './guid.js';

export const ZOOM_VIDEO_COPY_ACCESS_FLAG = 'ZOOM_VIDEO_COPY_ACCESS';

export function zoomVideoCopyAccess(env = process.env) {
  const value = env?.[ZOOM_VIDEO_COPY_ACCESS_FLAG];
  if (value === undefined || value === '' || value === 'off') {
    return { mode: 'off', requestId: null, valid: true };
  }
  if (value === 'on') return { mode: 'on', requestId: null, valid: true };
  if (typeof value === 'string' && value === value.trim() && value.startsWith('test:')) {
    const requestId = value.slice('test:'.length);
    // isGuid trims, so `test: <guid>` would pass it; the stored id must be the bare GUID.
    if (isGuid(requestId) && requestId === requestId.trim()) {
      return { mode: 'test', requestId: requestId.toLowerCase(), valid: true };
    }
  }
  return { mode: 'off', requestId: null, valid: false };
}

export function isZoomVideoCopyRequestAllowed(requestId, env = process.env) {
  const access = zoomVideoCopyAccess(env);
  if (!access.valid || !isGuid(requestId)) return false;
  if (access.mode === 'on') return true;
  return access.mode === 'test' && requestId.toLowerCase() === access.requestId;
}
