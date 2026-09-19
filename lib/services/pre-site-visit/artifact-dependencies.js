/**
 * Single default dependency object for Pre-Site artifact operations.
 * Keep captured adapter references and dynamic Graph wrappers intact.
 */
import crypto from 'crypto';
import * as grantRequestAdapter from '../../dataverse/adapters/grant-request.js';
import * as requestDocumentAdapter from '../../dataverse/adapters/request-document.js';
import { runChangeset } from '../../dataverse/core/changeset.js';
import { fetchCurrentPrompt } from '../prompt-store.js';
import { GraphService } from '../graph-service.js';
import { isGuardedReopenSchemaReady } from '../../utils/guarded-reopen-readiness.js';
import { getRequestSharePointBuckets } from '../../utils/sharepoint-buckets.js';
import { hashGovernedDocxContent } from '../documents/governed-docx-hash.js';
import {
  generatePreSiteVisitProposalCoreFromInputs,
  loadPreSiteVisitInputs,
} from './proposal-core-service.js';
import { renderPreSiteVisitDocx } from './docx-renderer.js';
import {
  REQUEST_LINEAGE_SELECT,
} from './artifact-model.js';

export const DEFAULT_DEPENDENCIES = Object.freeze({
  loadInputs: loadPreSiteVisitInputs,
  getCurrentPrompt: fetchCurrentPrompt,
  runProposalCore: generatePreSiteVisitProposalCoreFromInputs,
  renderDocx: renderPreSiteVisitDocx,
  hashDocx: hashGovernedDocxContent,
  getRequest: (requestId) => grantRequestAdapter.getById(requestId, {
    select: REQUEST_LINEAGE_SELECT,
  }),
  getBuckets: getRequestSharePointBuckets,
  findByGenerationKey: requestDocumentAdapter.findByGenerationKey,
  findByRequest: requestDocumentAdapter.findByRequest,
  createDocument: requestDocumentAdapter.create,
  updateDocument: requestDocumentAdapter.update,
  commitChangeset: runChangeset,
  ensureFolderPath: (...args) => GraphService.ensureFolderPath(...args),
  uploadFile: (...args) => GraphService.uploadFile(...args),
  getFileMetadataByPath: (...args) => GraphService.getFileMetadataByPath(...args),
  downloadFile: (...args) => GraphService.downloadFile(...args),
  deleteFile: (...args) => GraphService.deleteFile(...args),
  newClaimToken: () => crypto.randomUUID(),
  isGuardedReopenSchemaReady,
});
