#!/usr/bin/env node

/**
 * Read-only census of Pre-Site Visit Word drafts: which requests have one,
 * and whether anyone actually started on it after generation.
 *
 * Signals per request (all read-only):
 *   - registry rows (Dataverse wmkf_requestdocument, Pre Site Visit type)
 *   - current pointer row's lifecycle / operation / created date
 *   - input snapshot schema (v2 = generated before the funding-history fill,
 *     i.e. carries the "not filled automatically" edit-check note)
 *   - SharePoint: current version vs the version recorded at generation, and
 *     lastModifiedBy display name — the "someone edited it in Word" signal
 *   - Postgres: whether any distribution attempt reached state 'sent'
 *
 * Prints request numbers, cycle codes, dates, version ids, counts, and a
 * display name for the last Word editor. Never prints document content,
 * credentials, tokens, or unrelated records.
 *
 * Usage:
 *   DATAVERSE_ALLOW_PROD_READS=yes node scripts/probe-pre-site-draft-census.mjs --target=prod
 *   node scripts/probe-pre-site-draft-census.mjs --target=sandbox
 * Add --no-graph to skip the SharePoint check, --no-postgres to skip sends.
 */

import { readFileSync } from 'fs';
import { resolve } from 'path';
import pg from 'pg';

for (const envFile of ['.env', '.env.local']) {
  try {
    const content = readFileSync(resolve(process.cwd(), envFile), 'utf8');
    for (const line of content.split('\n')) {
      const text = line.trim();
      if (!text || text.startsWith('#')) continue;
      const index = text.indexOf('=');
      if (index < 0) continue;
      const key = text.slice(0, index).trim();
      const value = text.slice(index + 1).trim().replace(/^["']|["']$/g, '');
      if (!process.env[key]) process.env[key] = value;
    }
  } catch {}
}

const args = new Set(process.argv.slice(2));
const targetArg = process.argv.find((arg) => arg.startsWith('--target='));
const target = targetArg?.slice('--target='.length);
if (!['prod', 'sandbox'].includes(target)) throw new Error('Pass --target=prod or --target=sandbox.');
if (target === 'prod' && process.env.DATAVERSE_ALLOW_PROD_READS !== 'yes') {
  throw new Error('Production read requires DATAVERSE_ALLOW_PROD_READS=yes (owner-run).');
}
const useGraph = !args.has('--no-graph');
const usePostgres = !args.has('--no-postgres');

const resourceUrl = target === 'prod' ? process.env.DYNAMICS_URL : process.env.DYNAMICS_SANDBOX_URL;
const { DYNAMICS_TENANT_ID, DYNAMICS_CLIENT_ID, DYNAMICS_CLIENT_SECRET } = process.env;
if (!resourceUrl || !DYNAMICS_TENANT_ID || !DYNAMICS_CLIENT_ID || !DYNAMICS_CLIENT_SECRET) {
  throw new Error(`Missing Dataverse credentials for target=${target}.`);
}

const PRE_SITE_VISIT = 100000001;
const WORD = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
const OPERATION = new Map([[100000000, 'Generating'], [100000001, 'Ready'], [100000002, 'Failed']]);
const LIFECYCLE = new Map([[100000000, 'Draft'], [100000001, 'Review'], [100000002, 'Board Ready'], [100000003, 'Superseded'], [100000004, 'Final']]);

async function token(scope) {
  const response = await fetch(`https://login.microsoftonline.com/${DYNAMICS_TENANT_ID}/oauth2/v2.0/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'client_credentials', client_id: DYNAMICS_CLIENT_ID, client_secret: DYNAMICS_CLIENT_SECRET, scope }),
  });
  const body = await response.json();
  if (!response.ok || !body.access_token) throw new Error(`Token request failed (${response.status}) for ${scope}.`);
  return body.access_token;
}

async function getJson(bearer, url, extraHeaders = {}) {
  const response = await fetch(url, { headers: { Authorization: `Bearer ${bearer}`, Accept: 'application/json', ...extraHeaders } });
  const text = await response.text();
  if (!response.ok) return { __status: response.status, __error: text.slice(0, 200) };
  return text ? JSON.parse(text) : {};
}

async function dvAll(bearer, path) {
  const rows = [];
  let next = `${resourceUrl}/api/data/v9.2/${path}`;
  while (next) {
    const body = await getJson(bearer, next, { 'OData-MaxVersion': '4.0', 'OData-Version': '4.0', Prefer: 'odata.maxpagesize=5000,odata.include-annotations="OData.Community.Display.V1.FormattedValue"' });
    if (body.__error) throw new Error(`Dataverse GET failed (${body.__status}): ${body.__error}`);
    rows.push(...(body.value || []));
    next = body['@odata.nextLink'] || null;
  }
  return rows;
}

function snapshotVersion(json) {
  if (!json) return null;
  try { return JSON.parse(json)?.schemaVersion ?? null; } catch { return 'unparseable'; }
}

function day(value) {
  return value ? String(value).slice(0, 10) : null;
}

async function main() {
  const dv = await token(`${resourceUrl}/.default`);

  const docSelect = [
    'wmkf_requestdocumentid', '_wmkf_request_value', 'wmkf_cyclecode', 'wmkf_lifecyclestate', 'wmkf_operationstatus',
    'wmkf_producer', 'wmkf_contenttype', 'createdon', 'modifiedon', 'wmkf_sharepointdriveid', 'wmkf_sharepointitemid',
    'wmkf_sharepointversionid', 'wmkf_sharepointlastmodified', 'wmkf_presiteinputsnapshotjson',
  ].join(',');
  const docs = await dvAll(dv, `wmkf_requestdocuments?$select=${docSelect}&$filter=wmkf_artifacttype eq ${PRE_SITE_VISIT}&$orderby=createdon asc`);

  const byRequest = new Map();
  for (const row of docs) {
    const key = String(row._wmkf_request_value || '').toLowerCase();
    if (!key) continue;
    if (!byRequest.has(key)) byRequest.set(key, []);
    byRequest.get(key).push(row);
  }
  const requestIds = [...byRequest.keys()];
  const requests = new Map();
  for (let i = 0; i < requestIds.length; i += 25) {
    const batch = requestIds.slice(i, i + 25);
    const filter = batch.map((id) => `akoya_requestid eq ${id}`).join(' or ');
    const rows = await dvAll(dv, `akoya_requests?$select=akoya_requestid,akoya_requestnum,wmkf_meetingdate,_wmkf_currentpresitevisit_value,_wmkf_programdirector_value&$filter=${encodeURIComponent(filter)}`);
    for (const r of rows) requests.set(String(r.akoya_requestid).toLowerCase(), r);
  }

  let graph = null;
  if (useGraph) {
    try { graph = await token('https://graph.microsoft.com/.default'); } catch (error) { console.warn(`Graph token unavailable; skipping SharePoint check (${error.message}).`); }
  }

  let sentBySource = new Map();
  if (usePostgres) {
    const connectionString = process.env.POSTGRES_URL || process.env.DATABASE_URL;
    if (!connectionString) console.warn('POSTGRES_URL / DATABASE_URL not set; skipping sends check.');
    else {
      const client = new pg.Client({ connectionString, ssl: connectionString.includes('localhost') ? false : { rejectUnauthorized: false } });
      await client.connect();
      try {
        const result = await client.query(
          `SELECT source_document_id::text AS id, COUNT(*)::int AS sent FROM pre_site_distribution_attempts WHERE state = 'sent' GROUP BY source_document_id`,
        );
        sentBySource = new Map(result.rows.map((r) => [String(r.id).toLowerCase(), r.sent]));
      } finally { await client.end(); }
    }
  }

  const report = [];
  for (const [requestId, rows] of byRequest.entries()) {
    const request = requests.get(requestId);
    const wordRows = rows.filter((r) => r.wmkf_contenttype === WORD && !/^pre-site-distribution-/.test(String(r.wmkf_producer || '')));
    const snapshots = rows.length - wordRows.length;
    const pointer = String(request?._wmkf_currentpresitevisit_value || '').toLowerCase();
    const current = wordRows.find((r) => String(r.wmkf_requestdocumentid).toLowerCase() === pointer)
      || wordRows.filter((r) => r.wmkf_lifecyclestate !== 100000003).slice(-1)[0]
      || null;

    let sharepoint = null;
    if (graph && current?.wmkf_sharepointdriveid && current?.wmkf_sharepointitemid) {
      const item = await getJson(graph, `https://graph.microsoft.com/v1.0/drives/${current.wmkf_sharepointdriveid}/items/${current.wmkf_sharepointitemid}?$select=lastModifiedDateTime,lastModifiedBy,publication`);
      sharepoint = item.__error
        ? { status: item.__status === 404 ? 'missing' : `error ${item.__status}` }
        : {
          status: 'current',
          versionNow: item.publication?.versionId || null,
          versionAtGeneration: current.wmkf_sharepointversionid || null,
          lastModified: item.lastModifiedDateTime || null,
          lastModifiedBy: item.lastModifiedBy?.user?.displayName || item.lastModifiedBy?.application?.displayName || null,
        };
    }

    const snapshotSchema = current ? snapshotVersion(current.wmkf_presiteinputsnapshotjson) : null;
    const sent = current ? (sentBySource.get(String(current.wmkf_requestdocumentid).toLowerCase()) || 0) : 0;
    const editedAfterGeneration = sharepoint?.status === 'current'
      && sharepoint.versionNow && sharepoint.versionAtGeneration
      && sharepoint.versionNow !== sharepoint.versionAtGeneration;
    const lifecycle = current ? LIFECYCLE.get(current.wmkf_lifecyclestate) : null;
    const started = Boolean(editedAfterGeneration) || sent > 0 || (lifecycle && lifecycle !== 'Draft');

    report.push({
      request: request?.akoya_requestnum || requestId,
      cycle: current?.wmkf_cyclecode || null,
      meetingDate: day(request?.wmkf_meetingdate),
      wordRows: wordRows.length,
      distributionSnapshots: snapshots,
      current: current ? {
        lifecycle,
        operation: OPERATION.get(current.wmkf_operationstatus),
        generated: day(current.createdon),
        pointerMatches: Boolean(pointer) && String(current.wmkf_requestdocumentid).toLowerCase() === pointer,
        inputSnapshotSchema: snapshotSchema,
        preFundingFillNote: snapshotSchema === 2,
      } : null,
      sharepoint,
      sentAttempts: sent,
      editedAfterGeneration: Boolean(editedAfterGeneration),
      verdict: !current ? 'no word draft' : started ? 'STARTED' : 'generated only',
    });
  }
  report.sort((a, b) => String(a.request).localeCompare(String(b.request)));

  const tally = { requests: report.length, started: 0, generatedOnly: 0, noWordDraft: 0, preFundingFillNote: 0 };
  for (const r of report) {
    if (r.verdict === 'STARTED') tally.started += 1;
    else if (r.verdict === 'generated only') tally.generatedOnly += 1;
    else tally.noWordDraft += 1;
    if (r.current?.preFundingFillNote) tally.preFundingFillNote += 1;
  }
  console.log(JSON.stringify({ target, totalPreSiteRows: docs.length, tally, requests: report }, null, 2));
}

main().catch((error) => { console.error(error.message); process.exit(1); });
