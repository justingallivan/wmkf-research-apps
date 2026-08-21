/**
 * POST /api/workbench/reviewer-address-trust
 *
 * Authenticated reviewer-workbench actions for exact-address attestation,
 * retry/reload, and durable repair escalation. Client action labels confer no
 * authority: this route allowlists actions and every service re-reads the exact
 * request/candidate roster row.
 */

import { requireAppAccess } from '../../../lib/utils/auth';
import { isGuid } from '../../../lib/utils/guid';
import { withDalContext } from '../../../lib/dataverse/core/context';
import {
  verifyPersonAndAddress,
  getAddressConflict,
  retryAddressCheck,
  createAddressRepairRequest,
} from '../../../lib/services/reviewer-address-trust-service';
import { withRemediation } from '../../../lib/utils/reviewer-remediation';

const ACTIONS = new Set([
  'verify_person_and_address',
  'get_address_conflict',
  'retry_check',
  'create_repair_request',
]);

export const config = { api: { bodyParser: { sizeLimit: '64kb' } } };

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }
  const access = await requireAppAccess(req, res, 'reviewer-finder', 'reviewers');
  if (!access) return;

  const requestId = typeof req.body?.requestId === 'string' ? req.body.requestId.trim() : '';
  const candidateKey = typeof req.body?.candidateKey === 'string' ? req.body.candidateKey.trim() : '';
  const suggestionId = typeof req.body?.suggestionId === 'string' ? req.body.suggestionId.trim() : '';
  const action = typeof req.body?.action === 'string' ? req.body.action.trim() : '';
  const hasRosterKey = !!candidateKey && candidateKey.length <= 1200;
  const hasSuggestion = isGuid(suggestionId);
  if (!isGuid(requestId) || (!hasRosterKey && !(
    (action === 'create_repair_request' || action === 'verify_person_and_address')
    && hasSuggestion
  ))) {
    return res.status(400).json({ error: 'Valid requestId and reviewer identifier are required' });
  }
  if (!ACTIONS.has(action)) {
    return res.status(400).json(withRemediation({
      success: false,
      decision: 'blocked',
      code: 'unknown_action',
      message: 'That reviewer repair action is not supported.',
    }));
  }

  const actor = {
    actorProfileId: access.profileId || null,
    actorSystemUserId: access.session?.user?.dynamicsSystemuserId || null,
  };

  return withDalContext('workbench-reviewer-address-trust', async () => {
    try {
      let result;
      if (action === 'verify_person_and_address') {
        result = await verifyPersonAndAddress({
          requestId,
          candidateKey,
          suggestionId,
          email: req.body?.email,
          verifiedContact: req.body?.verifiedContact,
          evidenceType: req.body?.evidenceType,
          evidenceUrl: req.body?.evidenceUrl,
          note: req.body?.note,
          ...actor,
        });
      } else if (action === 'get_address_conflict') {
        result = await getAddressConflict({ requestId, candidateKey });
      } else if (action === 'retry_check') {
        result = await retryAddressCheck({
          requestId,
          candidateKey,
          code: req.body?.code,
          ...actor,
        });
      } else {
        result = await createAddressRepairRequest({
          requestId,
          candidateKey,
          suggestionId,
          code: req.body?.code,
          ...actor,
        });
      }
      return res.status(result.success === false ? 409 : 200).json(result);
    } catch (error) {
      const status = /required|unsupported|valid HTTP|exceeds/i.test(error?.message || '') ? 400 : 500;
      if (status === 500) console.error('reviewer-address-trust action failed:', error);
      return res.status(status).json(withRemediation({
        success: false,
        decision: 'blocked',
        code: status === 400 ? 'invalid_address_attestation' : 'address_trust_action_failed',
        message: status === 400
          ? error.message
          : 'The address action could not be completed. Retry or create a repair request.',
      }));
    }
  });
}
