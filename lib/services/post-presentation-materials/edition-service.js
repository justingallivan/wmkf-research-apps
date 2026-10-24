/** Coordinator-only enrollment, review, atomic approval and withdrawal of retained presentation editions. */
import crypto from 'node:crypto';
import * as requestDocument from '../../dataverse/adapters/request-document.js';
import * as grantRequest from '../../dataverse/adapters/grant-request.js';
import { GraphService } from '../graph-service.js';
import { requireCoordinatorAccess, resolveCoordinatorAccess } from '../meeting-coordination/coordinator-access.js';
import { isPostPresentationMaterialsSchemaReady, isPostPresentationMaterialsRequestAllowed } from '../../utils/post-presentation-materials-readiness.js';
import { isGuid } from '../../utils/guid.js';
import { REQUEST_DOCUMENT_ARTIFACT_TYPE as TYPE } from '../../../shared/config/requestDocument.js';
import { ServiceHttpError } from '../service-http-error.js';
import { projectPostPresentationMaterials } from './material-model.js';
import { bindPresentationTranscript, bindTranscriptSummary } from './presentation-transcript-binding.js';
import { bindPresentationVideo } from './presentation-video-binding.js';
import { freezeEditionMember, editionFingerprint, editionMemberBytesMatch } from './edition-model.js';
import * as store from './edition-store.js';
import * as leases from './slot-lease-store.js';
import { getApprovedPresentationVideoByDocument } from '../meeting-tracker-recordings/presentation-video-split-store.js';

