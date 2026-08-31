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

export async function create(payload, options) {
  return DynamicsService.createRecord(ENTITY_SET, payload, options);
}

export async function update(id, patch, options) {
  return DynamicsService.updateRecord(ENTITY_SET, id, patch, options);
}

export const ENTITY_SET_NAME = ENTITY_SET;
