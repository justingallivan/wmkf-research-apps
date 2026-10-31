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

function priorAnswer(details) {
  // Walk newest-first; the removal is the change that set wmkf_selected false.
  // The OldValue of that change (or of the latest earlier change touching the
  // answer fields) holds what removal erased.
  const sorted = [...details].sort((a, b) => String(b?.AuditRecord?.createdon || '').localeCompare(String(a?.AuditRecord?.createdon || '')));
  const removal = sorted.find(d => d?.NewValue?.wmkf_selected === false);
  if (!removal) return null;
  // Audit records only changed fields: a removal that changed no answer field
  // erased nothing.
  if (!ANSWER_FIELDS.some(f => f in (removal.OldValue || {}) && removal.OldValue[f] != null && removal.OldValue[f] !== false)) {
    return { removedOn: String(removal.AuditRecord?.createdon || '').slice(0, 10) || null, erasedNothing: true };
  }
  const o = removal.OldValue;
  return {
    removedOn: String(removal.AuditRecord?.createdon || '').slice(0, 10) || null,
    responseType: o.wmkf_responsetype == null ? null : (RESPONSE[o.wmkf_responsetype] || `unknown:${o.wmkf_responsetype}`),
    accepted: o.wmkf_accepted ?? null,
    declined: o.wmkf_declined ?? null,
    reviewStatus: o.wmkf_reviewstatus == null ? null : (STATUS[o.wmkf_reviewstatus] || `unknown:${o.wmkf_reviewstatus}`),
    held: Boolean(o.wmkf_heldat),
  };
}

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
  for (const r of rows) {
    const id = r.wmkf_appreviewersuggestionid;
    const target = encodeURIComponent(JSON.stringify({ '@odata.id': `wmkf_appreviewersuggestions(${id})` }));
    const h = await client.get(`/RetrieveRecordChangeHistory(Target=@t)?@t=${target}`);
    if (!h.ok) { historyErrors += 1; if (historyErrors === 1) out.firstHistoryError = h.status; continue; }
    const details = h.body?.AuditDetailCollection?.AuditDetails || [];
    results.push({ entries: details.length, withdrawnSufficientStamp: Boolean(r.wmkf_withdrawnsufficientat), prior: priorAnswer(details) });
  }

  const tally = {};
  for (const x of results) {
    const p = x.prior;
    const key = !x.entries ? 'no audit entries'
      : !p ? 'history found, no unselect change in it'
      : p.erasedNothing ? 'removed with no answer to erase'
      : p.reviewStatus ? `review status ${p.reviewStatus}`
      : p.responseType ? `response ${p.responseType}`
      : p.accepted ? 'accepted flag only' : p.declined ? 'declined flag only' : 'no answer before removal';
    tally[key] = (tally[key] || 0) + 1;
  }
  out.historyRead = results.length;
  out.historyErrors = historyErrors;
  out.priorAnswerBeforeRemoval = tally;
  out.withdrawnSufficientStampRows = {
    total: results.filter(x => x.withdrawnSufficientStamp).length,
    priorResponse: results.filter(x => x.withdrawnSufficientStamp).map(x => x.prior?.responseType ?? (x.entries ? 'not identified' : 'no audit')),
  };
  const dates = results.map(x => x.prior?.removedOn).filter(Boolean).sort();
  out.removalDates = dates.length ? [dates[0], dates[dates.length - 1]] : null;
  console.log(JSON.stringify(out, null, 2));
}

main().catch(error => { console.error(`Audit history probe failed: ${error.message}`); process.exitCode = 1; });
