/**
 * Typed adapter for wmkf_finalwriteupreviewacknowledgements (Wave 23).
 *
 * The composite Final Document + Reviewer alternate key is the durable
 * cardinality guard. This adapter exposes only named reads plus create/update;
 * callers own readiness, authorization, and lost-response reconciliation.
 */

import { DynamicsService } from '../../services/dynamics-service.js';
import { entitySet } from '../core/entity-registry.js';
import * as odata from '../core/odata.js';

const ENTITY_SET = entitySet('wmkf_finalwriteupreviewacknowledgements');
export const ACKNOWLEDGEMENT_BATCH_MAX_FINAL_IDS = 25;

export const ACKNOWLEDGEMENT_SELECT_FIELDS = Object.freeze([
  'wmkf_finalwriteupreviewacknowledgementid',
  'wmkf_name',
  '_wmkf_finaldocument_value',
  '_wmkf_reviewer_value',
  'wmkf_sharepointdriveid',
  'wmkf_sharepointitemid',
  'wmkf_publicationversionid',
  'wmkf_acknowledgedetag',
  'wmkf_sharepointlastmodified',
  'wmkf_acknowledgedat',
  'createdon',
  'modifiedon',
]);

const SELECT = odata.select(ACKNOWLEDGEMENT_SELECT_FIELDS);

export async function findByFinalDocument(finalDocumentId) {
  return DynamicsService.queryAllRecords(ENTITY_SET, {
    select: SELECT,
    filter: odata.eqGuid('_wmkf_finaldocument_value', finalDocumentId),
    orderby: 'wmkf_acknowledgedat asc',
  });
}

export async function findByFinalDocumentAndReviewer(finalDocumentId, reviewerId) {
  return DynamicsService.queryRecords(ENTITY_SET, {
    select: SELECT,
    filter: odata.and([
      odata.eqGuid('_wmkf_finaldocument_value', finalDocumentId),
      odata.eqGuid('_wmkf_reviewer_value', reviewerId),
    ]),
    top: 2,
  });
}

/**
 * Read acknowledgements for a bounded set of server-derived current Final rows.
 * Callers chunk larger sets and reject capped results rather than silently
 * presenting an incomplete reviewer projection.
 */
export async function findByFinalDocuments(finalDocumentIds) {
  if (!Array.isArray(finalDocumentIds)) {
    throw new Error(
      'final-writeup-review-acknowledgement.findByFinalDocuments: finalDocumentIds must be an array',
    );
  }
  const ids = [...new Set(finalDocumentIds.map((id) => String(id || '').toLowerCase()))];
  if (ids.length === 0) return { records: [], totalCount: 0, capped: false };
  if (ids.length > ACKNOWLEDGEMENT_BATCH_MAX_FINAL_IDS) {
    throw new Error(
      'final-writeup-review-acknowledgement.findByFinalDocuments: '
        + `at most ${ACKNOWLEDGEMENT_BATCH_MAX_FINAL_IDS} Final IDs are supported`,
    );
  }
  return DynamicsService.queryAllRecords(ENTITY_SET, {
    select: SELECT,
    filter: `(${odata.or(ids.map((id) => odata.eqGuid('_wmkf_finaldocument_value', id)))})`,
    orderby: 'wmkf_acknowledgedat asc',
  });
}

export async function create(payload, options) {
  return DynamicsService.createRecord(ENTITY_SET, payload, options);
}

export async function update(id, patch, options) {
  return DynamicsService.updateRecord(ENTITY_SET, id, patch, options);
}

export const ENTITY_SET_NAME = ENTITY_SET;
