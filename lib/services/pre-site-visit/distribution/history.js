/** Pre-Site distribution history projection and actor-name recovery. */
import { isGuid } from '../../../utils/guid.js';
import { PRE_RP_BRIEF_CONTRACT } from '../../../../shared/config/requestDocument.js';
import { DEFAULT_DEPENDENCIES } from './dependencies.js';
import { distributionError, sameId, projectDistributionAttempt } from './model.js';
import { readDeliberationShareDefaults } from './context.js';

async function resolveAcknowledgingActorNames(attempts, dependencies) {
  if (typeof dependencies.getSystemUserName !== 'function') return null;
  const ids = [...new Set(
    attempts
      .map((attempt) => String(attempt.stale_inputs_acknowledged_by || '').toLowerCase())
      .filter((id) => isGuid(id)),
  )];
  if (ids.length === 0) return null;
  const names = new Map();
  await Promise.all(ids.map(async (id) => {
    try {
      const name = await dependencies.getSystemUserName(id);
      if (name) names.set(id, String(name));
    } catch (error) {
      console.error('[pre-site distribution history] actor name read failed:', error?.message || error);
    }
  }));
  return names;
}
export async function getPreSiteDistributionHistory(
  { requestId },
  dependencies = DEFAULT_DEPENDENCIES,
) {
  if (!isGuid(requestId)) {
    throw distributionError('requestId must be a GUID.', 'distribution_request_invalid', 400);
  }
  const [attempts, currentSource, briefingLink, emailDefaults] = await Promise.all([
    dependencies.listAttempts(requestId),
    (async () => {
      try {
        const request = await dependencies.getRequest(requestId);
        const documentId = request?._wmkf_currentprerpbrief_value || null;
        if (!documentId) return null;
        const result = await dependencies.findDocumentsByRequest(requestId, {
          artifactType: PRE_RP_BRIEF_CONTRACT.artifactType,
        });
        const row = (result.records || []).find((candidate) => (
          sameId(candidate.wmkf_requestdocumentid, documentId)
        ));
        if (!row?.wmkf_sharepointdriveid || !row?.wmkf_sharepointitemid) {
          return { documentId, versionId: null };
        }
        const metadata = await dependencies.getFileMetadataById(
          row.wmkf_sharepointdriveid,
          row.wmkf_sharepointitemid,
          { siteId: row.wmkf_sharepointsiteid || null },
        );
        return { documentId, versionId: metadata?.versionId || null };
      } catch {
        return null;
      }
    })(),
    // Live briefing link for the staff header (plan §2.4); null when the flag
    // is off or the caller's dependency set does not wire the link service.
    (async () => {
      if (typeof dependencies.briefingReady !== 'function' || !dependencies.briefingReady()) return null;
      if (typeof dependencies.getLiveBriefingLink !== 'function') return null;
      try {
        return await dependencies.getLiveBriefingLink(requestId);
      } catch (error) {
        console.error('[pre-site distribution history] briefing link read failed:', error?.message || error);
        return null;
      }
    })(),
    readDeliberationShareDefaults(dependencies),
  ]);
  const actorNames = await resolveAcknowledgingActorNames(attempts, dependencies);
  return {
    briefingLink,
    emailDefaults,
    attempts: attempts.map((attempt) => {
      let sourceFreshness = 'unknown';
      if (attempt.source_version_id && currentSource?.documentId) {
        sourceFreshness = !sameId(currentSource.documentId, attempt.source_document_id)
          || (currentSource.versionId && currentSource.versionId !== attempt.source_version_id)
          ? 'changed'
          : currentSource.versionId ? 'current' : 'unknown';
      }
      return projectDistributionAttempt(attempt, { sourceFreshness, actorNames });
    }),
    // Wrap Up derivation input (S466): uncapped EXISTS scoped to the CURRENT
    // source document, so display-limit truncation cannot regress the stage
    // and a superseded document's sends cannot promote its reopen successor.
    currentSourceEverSent: currentSource?.documentId
      ? await dependencies.hasSentAttemptForSource(requestId, currentSource.documentId)
      : false,
  };
}
