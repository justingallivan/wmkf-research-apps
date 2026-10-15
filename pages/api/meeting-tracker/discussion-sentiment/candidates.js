import { requireAppAccess } from '../../../../lib/utils/auth.js';
import { actorRefFromSession } from '../../../../lib/utils/actor-ref.js';
import { isGuid } from '../../../../lib/utils/guid.js';
import { withDalContext } from '../../../../lib/dataverse/core/context.js';
import { ServiceHttpError } from '../../../../lib/services/service-http-error.js';
import { parseCycleCode } from '../../../../lib/utils/cycle-code.js';
import {
  listDiscussionSentimentCandidates,
} from '../../../../lib/services/post-presentation-materials/discussion-sentiment-candidates.js';

export const config = { maxDuration: 60 };

// The cycle's requests are listed server-side exactly as the schedule dashboard lists them (optionally for one program); requests in it whose Staff Discussion Transcript is bound; ids and compact analysis statuses, plus `capped` when the list may be incomplete.
export default async function handler(req, res) {
  if (req.method !== 'GET') { res.setHeader('Allow', 'GET'); return res.status(405).json({ error: 'Method not allowed' }); }
  const access = await requireAppAccess(req, res, 'meeting-tracker');
  if (!access) return;
  if (!Number.isSafeInteger(access.profileId) || access.profileId < 1) return res.status(401).json({ error: 'An active linked staff profile is required.' });
  const cycleCode = Array.isArray(req.query.cycleCode) ? '' : String(req.query.cycleCode || '').trim();
  if (!parseCycleCode(cycleCode)) return res.status(400).json({ error: 'Choose a valid grant cycle.', code: 'sentiment_cycle_invalid' });
  const programId = Array.isArray(req.query.programId) ? null : String(req.query.programId || '').trim();
  if (programId === null || (programId && !isGuid(programId))) return res.status(400).json({ error: 'Choose a valid grant program.', code: 'sentiment_program_invalid' });
  const azureEmail = access.session?.user?.azureEmail;
  if (!azureEmail) return res.status(400).json({ error: 'Could not determine your email from the session. Sign out and back in.' });
  res.setHeader('Cache-Control', 'private, no-store');
  return withDalContext('meeting-tracker-discussion-sentiment-candidates', async () => {
    try {
      return res.status(200).json(await listDiscussionSentimentCandidates({
        cycleCode, ownerProfileId: access.profileId,
        caller: { azureEmail, profileId: access.profileId, callerSystemId: actorRefFromSession(access.session), programId: programId || undefined },
      }));
    } catch (error) {
      const status = error instanceof ServiceHttpError ? error.httpStatus : Number(error?.httpStatus || error?.status) || 500;
      const code = error?.code || 'discussion_sentiment_candidates_failed';
      if (status >= 500) console.error('[meeting tracker discussion sentiment candidates] failed:', code);
      return res.status(status).json(error?.body || { error: status >= 500 ? 'The proposal list could not be loaded.' : error.message, code });
    }
  });
}
