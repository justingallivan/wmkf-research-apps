#!/usr/bin/env node
/**
 * READ-ONLY audit: how widespread are duplicate wmkf_potentialreviewers rows
 * sharing an email? Triggered by the Edit Candidate 412 bug — one Christopher
 * Chang turned out to have a 2025 row (chrischang@princeton.edu, Princeton)
 * and a 2026 re-discovery row (lp9904@princeton.edu, Berkeley), with the
 * current suggestion pointed at the wrong row.
 *
 * Strategy: pull all active wmkf_potentialreviewers with non-null email,
 * group by normalized email (lowercase + trim), report any group with >1.
 * For each dup group, also count selected suggestions per row so we can see
 * which row(s) are "load-bearing" (referenced by a live suggestion).
 *
 * Pure GET; no writes. Reports counts only, no PII beyond names already
 * visible to staff in Reviewer Finder.
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

async function getAll(token, entitySet, query) {
  let url = `${process.env.DYNAMICS_URL}/api/data/v9.2/${entitySet}?${query}`;
  const out = [];
  while (url) {
    const r = await fetch(url, {
      headers: {
        Authorization: `Bearer ${token}`, Accept: 'application/json', 'OData-Version': '4.0',
        Prefer: 'odata.maxpagesize=5000',
      },
    });
    const t = await r.text();
    let body; try { body = JSON.parse(t); } catch { body = t; }
    if (!r.ok) throw new Error(`GET ${url}: ${r.status} ${typeof body === 'string' ? body.slice(0, 240) : JSON.stringify(body).slice(0, 240)}`);
    out.push(...(body.value || []));
    url = body['@odata.nextLink'] || null;
  }
  return out;
}

(async () => {
  const token = await getToken();
  console.log(`Audit: duplicate wmkf_potentialreviewers rows by email — ${new Date().toISOString()}\n`);

  // 1. Pull every potential reviewer with a non-null email.
  const people = await getAll(token, 'wmkf_potentialreviewerses',
    new URLSearchParams({
      $select: 'wmkf_potentialreviewersid,wmkf_name,wmkf_emailaddress,wmkf_organizationname,createdon,modifiedon,statecode',
      $filter: 'wmkf_emailaddress ne null',
    }).toString());

  console.log(`Loaded ${people.length} wmkf_potentialreviewers rows with non-null email.\n`);

  // 2. Group by normalized email.
  const byEmail = new Map();
  for (const p of people) {
    const key = (p.wmkf_emailaddress || '').trim().toLowerCase();
    if (!key) continue;
    if (!byEmail.has(key)) byEmail.set(key, []);
    byEmail.get(key).push(p);
  }

  const dupGroups = [...byEmail.entries()].filter(([, rows]) => rows.length > 1);
  console.log(`Email keys with >1 row: ${dupGroups.length}\n`);

  if (dupGroups.length === 0) {
    console.log('No duplicate groups by email. The Chris Chang case may be unique.');
    return;
  }

  // 3. For each dup group, count selected suggestions per row.
  console.log('Collecting selected suggestion counts per dup row...');
  const allDupIds = dupGroups.flatMap(([, rows]) => rows.map((r) => r.wmkf_potentialreviewersid));
  const sugCountByPerson = {};
  const CHUNK = 25;
  for (let i = 0; i < allDupIds.length; i += CHUNK) {
    const chunk = allDupIds.slice(i, i + CHUNK);
    const filter = `(${chunk.map((id) => `_wmkf_potentialreviewer_value eq ${id}`).join(' or ')}) and wmkf_selected eq true`;
    const sugs = await getAll(token, 'wmkf_appreviewersuggestions',
      new URLSearchParams({
        $select: 'wmkf_appreviewersuggestionid,_wmkf_potentialreviewer_value',
        $filter: filter,
      }).toString());
    for (const s of sugs) {
      const pid = s._wmkf_potentialreviewer_value;
      sugCountByPerson[pid] = (sugCountByPerson[pid] || 0) + 1;
    }
  }

  // 4. Summary tally.
  let bothLoadBearing = 0; // ≥2 rows in the group each carry ≥1 selected suggestion
  let oneLoadBearing = 0;  // exactly one row carries selected suggestions
  let zeroLoadBearing = 0; // no row in the group has any selected suggestion (orphan dup pair)
  const detailedSamples = [];
  for (const [email, rows] of dupGroups) {
    const counts = rows.map((r) => sugCountByPerson[r.wmkf_potentialreviewersid] || 0);
    const carrying = counts.filter((c) => c > 0).length;
    if (carrying >= 2) bothLoadBearing++;
    else if (carrying === 1) oneLoadBearing++;
    else zeroLoadBearing++;
    if (detailedSamples.length < 20) {
      detailedSamples.push({ email, rows, counts });
    }
  }

  console.log(`\n══ Summary ══`);
  console.log(`  total dup groups (>1 row sharing email)         : ${dupGroups.length}`);
  console.log(`  groups where ≥2 rows each have selected suggs   : ${bothLoadBearing}  (real split-suggestion problem)`);
  console.log(`  groups where exactly 1 row has selected suggs   : ${oneLoadBearing}  (the other row(s) are orphan dups)`);
  console.log(`  groups where 0 rows have selected suggs         : ${zeroLoadBearing}  (pure dust)`);
  console.log(`\n══ Sample (first ${detailedSamples.length} groups) ══\n`);
  for (const { email, rows, counts } of detailedSamples) {
    console.log(`email: ${email}  (${rows.length} rows)`);
    rows
      .map((r, i) => ({ r, n: counts[i] }))
      .sort((a, b) => (b.n - a.n) || new Date(b.r.createdon) - new Date(a.r.createdon))
      .forEach(({ r, n }) => {
        const name = (r.wmkf_name || '').trim() || '(no name)';
        const org = (r.wmkf_organizationname || '(no org)').slice(0, 60);
        console.log(`  ${r.wmkf_potentialreviewersid}  selected_suggs=${n.toString().padStart(2)}  ${name.padEnd(28)} ${org}  [created ${r.createdon.slice(0, 10)}]`);
      });
    console.log('');
  }

  if (dupGroups.length > detailedSamples.length) {
    console.log(`(${dupGroups.length - detailedSamples.length} more dup groups not shown)`);
  }
})().catch((e) => { console.error(e); process.exit(1); });
