#!/usr/bin/env node
/**
 * Read-only: D26 reviewer invitations that look unanswered (invited, not
 * accepted, not declined, no response type) but that the stale-invitation
 * sweep will never close, because they miss its discovery filter
 * (wmkf_selected eq true and wmkf_emailsentat set, applicant-excluded rows
 * left out). Reports which conditions each row misses plus lifecycle flags.
 * Dataverse GETs only; no names, emails or free text.
 *
 * Usage: DATAVERSE_ALLOW_PROD_READS=yes node scripts/probe-d26-unswept-invitations.cjs
 */
const assert = require('node:assert/strict');
const { loadEnvLocal, createClient, getAccessToken } = require('../lib/dataverse/client.js');

const TARGET = 'https://wmkf.crm.dynamics.com';
const EXCLUDED = 100000002;

async function getAll(client, path) {
  const rows = [];
  for (let page = 0; path && page < 30; page++) {
    const r = await client.get(path);
    assert(r.ok && Array.isArray(r.body?.value), `Read failed (${r.status})`);
    rows.push(...r.body.value);
    path = r.body['@odata.nextLink'];
  }
  assert(!path, 'Incomplete pagination');
  return rows;
}

async function main() {
  loadEnvLocal();
  delete process.env.VERCEL_ENV;
  Object.assign(process.env, { NODE_ENV: 'development', DATAVERSE_TARGET_INTERLOCK: 'on', DATAVERSE_DAL_ENFORCEMENT: 'on' });
  assert(process.env.DATAVERSE_ALLOW_PROD_READS === 'yes', 'Set DATAVERSE_ALLOW_PROD_READS=yes');
  const client = createClient({ resourceUrl: TARGET, token: await getAccessToken(TARGET) });

  const select = [
    'wmkf_appreviewersuggestionid', '_wmkf_request_value', 'wmkf_selected', 'wmkf_invited', 'wmkf_emailsentat',
    'wmkf_externaltokenissued', 'wmkf_externaltokenexpires', 'wmkf_externaltokenrevoked', 'wmkf_applicantdisposition',
    'wmkf_withdrawnsufficientat', 'wmkf_reviewstatus', 'wmkf_completedat', 'wmkf_heldat', 'wmkf_responsereceivedat',
    'wmkf_sources', 'createdon', 'modifiedon',
  ].join(',');
  const rows = await getAll(client, `/wmkf_appreviewersuggestions?$select=${select}&$filter=wmkf_grantcyclecode eq 'D26' and wmkf_invited eq true and wmkf_accepted ne true and wmkf_declined ne true and wmkf_responsetype eq null`);

  const sweepable = r => r.wmkf_selected === true && Boolean(r.wmkf_emailsentat) && r.wmkf_applicantdisposition !== EXCLUDED;
  const unswept = rows.filter(r => !sweepable(r));

  const requests = {};
  for (const id of [...new Set(unswept.map(r => r._wmkf_request_value).filter(Boolean))]) {
    const req = (await client.get(`/akoya_requests(${id})?$select=akoya_requestnum,akoya_requeststatus,wmkf_istestrequest,wmkf_testcreationrunid,_wmkf_grantcycle_value`)).body;
    requests[id] = { number: req?.akoya_requestnum || null, status: req?.akoya_requeststatus || null,
      test: req?.wmkf_istestrequest === true || Boolean(req?.wmkf_testcreationrunid), cycleLinked: Boolean(req?._wmkf_grantcycle_value) };
  }

  const day = v => (typeof v === 'string' && v ? v.slice(0, 10) : null);
  const tally = (pred) => unswept.filter(pred).length;
  const sources = {};
  for (const r of unswept) sources[r.wmkf_sources ?? 'none'] = (sources[r.wmkf_sources ?? 'none'] || 0) + 1;

  console.log(JSON.stringify({
    checkedAt: new Date().toISOString(),
    unansweredTotal: rows.length,
    sweepable: rows.length - unswept.length,
    unswept: unswept.length,
    missesSweepConditions: {
      notSelected: tally(r => r.wmkf_selected !== true),
      noInvitationSentTime: tally(r => !r.wmkf_emailsentat),
      applicantExcluded: tally(r => r.wmkf_applicantdisposition === EXCLUDED),
    },
    flags: {
      linkRevoked: tally(r => r.wmkf_externaltokenrevoked === true),
      linkEverIssued: tally(r => Boolean(r.wmkf_externaltokenissued)),
      withdrawnSufficientAt: tally(r => Boolean(r.wmkf_withdrawnsufficientat)),
      heldAt: tally(r => Boolean(r.wmkf_heldat)),
      reviewStatusSet: tally(r => r.wmkf_reviewstatus != null),
      completedAt: tally(r => Boolean(r.wmkf_completedat)),
      onTestRequests: tally(r => requests[r._wmkf_request_value]?.test),
    },
    sourcesValues: sources,
    byRequest: Object.values(unswept.reduce((acc, r) => {
      const q = requests[r._wmkf_request_value] || {};
      const key = q.number || 'unknown';
      acc[key] = acc[key] || { request: key, status: q.status, test: q.test, cycleLinked: q.cycleLinked, rows: 0, selected: 0, sentTime: 0, revoked: 0, createdRange: [] };
      const a = acc[key];
      a.rows += 1; if (r.wmkf_selected === true) a.selected += 1; if (r.wmkf_emailsentat) a.sentTime += 1; if (r.wmkf_externaltokenrevoked === true) a.revoked += 1;
      a.createdRange.push(day(r.createdon));
      return acc;
    }, {})).map(a => ({ ...a, createdRange: [a.createdRange.sort()[0], a.createdRange.sort().slice(-1)[0]] })).sort((x, y) => String(x.request).localeCompare(String(y.request))),
  }, null, 2));
}

main().catch(error => { console.error(`D26 unswept probe failed: ${error.message}`); process.exitCode = 1; });
