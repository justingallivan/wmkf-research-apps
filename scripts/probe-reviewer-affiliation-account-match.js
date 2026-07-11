#!/usr/bin/env node
/**
 * READ-ONLY feasibility probe for auto-linking reviewer institutions.
 *
 * Question: of the reviewer "reported affiliation" strings, how many exact-match
 * exactly ONE account record (→ safe to auto-link, no human), vs match nothing
 * (institution not in the CRM), vs match ambiguously (duplicate accounts).
 *
 * Two populations are sized:
 *   1. The live alert BACKLOG — active/acknowledged
 *      `reviewer_contact_affiliation_mismatch` rows in Postgres `system_alerts`
 *      (metadata carries `reviewerAffiliation` + `contactInstitution`).
 *   2. ALL accepted reviewers with a reported affiliation (Dataverse), which is
 *      stable regardless of whether an alert is currently open.
 *
 * NO WRITES. The only POST is the OAuth token; every Dataverse call is a GET and
 * every Postgres call is a SELECT.
 */

const fs = require('fs');
const path = require('path');

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

const { sql } = require('@vercel/postgres');

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

async function getAll(token, urlPath) {
  let next = `${process.env.DYNAMICS_URL}/api/data/v9.2${urlPath}`;
  const rows = [];
  while (next) {
    const r = await fetch(next, {
      headers: { Authorization: `Bearer ${token}`, Accept: 'application/json', 'OData-Version': '4.0' },
    });
    const t = await r.text();
    let body; try { body = JSON.parse(t); } catch { body = t; }
    if (!r.ok) throw new Error(`GET ${urlPath}: ${r.status} ${typeof body === 'string' ? body.slice(0, 240) : JSON.stringify(body).slice(0, 240)}`);
    for (const v of (body.value || [])) rows.push(v);
    next = body['@odata.nextLink'] || null;
  }
  return rows;
}

// Conservative normalization for an "exact match" claim: lowercase, strip
// punctuation/symbols, collapse whitespace. Deliberately does NOT expand
// acronyms or strip suffixes — those are the ambiguous cases we WANT to leave
// out of the auto-resolvable bucket.
function norm(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function classify(affiliation, accountsByNorm) {
  const key = norm(affiliation);
  if (!key) return { bucket: 'blank', accounts: [] };
  const hit = accountsByNorm.get(key);
  if (!hit) return { bucket: 'no_match', accounts: [] };
  if (hit.length === 1) return { bucket: 'exact_single', accounts: hit };
  return { bucket: 'duplicate_accounts', accounts: hit };
}

function tally(items, getAffiliation, accountsByNorm) {
  const buckets = { exact_single: [], no_match: [], duplicate_accounts: [], blank: [] };
  for (const it of items) {
    const c = classify(getAffiliation(it), accountsByNorm);
    buckets[c.bucket].push({ affiliation: getAffiliation(it), matched: c.accounts.map((a) => a.name) });
  }
  return buckets;
}

function report(label, total, buckets) {
  const pct = (n) => (total ? `${((n / total) * 100).toFixed(0)}%` : '0%');
  console.log(`\n=== ${label} (n=${total}) ===`);
  console.log(`  auto-resolvable (exact match → exactly 1 account): ${buckets.exact_single.length} (${pct(buckets.exact_single.length)})`);
  console.log(`  not in CRM accounts (0 matches):                   ${buckets.no_match.length} (${pct(buckets.no_match.length)})`);
  console.log(`  duplicate accounts (exact match → >1 account):     ${buckets.duplicate_accounts.length} (${pct(buckets.duplicate_accounts.length)})`);
  console.log(`  blank affiliation:                                 ${buckets.blank.length}`);
  const sample = (arr, n = 8) => arr.slice(0, n).map((x) => `"${x.affiliation}"${x.matched.length ? ` → ${x.matched.join(' | ')}` : ''}`);
  if (buckets.exact_single.length) console.log(`  sample auto-resolvable:\n    ${sample(buckets.exact_single).join('\n    ')}`);
  if (buckets.no_match.length) console.log(`  sample NOT in accounts:\n    ${sample(buckets.no_match).join('\n    ')}`);
  if (buckets.duplicate_accounts.length) console.log(`  sample duplicate-account:\n    ${sample(buckets.duplicate_accounts).join('\n    ')}`);
}

(async () => {
  console.log(`Reviewer-affiliation → account match probe — ${new Date().toISOString()} (READ-ONLY)`);
  const token = await getToken();

  // 1. All accounts → normalized-name index.
  const accounts = await getAll(token, `/accounts?$select=accountid,name`);
  const accountsByNorm = new Map();
  for (const a of accounts) {
    const k = norm(a.name);
    if (!k) continue;
    if (!accountsByNorm.has(k)) accountsByNorm.set(k, []);
    accountsByNorm.get(k).push({ id: a.accountid, name: a.name });
  }
  console.log(`\nAccounts: ${accounts.length} total, ${accountsByNorm.size} distinct normalized names`);
  const dupNames = [...accountsByNorm.values()].filter((v) => v.length > 1).length;
  console.log(`  ${dupNames} normalized names map to >1 account (duplicate account records)`);

  // 2. Live alert backlog (Postgres).
  try {
    const { rows } = await sql`
      SELECT metadata FROM system_alerts
      WHERE alert_type = 'reviewer_contact_affiliation_mismatch'
        AND status IN ('active', 'acknowledged')
    `;
    const withInst = rows.filter((r) => r.metadata && (r.metadata.contactInstitution || '').trim()).length;
    console.log(`\nAlert backlog: ${rows.length} active/acknowledged affiliation-mismatch alerts`);
    console.log(`  of those, ${withInst} already have a (different) contact institution set — an overwrite decision, not a fill`);
    const buckets = tally(rows, (r) => r.metadata?.reviewerAffiliation, accountsByNorm);
    report('BACKLOG alerts', rows.length, buckets);
  } catch (e) {
    console.log(`\n(Alert backlog query skipped: ${e.message})`);
  }

  // 3. All accepted reviewers with a reported affiliation (Dataverse, stable population).
  const accepted = await getAll(
    token,
    `/wmkf_appreviewersuggestions?$select=wmkf_appreviewersuggestionid,wmkf_revieweraffiliation`
    + `&$filter=wmkf_accepted eq true and wmkf_declined ne true and wmkf_revieweraffiliation ne null`,
  );
  const buckets = tally(accepted, (s) => s.wmkf_revieweraffiliation, accountsByNorm);
  report('ALL accepted reviewers w/ reported affiliation', accepted.length, buckets);

  console.log('\nDone (read-only, no changes made).');
  process.exit(0);
})().catch((e) => { console.error('PROBE FAILED:', e.message); process.exit(1); });
