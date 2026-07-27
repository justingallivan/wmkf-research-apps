#!/usr/bin/env node
/**
 * READ-ONLY: size the "reviewer saved with no email" population across ALL
 * requests in a recency window, and classify WHY, to separate cause #2
 * (enrichment completed but surfaced no email — potentially fixable with better
 * discovery) from orphaned-in-affiliation, applicant-legit, and staleness.
 *
 * Authoritative "can't invite" = Dataverse person.wmkf_emailaddress empty.
 * Classification = the Postgres reviewer_find_roster candidate blob's enrichment
 * flags (emailPersistAllowed / contactStatus) and quarantined contactLeads,
 * matched by request + name.
 * Only POST is the OAuth token; every Dataverse call is a GET; Postgres is read-only.
 */
import fs from 'fs'; import path from 'path'; import { fileURLToPath } from 'url';
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const envPath = path.join(__dirname, '..', '.env.local');
if (fs.existsSync(envPath)) for (const line of fs.readFileSync(envPath, 'utf8').split('\n')) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/); if (!m) continue; let [, k, v] = m;
  v = v.trim().replace(/^"(.*)"$/, '$1'); if (!process.env[k]) process.env[k] = v;
}
if (!process.env.POSTGRES_URL && process.env.DATABASE_URL) process.env.POSTGRES_URL = process.env.DATABASE_URL;
const DAYS = Number(process.argv[2] || 90);
const sinceIso = new Date(Date.now() - DAYS * 86400_000).toISOString();

const { ContactParser } = await import('../lib/utils/contact-parser.js');
const { sql } = await import('@vercel/postgres');
const norm = (s) => String(s || '').toLowerCase().replace(/^(dr\.?|prof\.?|professor)\s+/i, '').replace(/[^a-z\s]/g, '').replace(/\s+/g, ' ').trim();

async function getToken() {
  const r = await fetch(`https://login.microsoftonline.com/${process.env.DYNAMICS_TENANT_ID}/oauth2/v2.0/token`, {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'client_credentials', client_id: process.env.DYNAMICS_CLIENT_ID, client_secret: process.env.DYNAMICS_CLIENT_SECRET, scope: `${process.env.DYNAMICS_URL}/.default` }),
  });
  if (!r.ok) throw new Error(`Token: ${r.status}`); return (await r.json()).access_token;
}
async function getAll(token, urlPath) {
  let next = `${process.env.DYNAMICS_URL}/api/data/v9.2${urlPath}`; const rows = [];
  while (next) {
    const r = await fetch(next, { headers: { Authorization: `Bearer ${token}`, Accept: 'application/json', 'OData-Version': '4.0', Prefer: 'odata.maxpagesize=500,odata.include-annotations="*"' } });
    const t = await r.text(); let b; try { b = JSON.parse(t); } catch { b = t; }
    if (!r.ok) throw new Error(`GET ${urlPath}: ${r.status} ${JSON.stringify(b).slice(0, 200)}`);
    rows.push(...(b.value || [])); next = b['@odata.nextLink'] || null;
  }
  return rows;
}

