/**
 * Adapter: wmkf_requestdocuments (governed request artifact registry).
 */

import { DynamicsService } from '../../services/dynamics-service.js';
import { entitySet } from '../core/entity-registry.js';
import * as odata from '../core/odata.js';

const ENTITY_SET = entitySet('wmkf_requestdocuments');

export const REQUEST_DOCUMENT_SELECT = [
  'wmkf_requestdocumentid',
  'wmkf_name',
  'wmkf_artifacttype',
  'wmkf_operationstatus',
  'wmkf_lifecyclestate',
  'wmkf_generationkey',
  'wmkf_cyclecode',
  'wmkf_inputfingerprint',
  'wmkf_renderinputfingerprint',
  'wmkf_claimtoken',
  'wmkf_producer',
  'wmkf_templateid',
  'wmkf_templateversion',
  'wmkf_promptname',
  'wmkf_promptversion',
  'wmkf_sharepointsiteid',
  'wmkf_sharepointdriveid',
  'wmkf_sharepointitemid',
  'wmkf_sharepointweburl',
  'wmkf_sharepointversionid',
  'wmkf_sharepointetag',
  'wmkf_sharepointfolderpath',
  'wmkf_filename',
  'wmkf_filesize',
  'wmkf_contenthash',
  'wmkf_contenttype',
  'wmkf_presiteexecutivesummary',
  'wmkf_presiteimpactoverview',
  'wmkf_presitemethodologyoverview',
  'wmkf_presitepersonneloverview',
  'wmkf_presitekeckfundingrationale',
  'wmkf_presitebackgroundandimpact',
  'wmkf_presitedetailedmethodology',
  'wmkf_presitepersonneldetails',
  'wmkf_presiteproposalcorejson',
  'wmkf_presiteinputsnapshotjson',
  'wmkf_sourceversionid',
  'wmkf_sourcecontenthash',
  'wmkf_milestoneversionid',
  'wmkf_milestonecontenthash',
  'wmkf_milestonecreatedat',
  'wmkf_sharepointlastmodified',
  'wmkf_attemptcount',
  'wmkf_lasterrorcode',
  'wmkf_lasterrormessage',
  'wmkf_orphancleanupjson',
  'wmkf_orphancleanupoverflowjson',
  'wmkf_lastfailedat',
  '_wmkf_request_value',
  '_wmkf_aiprompt_value',
  '_wmkf_airun_value',
  '_wmkf_sourcedocument_value',
  'createdon',
  'modifiedon',
].join(',');

export async function findByGenerationKey(generationKey) {
  return DynamicsService.queryRecords(ENTITY_SET, {
    select: REQUEST_DOCUMENT_SELECT,
    filter: odata.eq('wmkf_generationkey', generationKey),
    top: 2,
  });
}

export async function findByRequest(requestId, { artifactType } = {}) {
  const filters = [odata.eqGuid('_wmkf_request_value', requestId)];
  if (artifactType !== undefined) {
    filters.push(odata.eqRaw('wmkf_artifacttype', Number(artifactType)));
  }
  return DynamicsService.queryAllRecords(ENTITY_SET, {
    select: REQUEST_DOCUMENT_SELECT,
    filter: odata.and(filters),
    orderby: 'createdon desc',
  });
}

export async function findByCycle(cycleCode, { artifactType } = {}) {
  const filters = [odata.eq('wmkf_cyclecode', String(cycleCode).toUpperCase())];
  if (artifactType !== undefined) {
    filters.push(odata.eqRaw('wmkf_artifacttype', Number(artifactType)));
  }
  return DynamicsService.queryAllRecords(ENTITY_SET, {
    select: REQUEST_DOCUMENT_SELECT,
    filter: odata.and(filters),
    orderby: 'createdon desc',
  });
}

export async function findArtifactCycles(artifactType) {
  return DynamicsService.queryAllRecords(ENTITY_SET, {
    select: 'wmkf_cyclecode,wmkf_lifecyclestate,createdon',
    filter: odata.eqRaw('wmkf_artifacttype', Number(artifactType)),
    orderby: 'createdon desc',
  });
}

export async function create(payload, options) {
  return DynamicsService.createRecord(ENTITY_SET, payload, options);
}

export async function update(id, patch, options) {
  return DynamicsService.updateRecord(ENTITY_SET, id, patch, options);
}

export const ENTITY_SET_NAME = ENTITY_SET;
