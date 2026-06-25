#!/usr/bin/env node
/**
 * READ-ONLY probe (S289): find duplicate CRM `contacts` (same person, multiple
 * rows). Clusters by three signals, strongest first:
 *   - exact normalized email (emailaddress1)        — high confidence
 *   - normalized ORCID (wmkf_orcid)                  — high confidence
 *   - normalized full name                           — LOW confidence (namesakes)
 * Prints cluster counts + samples. No writes. Names printed for staff triage.
 */
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { loadEnvLocal, getAccessToken, createClient } = require('../lib/dataverse/client.js');

function fail(m) { console.error(m); process.exit(1); }
function normEmail(e) { return String(e || '').trim().toLowerCase(); }
function normName(s) {
  return String(s || '').toLowerCase()
    .replace(/^(dr\.?|prof\.?|professor)\s+/i, '')
    .replace(/,?\s*(phd|ph\.d\.?|md|m\.d\.?|dvm|dphil|msc|bsc)\b/gi, '')
    .replace(/[^a-z\s]/g, '').replace(/\s+/g, ' ').trim();
}
function normOrcid(s) {
  const m = String(s || '').replace(/[^0-9x]/gi, '');
  return m.length === 16 ? m.toLowerCase() : '';
}

async function getAll(client, path, label) {
  const rows = [];
  let p = path, pages = 0;
  while (p) {
    const res = await client.get(p);
    if (!res.ok) fail(`GET ${label} failed (${res.status}): ${res.text}`);
    rows.push(...(res.body?.value || []));
    const next = res.body?.['@odata.nextLink'];
    p = next ? next.replace(/^.*\/api\/data\/v9\.2/, '') : null;
    if (++pages % 10 === 0) process.stderr.write(`  ${label}: ${rows.length}…\n`);
  }
  return rows;
}

function cluster(rows, keyFn) {
  const m = new Map();
  for (const r of rows) {
    const k = keyFn(r);
    if (!k) continue;
    if (!m.has(k)) m.set(k, []);
    m.get(k).push(r);
  }
  return [...m.entries()].filter(([, g]) => g.length > 1).sort((a, b) => b[1].length - a[1].length);
}

function label(c) {
  return `"${(c.fullname || '').trim()}" <${c.emailaddress1 || 'no-email'}>${c.wmkf_orcid ? ' orcid:' + c.wmkf_orcid : ''} state=${c.statecode} [${c.contactid}]`;
}

function report(clusters, title, max = 20) {
  const totalRows = clusters.reduce((n, [, g]) => n + g.length, 0);
  console.log(`\n=== ${title}: ${clusters.length} clusters, ${totalRows} rows ===`);
  for (const [, g] of clusters.slice(0, max)) {
    console.log(`  (${g.length}) ${g.map(label).join('  |  ')}`);
  }
  if (clusters.length > max) console.log(`  … ${clusters.length - max} more clusters`);
}

async function main() {
  loadEnvLocal();
  const url = process.env.DYNAMICS_URL || process.env.DATAVERSE_URL;
  if (!url) fail('Missing DYNAMICS_URL/DATAVERSE_URL');
  const token = await getAccessToken(url);
  const client = createClient({ resourceUrl: url, token });

  const contacts = await getAll(client,
    `/contacts?$select=contactid,fullname,firstname,lastname,emailaddress1,wmkf_orcid,statecode`,
    'contacts');
  console.log(`Total contacts scanned: ${contacts.length}`);
  const active = contacts.filter((c) => c.statecode === 0);
  console.log(`  active: ${active.length}`);

  // HIGH PRECISION: same normalized name AND same normalized email. Excludes the
  // shared-institutional-inbox false positives (different names, same role email)
  // and namesakes (same name, different email). This is the real "same person,
  // multiple rows" dedup set.
  const nameEmail = cluster(contacts, (c) => {
    const n = normName(c.fullname), e = normEmail(c.emailaddress1);
    return n && e ? `${n}||${e}` : '';
  });
  report(nameEmail, 'NAME+EMAIL duplicates (HIGH precision — real same-person rows)', 40);
  // Active/inactive split of those clusters (churn signal).
  let allActive = 0, mixed = 0;
  for (const [, g] of nameEmail) {
    const act = g.filter((c) => c.statecode === 0).length;
    if (act === g.length) allActive++; else mixed++;
  }
  console.log(`  of ${nameEmail.length} name+email clusters: ${allActive} all-active, ${mixed} mixed active/inactive`);

  // The other signals, for context (polluted — see notes).
  report(cluster(contacts, (c) => normOrcid(c.wmkf_orcid)), 'ORCID duplicates (sparse on contacts)');
  report(cluster(contacts, (c) => normEmail(c.emailaddress1)), 'EMAIL-only duplicates (POLLUTED by shared institutional inboxes)', 8);
}
main().catch((e) => fail(e?.stack || e?.message || String(e)));
