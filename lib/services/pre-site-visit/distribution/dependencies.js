import crypto from 'node:crypto';
import * as grantRequestAdapter from '../../../dataverse/adapters/grant-request.js';
import * as requestDocumentAdapter from '../../../dataverse/adapters/request-document.js';
import * as emailActivityAdapter from '../../../dataverse/adapters/email-activity.js';
import * as siteVisitAdapter from '../../../dataverse/adapters/site-visit.js';
import * as systemUserAdapter from '../../../dataverse/adapters/system-user.js';
import { GraphService } from '../../graph-service.js';
import { hashGovernedDocxContent } from '../../documents/governed-docx-hash.js';
import { isSiteVisitLogisticsSchemaReady } from '../../../utils/site-visit-logistics-readiness.js';
import { isDeliberationBriefingSchemaReady } from '../../../utils/deliberation-briefing-readiness.js';
import { getSettingStrict } from '../../settings-service.js';
import { ensureLiveBriefingLink, getLiveBriefingLink } from '../../deliberation-briefing/briefing-link-service';
import { getDeliberationSessionForRequest } from '../../deliberation-briefing/session-reader.js';
import { resolveCurrentPreRpBriefForDistribution } from '../../pre-rp-brief/artifact-service.js';
import { loadPreRpBriefInputs } from '../../pre-rp-brief/input-service.js';
import * as store from '../distribution-store.js';
import { REQUEST_SELECT } from './model.js';
const DEFAULT_DEPENDENCIES = Object.freeze({
  getRequest: (requestId) => grantRequestAdapter.getById(requestId, { select: REQUEST_SELECT }),
  // Brief source resolution (plan §3, slice 4): reused from the slice-3
  // artifact service rather than duplicated pointer-resolution logic.
  resolveCurrentBrief: resolveCurrentPreRpBriefForDistribution,
  loadPreRpBriefInputs,
  findDocumentsByRequest: requestDocumentAdapter.findByRequest,
  findDocumentByGenerationKey: requestDocumentAdapter.findByGenerationKey,
  createDocument: requestDocumentAdapter.create,
  updateDocument: requestDocumentAdapter.update,
  getFileMetadataById: (...args) => GraphService.getFileMetadataById(...args),
  getFileMetadataByPath: (...args) => GraphService.getFileMetadataByPath(...args),
  ensureFolderPath: (...args) => GraphService.ensureFolderPath(...args),
  uploadFile: (...args) => GraphService.uploadFile(...args),
  downloadFile: (...args) => GraphService.downloadFile(...args),
  downloadFileByPath: (...args) => GraphService.downloadFileByPath(...args),
  downloadFileVersion: (...args) => GraphService.downloadFileVersion(...args),
  downloadFileAsPdf: (...args) => GraphService.downloadFileAsPdf(...args),
  hashDocx: hashGovernedDocxContent,
  createEmailActivity: emailActivityAdapter.create,
  addEmailAttachment: emailActivityAdapter.addAttachment,
  sendEmail: emailActivityAdapter.send,
  getEmailActivity: emailActivityAdapter.getById,
  findEmailByCorrelation: emailActivityAdapter.findByCorrelation,
  findEmailAttachments: emailActivityAdapter.findAttachments,
  getEmailAttachmentContent: emailActivityAdapter.getAttachmentById,
  getSiteVisitById: siteVisitAdapter.getById,
  schemaReady: isSiteVisitLogisticsSchemaReady,
  briefingReady: isDeliberationBriefingSchemaReady,
  ensureBriefingLink: (requestId, actorId) => ensureLiveBriefingLink({ requestId, actorId }),
  // Tracker §5.4 reader via the briefing seam; fail-open null ("not yet scheduled").
  getSession: getDeliberationSessionForRequest,
  getSettingStrict,
  recordBriefingLink: store.recordDistributionBriefingLink,
  getLiveBriefingLink: (requestId) => getLiveBriefingLink({ requestId }),
  createOrGetAttempt: store.createOrGetDistributionAttempt,
  getAttempt: store.getDistributionAttempt,
  listAttempts: store.listDistributionAttempts,
  // Staff-history name for a drift-acknowledging actor (plan §8 item iii).
  // Same select shape as the sibling system-user readers; null when the
  // user row has no full name.
  getSystemUserName: async (systemUserId) => {
    const user = await systemUserAdapter.getByIdWithSelect(systemUserId, 'systemuserid,fullname');
    return user?.fullname || null;
  },
  hasSentAttemptForSource: store.hasSentAttemptForSource,
  recordSource: store.recordDistributionSource,
  recordPrepared: store.recordDistributionPrepared,
  claimSend: store.claimDistributionSend,
  recordEmailActivity: store.recordDistributionEmailActivity,
  recordAttachment: store.recordDistributionAttachment,
  recordSendRequested: store.recordDistributionSendRequested,
  renewSendLease: store.renewDistributionSendLease,
  recordSent: store.recordDistributionSent,
  recordFailure: store.recordDistributionFailure,
  now: () => new Date(),
  randomUUID: () => crypto.randomUUID(),
});
export { DEFAULT_DEPENDENCIES };
