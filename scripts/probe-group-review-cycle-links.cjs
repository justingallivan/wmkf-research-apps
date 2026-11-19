#!/usr/bin/env node
/**
 * Read-only, owner-run before promoting the J27 line (rollout plan: "D26 Grant
 * Cycle links"). Since 91fc83581 the group-review start guard
 * (lib/services/final-writeup/transition-schedule.js assertScheduledEnd) lets a
 * request skip the presentation check only when its linked Grant Cycle
 * (`wmkf_GrantCycle.wmkf_cyclecode`) is a cycle before 2027. Before, the
 * document's copied cycle code was enough. This lists every request that could
 * still start group review (a current Draft Writeup, no current Final Writeup)
 * and flags the ones the guard would now refuse:
 *   no presentation record, the Draft Writeup in a complete review, and no
 *   readable linked cycle code.
 *
 *   DATAVERSE_ALLOW_PROD_READS=yes node scripts/probe-group-review-cycle-links.cjs
 *
 * GET only, under the Dataverse target interlock (it refuses a Production read
 * without the opt-in). Prints request numbers and cycle codes only.
 */
const { loadEnvLocal, getAccessToken, createClient } = require('../lib/dataverse/client');
loadEnvLocal();
process.env.DATAVERSE_TARGET_INTERLOCK = 'on';
const resourceUrl = process.env.DYNAMICS_URL;
if (!resourceUrl) { console.error('DYNAMICS_URL is not set'); process.exit(2); }
const CYCLE_CODE = /^[JD]\d{2}$/; // shared/config/cycleCalendar.js CYCLE_CODE_PATTERN
const PRE_SITE_VISIT = 100000001; // shared/config/requestDocument.js
const REVIEW = 100000001;
const isPre2027 = (code) => CYCLE_CODE.test(code || '') && Number(code.slice(1)) < 27;

async function all(client, path) {
  const rows = [];
  let next = path;
  while (next) {
    const r = await client.get(next);
    if (!r.ok) throw new Error(`read failed (${r.status}) for ${path.split('?')[0]}`);
    rows.push(...r.body.value);
    next = r.body['@odata.nextLink'] || null;
  }
  return rows;
}

(async () => {
  console.log('target host:', new URL(resourceUrl).hostname);
  const client = createClient({ resourceUrl, token: await getAccessToken(resourceUrl) });
  const requests = await all(client, '/akoya_requests?$select=akoya_requestnum,akoya_requestid,_wmkf_currentpresitevisit_value'
    + '&$filter=_wmkf_currentpresitevisit_value ne null and _wmkf_currentfinalwriteup_value eq null'
    + '&$expand=wmkf_GrantCycle($select=wmkf_cyclecode)');
  const rows = [];
  for (const request of requests) {
    const id = request.akoya_requestid;
    const draft = (await client.get(`/wmkf_requestdocuments(${request._wmkf_currentpresitevisit_value})?$select=wmkf_artifacttype,wmkf_lifecyclestate,wmkf_cyclecode,wmkf_milestoneversionid,wmkf_milestonecontenthash,wmkf_milestonecreatedat,wmkf_sharepointversionid`)).body || {};
    const visits = await all(client, `/wmkf_sitevisits?$select=activityid&$filter=_regardingobjectid_value eq ${id}`);
    const linked = request.wmkf_GrantCycle?.wmkf_cyclecode || null;
    const completeReview = draft.wmkf_artifacttype === PRE_SITE_VISIT && draft.wmkf_lifecyclestate === REVIEW
      && draft.wmkf_milestoneversionid && draft.wmkf_milestonecontenthash && draft.wmkf_milestonecreatedat
      && draft.wmkf_sharepointversionid === draft.wmkf_milestoneversionid;
    const needsException = visits.length === 0 && Boolean(completeReview);
    rows.push({
      request: request.akoya_requestnum,
      linkedCycle: linked || '(none)',
      documentCycle: draft.wmkf_cyclecode || '(none)',
      presentations: visits.length,
      completeReview: Boolean(completeReview),
      refused: needsException && !isPre2027(CYCLE_CODE.test(linked || '') ? linked : null),
    });
  }
  rows.sort((a, b) => String(a.request).localeCompare(String(b.request)));
  console.table(rows);
  const refused = rows.filter((row) => row.refused);
  console.log(`${rows.length} requests could still start group review; ${refused.length} would be refused by the linked-cycle rule.`);
  if (refused.length) console.log('Refused:', refused.map((row) => `#${row.request} (linked ${row.linkedCycle}, document ${row.documentCycle})`).join(', '));
})().catch((error) => { console.error('failed:', String(error.message).slice(0, 300)); process.exit(1); });