(async () => {
  const token = await getToken();
  const RECOMMENDED = 100000000;
  const sugs = await getAll(token, `/wmkf_appreviewersuggestions?$select=_wmkf_potentialreviewer_value,_wmkf_request_value,wmkf_applicantdisposition&$filter=wmkf_selected eq true and createdon ge ${sinceIso}`);
  const personIds = [...new Set(sugs.map((s) => s._wmkf_potentialreviewer_value).filter(Boolean))];

  const persons = {};
  const CHUNK = 20;
  for (let i = 0; i < personIds.length; i += CHUNK) {
    const orChain = personIds.slice(i, i + CHUNK).map((id) => `wmkf_potentialreviewersid eq ${id}`).join(' or ');
    const rows = await getAll(token, `/wmkf_potentialreviewerses?$select=wmkf_potentialreviewersid,wmkf_name,wmkf_emailaddress,wmkf_primaryaffiliation,wmkf_organizationname&$filter=${encodeURIComponent(orChain)}`);
    for (const p of rows) persons[p.wmkf_potentialreviewersid] = p;
  }

  // No-email population (authoritative Dataverse).
  const noEmail = [];
  for (const s of sugs) {
    const p = persons[s._wmkf_potentialreviewer_value]; if (!p) continue;
    if (p.wmkf_emailaddress) continue;
    const aff = p.wmkf_primaryaffiliation || p.wmkf_organizationname || '';
    noEmail.push({
      name: p.wmkf_name, requestId: s._wmkf_request_value,
      isApplicant: s.wmkf_applicantdisposition === RECOMMENDED,
      affHasEmail: !!ContactParser.extractPrimaryEmail(aff),
      key: `${s._wmkf_request_value}::${norm(p.wmkf_name)}`,
    });
  }

  // Roster enrichment flags for the affected requests.
  const reqIds = [...new Set(noEmail.map((r) => r.requestId))];
  const rosterByKey = {};
  if (reqIds.length) {
    const res = await sql.query(
      `SELECT request_id, display_name, candidate FROM reviewer_find_roster WHERE request_id = ANY($1)`,
      [reqIds]
    );
    for (const row of res.rows) {
      const c = row.candidate || {}; const enr = c.contactEnrichment || {};
      rosterByKey[`${row.request_id}::${norm(row.display_name)}`] = {
        epa: (c.emailPersistAllowed ?? enr.emailPersistAllowed),
        contactStatus: (c.contactStatus || enr.contactStatus || null),
        rosterEmail: c.email || enr.email || null,
        contactLeads: Array.isArray(enr.contactLeads) ? enr.contactLeads : [],
      };
    }
  }

  let applicant = 0, findCompleted = 0, findBlank = 0, staleRosterHasEmail = 0, unmatched = 0;
  const findCompletedList = [];
  for (const r of noEmail) {
    const rr = rosterByKey[r.key];
    if (r.isApplicant) { applicant++; continue; }
    if (!rr) { unmatched++; continue; }
    if (rr.rosterEmail) { staleRosterHasEmail++; continue; } // roster found an email; Dataverse empty (staleness/other)
    if (rr.epa === false) {
      findCompleted++;
      findCompletedList.push({
        name: `${r.name}${r.affHasEmail ? ' [aff-has-email!]' : ''}`,
        leads: rr.contactLeads,
      });
    }
    else { findBlank++; } // flags undefined/blank → enrichment never attached
  }

  const total = sugs.length;
  console.log(`Window: last ${DAYS}d (since ${sinceIso.slice(0,10)})`);
  console.log(`Selected suggestions: ${total}; no-email: ${noEmail.length} (${(100*noEmail.length/total).toFixed(1)}%)`);
  console.log(`Distinct requests with >=1 no-email reviewer: ${reqIds.length}\n`);
  console.log('No-email breakdown by cause:');
  console.log(`  applicant-suggested (often legit, no contact given): ${applicant}`);
  console.log(`  FIND + enrichment COMPLETED, no email (cause #2)    : ${findCompleted}`);
  console.log(`  FIND + enrichment flags BLANK (never attached)      : ${findBlank}`);
  console.log(`  roster HAS email but Dataverse empty (stale/other)  : ${staleRosterHasEmail}`);
  console.log(`  no roster match (can't classify)                    : ${unmatched}`);
  console.log(`\nCause #2 reviewers (enrichment completed, no email surfaced):`);
  for (const entry of findCompletedList) {
    const leadSummary = entry.leads.length
      ? entry.leads.map((lead) => {
        const kind = lead.type || 'unknown';
        const confidence = lead.confidence || 'unknown';
        const reason = lead.rejectedReason ? `:${lead.rejectedReason}` : '';
        return `${kind}/${confidence}${reason}`;
      }).join(', ')
      : 'none';
    console.log(`  - ${entry.name}: ${entry.leads.length} lead(s) [${leadSummary}]`);
  }
})().catch((e) => { console.error('PROBE ERROR:', e.message); process.exit(1); });
