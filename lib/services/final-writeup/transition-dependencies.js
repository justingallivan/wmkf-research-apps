/** Final Writeup default adapter/Graph binding retained behind the facade. */
import crypto from 'crypto';
import * as grantRequestAdapter from '../../dataverse/adapters/grant-request.js';
import * as requestDocumentAdapter from '../../dataverse/adapters/request-document.js';
import { runChangeset } from '../../dataverse/core/changeset.js';
import { isFinalWriteupSchemaReady } from '../../utils/final-writeup-readiness.js';
import { GraphService } from '../graph-service.js';
import { hashGovernedDocxContent } from '../documents/governed-docx-hash.js';

import { resolveRequestDocumentActor } from '../request-document-actor-service.js';
import { REQUEST_SELECT } from './transition-model.js';

export const DEFAULT_DEPENDENCIES = Object.freeze({
  getRequest: (requestId) => grantRequestAdapter.getById(requestId, { select: REQUEST_SELECT }),
  findByRequest: requestDocumentAdapter.findByRequest,
  findByGenerationKey: requestDocumentAdapter.findByGenerationKey,
  createDocument: requestDocumentAdapter.create,
  updateDocument: requestDocumentAdapter.update,
  commitChangeset: runChangeset,
  getFileMetadataById: (...args) => GraphService.getFileMetadataById(...args),
  downloadFile: (...args) => GraphService.downloadFile(...args),
  hashDocx: hashGovernedDocxContent,
  newClaimToken: () => crypto.randomUUID(),
  now: () => new Date(),
  schemaReady: isFinalWriteupSchemaReady,
  resolveActor: resolveRequestDocumentActor,
});