const MUTATION_TYPES = [TYPE.RECORDING, TYPE.TRANSCRIPT, TYPE.PRESENTATION_TRANSCRIPT, TYPE.TRANSCRIPT_SUMMARY, TYPE.PRESENTATION_VIDEO].sort((a,b) => a-b);
const DEFAULTS = {
  schemaReady: isPostPresentationMaterialsSchemaReady, requestAllowed: isPostPresentationMaterialsRequestAllowed,
  getRequest: id => grantRequest.getById(id, { select: ['akoya_requestid'] }),
  findDocuments: id => requestDocument.findByRequest(id, { includeMeetingTranscriptBundle: true }),
  getCut: (requestId, documentId) => getApprovedPresentationVideoByDocument({ requestId, requestDocumentId: documentId }),
  media: (driveId, itemId) => GraphService.resolveMediaDownloadUrl(driveId, itemId),
  download: (driveId, itemId) => GraphService.downloadFile(driveId, itemId, { maxBytes: 4 * 1024 * 1024 }),
  canCoordinate: resolveCoordinatorAccess, requireCoordinator: requireCoordinatorAccess,
  read: store.readPresentationVisibility, enroll: store.enrollPresentationApproval,
  approve: store.approvePresentationEdition, withdraw: store.withdrawPresentationEdition,
  acquire: leases.acquirePresentationSlotLease, renew: leases.renewPresentationSlotLease, release: leases.releasePresentationSlotLease,
};
function fail(code, message, httpStatus = 409) { throw new ServiceHttpError(message, { httpStatus, code }); }
function actorOf(args) { return { profileId: args.profileId, actingUserSystemId: args.actingUserSystemId }; }
async function verifyRequest(requestId, d) {
  if (!isGuid(requestId)) fail('invalid_request_id', 'A valid request is required.', 400);
  if (!d.schemaReady() || !d.requestAllowed(requestId)) fail('presentation_not_available', 'Presentation materials are not available.', 503);
  const request = await d.getRequest(requestId);
  if (request?.akoya_requestid?.toLowerCase() !== requestId.toLowerCase()) fail('request_not_found', 'Request not found.', 404);
}
function snapshot(row) {
  return row ? { enrolled: true, version: Number(row.version), activeEditionId: row.active_edition_id,
    approvedAt: row.approved_at || null, withdrawnAt: row.withdrawn_at || null } : { enrolled: false, version: 0, activeEditionId: null };
}
export async function currentEditionCandidate(requestId, d = DEFAULTS) {
  const result = await d.findDocuments(requestId);
  if (result?.capped) fail('presentation_documents_incomplete', 'All presentation records could not be checked.', 503);
  const winners = projectPostPresentationMaterials(result?.records || [], requestId).winners;
  const transcript = bindPresentationTranscript(winners, requestId);
  const { summary } = bindTranscriptSummary(winners, requestId);
  const { video } = bindPresentationVideo(winners, requestId);
  if (!transcript.presentationTranscript || !transcript.boundary || !summary || !video) {
    return { ready: false, message: 'Prepare the presentation transcript, summary and video for the same checked presentation ending.' };
  }
  const cut = await d.getCut(requestId, video.wmkf_requestdocumentid);
  let members;
  try { members = [freezeEditionMember(transcript.presentationTranscript), freezeEditionMember(summary), freezeEditionMember(video, cut)]; }
  catch { return { ready: false, message: 'The presentation files need verification before they can be approved.' }; }
  const revisionId = transcript.boundary.revisionId;
  const endMs = transcript.boundary.presentationEnd.endMs;
  return { ready: true, revisionId, endMs, members, fingerprint: editionFingerprint({ revisionId, endMs, members }) };
}
export async function getPresentationApproval(args, d = DEFAULTS) {
  await verifyRequest(args.requestId, d);
  const [row, canApprove, candidate] = await Promise.all([
    d.read(args.requestId), d.canCoordinate(actorOf(args)), currentEditionCandidate(args.requestId, d).catch(() => ({ ready: false, message: 'Current presentation files could not be checked. Refresh before approving a replacement.' })),
  ]);
  return { ...snapshot(row), canApprove, candidate: candidate.ready
    ? { ready: true, fingerprint: candidate.fingerprint, presentationEndMs: candidate.endMs }
    : candidate };
}
export async function mutatePresentationApproval(args, d = DEFAULTS) {
  const { requestId, body } = args;
  await verifyRequest(requestId, d); await d.requireCoordinator(actorOf(args));
  if (body.action === 'enroll') {
    if (body.expectedVersion !== 0) fail('presentation_edition_changed', 'Board approval changed. Refresh before continuing.');
    return snapshot(await d.enroll({ requestId, profileId: args.profileId }));
  }
  const row = await d.read(requestId);
  if (!row || Number(row.version) !== body.expectedVersion) fail('presentation_edition_changed', 'Board approval changed. Refresh before continuing.');
  if (body.action === 'withdraw') {
    return d.withdraw({ requestId, profileId: args.profileId, expectedVersion: body.expectedVersion, expectedEditionId: body.expectedEditionId });
  }
  if (body.action !== 'approve' || body.videoReviewed !== true || body.summaryReviewed !== true) fail('presentation_review_required', 'Check the presentation ending and review the summary before approving.', 400);
  const token = crypto.randomUUID(); const held = [];
  try {
    // Existing artifact writers use these same per-type leases. Hold the source and all presentation slots through approval.
    for (const artifactType of MUTATION_TYPES) {
      const lease = await d.acquire({ requestId, artifactType, leaseToken: token });
      if (!lease) fail('presentation_materials_busy', 'Presentation materials are changing. Try again shortly.');
      held.push({ requestId, artifactType, leaseToken: token, fenceVersion: Number(lease.fence_version) });
    }
    const candidate = await currentEditionCandidate(requestId, d);
    if (!candidate.ready || candidate.fingerprint !== body.candidateFingerprint) fail('presentation_candidate_changed', 'The presentation changed. Refresh and review it again.');
    for (const member of candidate.members) {
      const media = await d.media(member.driveId, member.itemId);
      if (!editionMemberBytesMatch(member, media)) fail('presentation_file_changed', 'A presentation file changed. Prepare and review it again.');
      if (member.type !== TYPE.PRESENTATION_VIDEO) {
        const downloaded = await d.download(member.driveId, member.itemId);
        if (!Buffer.isBuffer(downloaded?.buffer) || downloaded.buffer.length !== member.size
          || crypto.createHash('sha256').update(downloaded.buffer).digest('hex') !== member.sha256) {
          fail('presentation_file_changed', 'A presentation file changed. Prepare and review it again.');
        }
      }
    }
    // Refresh the leases and role after external waits, before the atomic pointer switch.
    for (const lease of held) if (!await d.renew(lease)) fail('presentation_approval_lease_lost', 'Presentation materials changed. Review them again.');
    await d.requireCoordinator(actorOf(args));
    return d.approve({ requestId, profileId: args.profileId, expectedVersion: body.expectedVersion,
      commandId: body.commandId, revisionId: candidate.revisionId, endMs: candidate.endMs,
      members: candidate.members, fingerprint: candidate.fingerprint });
  } finally {
    for (const lease of held.reverse()) await d.release(lease).catch(() => {});
  }
}
