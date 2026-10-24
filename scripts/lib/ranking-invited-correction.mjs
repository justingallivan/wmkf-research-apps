/**
 * Pure logic for scripts/correct-ranking-invited-amounts.mjs: rebuilds an open
 * Proposal Ranking round's frozen snapshot with invited amounts, changing only
 * amountMinorUnits (where it differs) and adding amountSource: 'invited'.
 * Plan: docs/plans/PROPOSAL_RANKING_D26_INVITED_AMOUNT_CORRECTION_2026-10-23.md.
 */

import crypto from 'crypto';
import { moneyToMinorUnits } from '../../lib/services/proposal-ranking/calculations.js';

export const EVENT_TYPE = 'invited-amount-correction';

export const sha = (text) => crypto.createHash('sha256').update(text).digest('hex');

/**
 * @param {string} snapshotJson stored wmkf_snapshotjson
 * @param {Map<string, object>} liveById live akoya_request rows keyed by lowercase requestId
 * @returns {{ snapshotJson: string, changes: object[] }}
 */
export function correctSnapshot(snapshotJson, liveById) {
  const snapshot = JSON.parse(snapshotJson);
  // The edit must not reformat anything it does not mean to change.
  if (JSON.stringify(snapshot) !== snapshotJson) throw new Error('Stored snapshot does not round-trip through JSON unchanged.');
  if (snapshot.version !== 2 || !Array.isArray(snapshot.proposals)) throw new Error('Snapshot is not a version-2 round.');
  const changes = [];
  const proposals = snapshot.proposals.map((proposal) => {
    const live = liveById.get(String(proposal.requestId).toLowerCase());
    const label = `#${proposal.requestNumber}`;
    if (!live) throw new Error(`${label}: live request not found.`);
    if (live.wmkf_istestrequest === true || live.wmkf_testcreationrunid != null) throw new Error(`${label}: live request is a test request.`);
    if (live.wmkf_invitedamount == null) throw new Error(`${label}: invited amount is blank.`);
    const precision = proposal.currency?.precision;
    if (!proposal.currency?.code || !Number.isInteger(precision)) throw new Error(`${label}: frozen currency is missing.`);
    const invited = moneyToMinorUnits(live.wmkf_invitedamount, precision);
    if (invited == null) throw new Error(`${label}: invited amount cannot be represented in the frozen currency.`);
    if (invited !== proposal.amountMinorUnits) {
      // Only correct values that are still the frozen requested amount.
      if (moneyToMinorUnits(live.akoya_request, precision) !== proposal.amountMinorUnits) {
        throw new Error(`${label}: frozen amount is not the live requested amount; refusing to guess.`);
      }
      changes.push({ requestId: proposal.requestId, requestNumber: String(proposal.requestNumber), fromMinorUnits: proposal.amountMinorUnits, toMinorUnits: invited });
    }
    return { ...proposal, amountMinorUnits: invited, amountSource: 'invited' };
  });
  return { snapshotJson: JSON.stringify({ ...snapshot, proposals }), changes };
}

/** Append one correction event to the round administration log. */
export function appendCorrectionEvent(logJson, event, maxBytes = 131072) {
  const events = logJson ? JSON.parse(logJson) : [];
  if (!Array.isArray(events)) throw new Error('Round administration log is not a list.');
  const json = JSON.stringify([...events, { type: EVENT_TYPE, ...event }]);
  if (Buffer.byteLength(json, 'utf8') > maxBytes) throw new Error('Round administration log would exceed its storage limit.');
  return json;
}

/** What the round's stored snapshot and log are, relative to a plan. */
export function roundStateVs(round, plan) {
  const snapshotSha = sha(round.wmkf_snapshotjson || '');
  const log = round.wmkf_administrationlogjson ?? null;
  if (snapshotSha === plan.corrected.snapshotSha && log === plan.corrected.logJson) return 'corrected';
  if (snapshotSha === plan.original.snapshotSha && log === plan.original.logJson) return 'original';
  return 'other';
}

/**
 * Evidence of any app write since the plan. Every app round write stamps
 * wmkf_lastoperationid (service.js actorPatch; workflow-service.js stamp), and v2
 * actions also rewrite wmkf_workflowjson and list rows. This script's own PATCH
 * changes none of the three, so an empty result means no PD or facilitator write.
 */
export function activitySincePlan(round, lists, plan) {
  const reasons = [];
  if ((round.wmkf_lastoperationid ?? null) !== plan.baseline.lastOperationId) reasons.push('round last operation changed');
  if (sha(round.wmkf_workflowjson || '') !== plan.baseline.workflowSha) reasons.push('workflow state changed');
  if (JSON.stringify(lists) !== JSON.stringify(plan.baseline.lists)) reasons.push('list rows changed');
  return reasons;
}

/** Decide --apply from stored state, so a lost response or crash can be re-run. */
export function decideApply(round, plan) {
  const state = roundStateVs(round, plan);
  if (state === 'corrected') return { action: 'done' };
  if (state === 'original' && round['@odata.etag'] === plan.etag) return { action: 'patch' };
  if (state === 'original') return { action: 'refuse', reason: 'the round changed since the plan (ETag moved); re-run --plan.' };
  return { action: 'refuse', reason: 'stored snapshot or log matches neither the original nor the corrected plan state.' };
}

/** Decide --rollback from stored state; refuse if anyone wrote to the round since the plan. */
export function decideRollback(round, lists, plan) {
  const state = roundStateVs(round, plan);
  if (state === 'original') return { action: 'done' };
  if (state !== 'corrected') return { action: 'refuse', reason: 'stored snapshot or log matches neither the original nor the corrected plan state.' };
  const activity = activitySincePlan(round, lists, plan);
  if (activity.length) return { action: 'refuse', reason: `app activity since the plan (${activity.join('; ')}); plan a reverse edit from current state instead.` };
  return { action: 'patch' };
}
