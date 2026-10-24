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
