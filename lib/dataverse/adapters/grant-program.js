/**
 * Adapter: wmkf_grantprograms (broad request process-family definitions).
 *
 * Final Writeup matrix configuration keys by the stable lookup GUID while
 * resolving wmkf_name live for Admin and matrix display. This is deliberately
 * the broad request Grant Program axis (Research, Southern California, etc.),
 * not the finer akoya_program taxonomy.
 */

import { DynamicsService } from '../../services/dynamics-service.js';
import { entitySet } from '../core/entity-registry.js';

const ENTITY_SET = entitySet('wmkf_grantprograms');

export async function listActive({ top = 50 } = {}) {
  const safeTop = Math.max(1, Math.min(Number(top) || 50, 100));
  return DynamicsService.queryRecords(ENTITY_SET, {
    select: 'wmkf_grantprogramid,wmkf_name,statecode',
    filter: 'statecode eq 0',
    orderby: 'wmkf_name asc',
    top: safeTop,
  });
}

export const ENTITY_SET_NAME = ENTITY_SET;
