import { linkedCycleCode } from '../../dataverse/adapters/operations-grant-cycle.js';

const D26_REQUEST_NUMBER_CUTOFF = 1003220;

/** Apply the December 2026 trial boundary to request rows read with the linked-cycle expand. Other cycles pass through unchanged. */
export function applyProposalRankingTrialCutoff(rows) {
  let excludedRequestCount = 0;
  const requests = rows.filter((row) => {
    if (linkedCycleCode(row) !== 'D26') return true;

    const requestNumber = row?.akoya_requestnum;
    if (typeof requestNumber !== 'string' || !/^\d+$/.test(requestNumber) || !Number.isSafeInteger(Number(requestNumber))) {
      throw new Error('December 2026 Proposal Ranking trial encountered a missing or malformed request number.');
    }
    if (Number(requestNumber) >= D26_REQUEST_NUMBER_CUTOFF) {
      excludedRequestCount += 1;
      return false;
    }
    return true;
  });

  return { requests, excludedRequestCount };
}
