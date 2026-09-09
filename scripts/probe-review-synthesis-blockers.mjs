#!/usr/bin/env node
/**
 * Read-only: why review synthesis is blocked for one request. Runs the same
 * readiness evaluator the synthesize route uses over the same suggestion
 * rows, and prints each participant's classification. Prints suggestion ids,
 * lifecycle fields, token timing, and the blocker reason — never reviewer
 * names, emails, or review content.
 *
 * Usage: DATAVERSE_ALLOW_PROD_READS=yes node scripts/probe-review-synthesis-blockers.mjs --request=1002959
 */
import fs from 'fs';
import './lib/use-extensionless.mjs';
for (const file of ['.env', '.env.local']) {
  try {
    for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
      const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
      if (m && !(m[1] in process.env)) process.env[m[1]] = m[2].trim().replace(/^"(.*)"$/, '$1').replace(/^'(.*)'$/, '$1');
    }
  } catch {}
}
const requestNumber = process.argv.find((a) => a.startsWith('--request='))?.slice(10);
if (!requestNumber) throw new Error('Pass --request=<number>.');
if (process.env.DATAVERSE_ALLOW_PROD_READS !== 'yes') throw new Error('Requires DATAVERSE_ALLOW_PROD_READS=yes (owner-run).');

const { enterDynamicsBypassForScript } = await import('../lib/services/dynamics-context.js');
const { withDalContext } = await import('../lib/dataverse/core/context.js');
const grantRequestAdapter = await import('../lib/dataverse/adapters/grant-request.js');
const suggestionAdapter = await import('../lib/dataverse/adapters/reviewer-suggestion.js');
const { evaluateReviewSynthesisReadiness } = await import('../lib/services/review-synthesis-readiness.js');
const { RESPONSE_TYPE_MAP, REVIEW_STATUS_MAP } = await import('../shared/config/reviewerLifecycle.js');
enterDynamicsBypassForScript('probe-review-synthesis-blockers');

const RESPONSE = Object.fromEntries(Object.entries(RESPONSE_TYPE_MAP).map(([k, v]) => [v, k]));
const STATUS = Object.fromEntries(Object.entries(REVIEW_STATUS_MAP).map(([k, v]) => [v, k]));

await withDalContext('probe-review-synthesis-blockers', async () => {
  const { records } = await grantRequestAdapter.findByRequestNumber(requestNumber, { select: 'akoya_requestid,akoya_requestnum' });
  const request = records?.[0];
  if (!request) throw new Error(`Request ${requestNumber} not found.`);
  const rows = await suggestionAdapter.findByRequest(request.akoya_requestid, { selectedOnly: true, requireComplete: true });
  const readiness = evaluateReviewSynthesisReadiness(rows);
  const blockerIds = new Set(readiness.blockers.map((b) => b.suggestionId));
  const participants = rows
    .filter((r) => r.wmkf_selected === true && (r.wmkf_invited === true || r.wmkf_accepted === true))
    .map((r) => ({
      suggestionId: r.wmkf_appreviewersuggestionid,
      invited: r.wmkf_invited === true,
      accepted: r.wmkf_accepted === true,
      declined: r.wmkf_declined === true,
      responseType: RESPONSE[r.wmkf_responsetype] || r.wmkf_responsetype || null,
      reviewStatus: STATUS[r.wmkf_reviewstatus] || r.wmkf_reviewstatus || null,
      reviewReceivedAt: r.wmkf_reviewreceivedat || null,
      tokenIssued: r.wmkf_externaltokenissued || null,
      tokenExpires: r.wmkf_externaltokenexpires || null,
      tokenRevoked: r.wmkf_externaltokenrevoked === true,
      applicantDisposition: r.wmkf_applicantdisposition ?? null,
      BLOCKER: blockerIds.has(r.wmkf_appreviewersuggestionid) ? readiness.blockers.find((b) => b.suggestionId === r.wmkf_appreviewersuggestionid).reason : null,
    }));
  const { blockers, inputHash, ...summary } = readiness;
  console.log(JSON.stringify({ request: requestNumber, summary, participants }, null, 2));
}).catch((e) => { console.error(e.message); process.exit(1); });
