/**
 * Adapter: wmkf_programlevel3s (the Keywords table).
 *
 * Each row is one keyword. `wmkf_keywordtype` separates Discipline, Method and
 * Object of Study keywords; `wmkf_keyworddisciplinebranch` (broad area, set on
 * Discipline rows only) and `wmkf_keyworddisciplinegroup` (subcategory) place it
 * in the taxonomy. Entity set, columns and values confirmed by the owner-run
 * `scripts/probe-keyword-taxonomy.cjs --target=prod`, 2026-11-19 (259 rows).
 *
 * The three taxonomy columns are choices; callers read their labels from the
 * `_formatted` siblings the Dynamics service adds.
 */

import { DynamicsService } from '../../services/dynamics-service.js';
import { entitySet } from '../core/entity-registry.js';

const ENTITY_SET = entitySet('wmkf_programlevel3s');

// statecode lets callers that offer keywords for new choices skip retired rows;
// listAll still returns them for callers that place existing lookups.
export const KEYWORD_SELECT = 'wmkf_programlevel3id,wmkf_name,wmkf_keywordtype,wmkf_keyworddisciplinebranch,wmkf_keyworddisciplinegroup,statecode';

/** Every keyword row, active or not (a request may still point at a retired one). */
export async function listAll() {
  return DynamicsService.queryAllRecords(ENTITY_SET, {
    select: KEYWORD_SELECT,
    filter: 'wmkf_programlevel3id ne null',
    orderby: 'wmkf_name asc',
  });
}

export const ENTITY_SET_NAME = ENTITY_SET;
