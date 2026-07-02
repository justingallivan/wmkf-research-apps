#!/usr/bin/env node
/**
 * READ-ONLY diagnosis for the "reviewers lose email on promotion to Invite tab"
 * report (request 1003020). For every SELECTED suggestion on the request, show:
 *   - disposition (recommended = applicant-suggested  vs  null = Find-discovered)
 *   - whether the persisted person email (wmkf_emailaddress) is EMPTY
 *   - whether the affiliation/org text CONTAINS an email (the screenshot symptom)
 * Only POST is the OAuth token; every Dataverse call is a GET.
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const envPath = path.join(__dirname, '..', '.env.local');
if (fs.existsSync(envPath)) {
  for (const line of fs.readFileSync(envPath, 'utf8').split('\n')) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (!m) continue;
    let [, k, v] = m;
    v = v.trim().replace(/^"(.*)"$/, '$1');
    if (!process.env[k]) process.env[k] = v;
  }
}

const REQNUM = process.argv[2] || '1003020';
const EMAIL_RE = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/;

async function getToken() {
  const r = await fetch(`https://login.microsoftonline.com/${process.env.DYNAMICS_TENANT_ID}/oauth2/v2.0/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'client_credentials', client_id: process.env.DYNAMICS_CLIENT_ID,
      client_secret: process.env.DYNAMICS_CLIENT_SECRET, scope: `${process.env.DYNAMICS_URL}/.default`,
    }),
  });
  if (!r.ok) throw new Error(`Token: ${r.status} ${await r.text()}`);
  return (await r.json()).access_token;
}

async function get(token, urlPath) {
  const r = await fetch(`${process.env.DYNAMICS_URL}/api/data/v9.2${urlPath}`, {
    headers: {
      Authorization: `Bearer ${token}`, Accept: 'application/json', 'OData-Version': '4.0',
      Prefer: 'odata.include-annotations="*"',
    },
  });
  const t = await r.text();
  let body; try { body = JSON.parse(t); } catch { body = t; }
  if (!r.ok) throw new Error(`GET ${urlPath}: ${r.status} ${typeof body === 'string' ? body.slice(0, 300) : JSON.stringify(body).slice(0, 300)}`);
  return body;
}

(async () => {
  const token = await getToken();

  // 1. Resolve the request GUID by number.
  const reqRes = await get(token, `/akoya_requests?$select=akoya_requestid,akoya_requestnum,akoya_title&$filter=akoya_requestnum eq '${REQNUM}'&$top=1`);
  const request = reqRes.value?.[0];
  if (!request) { console.log(`No request found for number ${REQNUM}`); return; }
  console.log(`Request ${REQNUM}: ${request.akoya_title}\n  guid=${request.akoya_requestid}\n`);

  // 2. Selected suggestions on this request.
  const sugRes = await get(token, `/wmkf_appreviewersuggestions?$select=wmkf_appreviewersuggestionid,_wmkf_potentialreviewer_value,wmkf_selected,wmkf_applicantdisposition,wmkf_sources,wmkf_invited&$filter=_wmkf_request_value eq ${request.akoya_requestid} and wmkf_selected eq true&$top=200`);
  const suggestions = sugRes.value || [];
  console.log(`Selected suggestions: ${suggestions.length}\n`);

  const rows = [];
  for (const s of suggestions) {
    const pid = s._wmkf_potentialreviewer_value;
    let person = {};
    if (pid) {
      person = await get(token, `/wmkf_potentialreviewerses(${pid})?$select=wmkf_name,wmkf_emailaddress,wmkf_organizationname,wmkf_primaryaffiliation`);
    }
    const disposition = s['wmkf_applicantdisposition@OData.Community.Display.V1.FormattedValue'] || (s.wmkf_applicantdisposition == null ? '(none/Find)' : s.wmkf_applicantdisposition);
    const email = person.wmkf_emailaddress || null;
    const aff = person.wmkf_primaryaffiliation || person.wmkf_organizationname || '';
    const affHasEmail = EMAIL_RE.test(aff);
    rows.push({
      name: person.wmkf_name || '(no name)',
      disposition,
      sources: s.wmkf_sources || '',
      invited: !!s.wmkf_invited,
      emailEmpty: !email,
      email: email || '',
      affHasEmail,
      affEmail: affHasEmail ? (aff.match(EMAIL_RE)?.[0] || '') : '',
    });
  }

  // 3. Report
  const missing = rows.filter((r) => r.emailEmpty);
  const missingWithAffEmail = missing.filter((r) => r.affHasEmail);
  console.log('name | disposition | sources | invited | emailEmpty | affHasEmail | affEmail');
  console.log('-----------------------------------------------------------------------------');
  for (const r of rows) {
    console.log(`${r.name} | ${r.disposition} | ${r.sources} | ${r.invited} | ${r.emailEmpty} | ${r.affHasEmail} | ${r.affEmail}`);
  }
  console.log(`\nSUMMARY: ${rows.length} selected; ${missing.length} missing email; ${missingWithAffEmail.length} of those have an email embedded in affiliation.`);
  const byDisp = {};
  for (const r of missing) { const k = r.disposition; byDisp[k] = (byDisp[k] || 0) + 1; }
  console.log('Missing-email breakdown by disposition:', JSON.stringify(byDisp));
})().catch((e) => { console.error('PROBE ERROR:', e.message); process.exit(1); });
