#!/usr/bin/env node
/**
 * Read-only: can the answers erased by "Remove candidate" on D26 invitations
 * be recovered from Dataverse audit history?
 *
 * Finds D26 suggestions that were invited, are unselected and carry no
 * answer (the shape softDelete leaves), then reads each row's
 * RetrieveRecordChangeHistory and reports what the last pre-removal values
 * of the answer fields were. Also reports whether auditing is enabled for
 * the organization and the table. Dataverse GETs only; counts and option
 * labels only, no names, emails or free text.
 *
 * Usage: DATAVERSE_ALLOW_PROD_READS=yes node scripts/probe-d26-removed-audit-history.cjs
 */
const assert = require('node:assert/strict');
const { loadEnvLocal, createClient, getAccessToken } = require('../lib/dataverse/client.js');

const TARGET = 'https://wmkf.crm.dynamics.com';
const ANSWER_FIELDS = ['wmkf_accepted', 'wmkf_declined', 'wmkf_responsetype', 'wmkf_reviewstatus', 'wmkf_heldat'];
const RESPONSE = { 100000000: 'accepted', 100000001: 'declined', 100000002: 'no_response', 100000003: 'withdrawn_sufficient', 100000004: 'held' };
const STATUS = { 100000000: 'accepted', 100000001: 'materials_sent', 100000002: 'under_review', 100000003: 'review_received', 100000004: 'complete', 100000005: 'withdrew', 100000006: 'released' };

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

const hasAnswer = (o) => ANSWER_FIELDS.some(f => f in (o || {}) && o[f] != null && o[f] !== false);
const describe = (d) => {
  const o = d.OldValue;
  return {
    removedOn: String(d.AuditRecord?.createdon || '').slice(0, 10) || null,
    responseType: o.wmkf_responsetype == null ? null : (RESPONSE[o.wmkf_responsetype] || `unknown:${o.wmkf_responsetype}`),
    accepted: o.wmkf_accepted ?? null,
    declined: o.wmkf_declined ?? null,
    reviewStatus: o.wmkf_reviewstatus == null ? null : (STATUS[o.wmkf_reviewstatus] || `unknown:${o.wmkf_reviewstatus}`),
    held: Boolean(o.wmkf_heldat),
  };
};

// Every change that CLEARED an answer field (old value set, new value
// null/false), excluding the reviewer's own response writes (which set
// accepted or declined true). Detected from paired old/new values, not from a
// selection change: a removal of an already-unselected declined row erases
// the decline without touching wmkf_selected. Oldest first.
const cleared = (d) => ANSWER_FIELDS.some(f => f in (d?.OldValue || {})
  && d.OldValue[f] != null && d.OldValue[f] !== false
  && (d.NewValue?.[f] == null || d.NewValue[f] === false));
function erasingRemovals(details) {
  return [...details]
    .filter(d => cleared(d) && d?.NewValue?.wmkf_declined !== true && d?.NewValue?.wmkf_accepted !== true)
    .sort((a, b) => String(a?.AuditRecord?.createdon || '').localeCompare(String(b?.AuditRecord?.createdon || '')))
    .map(describe);
}

const label = (p) => p.reviewStatus ? `review status ${p.reviewStatus}`
  : p.responseType ? `response ${p.responseType}`
  : p.accepted ? 'accepted flag only' : p.declined ? 'declined flag only' : 'held only';

async function main() {
  loadEnvLocal();
  delete process.env.VERCEL_ENV;
  Object.assign(process.env, { NODE_ENV: 'development', DATAVERSE_TARGET_INTERLOCK: 'on', DATAVERSE_DAL_ENFORCEMENT: 'on' });
  assert(process.env.DATAVERSE_ALLOW_PROD_READS === 'yes', 'Set DATAVERSE_ALLOW_PROD_READS=yes');
  const client = createClient({ resourceUrl: TARGET, token: await getAccessToken(TARGET) });

  const org = await client.get('/organizations?$select=isauditenabled');
  const table = await client.get("/EntityDefinitions(LogicalName='wmkf_appreviewersuggestion')?$select=IsAuditEnabled");
  const out = {
    checkedAt: new Date().toISOString(),
    orgAuditEnabled: org.ok ? org.body?.value?.[0]?.isauditenabled ?? null : `read failed (${org.status})`,
    tableAuditEnabled: table.ok ? table.body?.IsAuditEnabled?.Value ?? null : `read failed (${table.status})`,
  };

  const rows = await getAll(client, "/wmkf_appreviewersuggestions?$select=wmkf_appreviewersuggestionid,wmkf_withdrawnsufficientat&$filter=wmkf_grantcyclecode eq 'D26' and wmkf_invited eq true and wmkf_selected eq false and wmkf_accepted ne true and wmkf_declined ne true and wmkf_responsetype eq null");
  out.removedRows = rows.length;

  const results = [];
  let historyErrors = 0;
  let morePages = 0;
  for (const r of rows) {
    const id = r.wmkf_appreviewersuggestionid;
    const target = encodeURIComponent(JSON.stringify({ '@odata.id': `wmkf_appreviewersuggestions(${id})` }));
    const h = await client.get(`/RetrieveRecordChangeHistory(Target=@t)?@t=${target}`);
    if (!h.ok) { historyErrors += 1; if (historyErrors === 1) out.firstHistoryError = h.status; continue; }
    const coll = h.body?.AuditDetailCollection || {};
    if (coll.MoreRecords === true) morePages += 1;
    const details = coll.AuditDetails || [];
    results.push({ entries: details.length, withdrawnSufficientStamp: Boolean(r.wmkf_withdrawnsufficientat), erased: erasingRemovals(details) });
  }

  out.historyRead = results.length;
  out.historyErrors = historyErrors;
  out.historiesWithMorePages = morePages;
  out.rowsWithNoAuditEntries = results.filter(x => !x.entries).length;
  out.rowsWithNothingErased = results.filter(x => x.entries && !x.erased.length).length;
  out.rowsThatLostAnAnswer = results.filter(x => x.erased.length).length;
  out.rowsErasedMoreThanOnce = results.filter(x => x.erased.length > 1).length;
  // The answer each row held just before its FIRST erasing removal.
  const tally = {};
  for (const x of results.filter(x => x.erased.length)) { const k = label(x.erased[0]); tally[k] = (tally[k] || 0) + 1; }
  out.answerLostAtFirstRemoval = tally;
  out.withdrawnSufficientStampRows = {
    total: results.filter(x => x.withdrawnSufficientStamp).length,
    lostAnswer: results.filter(x => x.withdrawnSufficientStamp && x.erased.length).map(x => label(x.erased[0])),
  };
  const dates = results.flatMap(x => x.erased.map(e => e.removedOn)).filter(Boolean).sort();
  out.erasingRemovalDates = dates.length ? [dates[0], dates[dates.length - 1]] : null;
  console.log(JSON.stringify(out, null, 2));
}

main().catch(error => { console.error(`Audit history probe failed: ${error.message}`); process.exitCode = 1; });
