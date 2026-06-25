#!/usr/bin/env node
/**
 * READ-ONLY probe (S289): measure duplicate `wmkf_potentialreviewers` records and
 * how engaged they are, to settle whether a merge feature needs to handle the
 * ENGAGED-loser case or can scope v1 to pre-engagement losers.
 *
 * Definitions:
 *   - Duplicate cluster = ≥2 active person rows sharing a normalized ORCID, OR
 *     sharing a normalized full name. (Exact-email dups can't exist: the
 *     wmkf_emailaddress_unique alt-key blocks them — that's the triggering bug.)
 *   - A person row is ENGAGED if it has ≥1 suggestion row with any of: accepted,
 *     a responsetype, an honorarium link, a review file, or a live (issued,
 *     non-revoked) token.
 *
 * Output: cluster counts by engagement profile (0 / 1 / ≥2 engaged members) for
 * ORCID-clusters and name-clusters. Writes NOTHING. Names/emails are NOT printed
 * (names-stay-local norm) — only counts and cluster-size/engagement histograms.
 */

import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { loadEnvLocal, getAccessToken, createClient } = require('../lib/dataverse/client.js');

const POTENTIAL_REVIEWER_SET = 'wmkf_potentialreviewerses';
const SUGGESTION_SET = 'wmkf_appreviewersuggestions';

function fail(message) { console.error(message); process.exit(1); }
function escapeOdataString(value) { return String(value).replace(/'/g, "''"); }

async function queryAll(client, entitySet, params) {
  const rows = [];
  let path = `/${entitySet}?${new URLSearchParams(params).toString()}`;
  while (path) {
    const res = await client.get(path);
    if (!res.ok) fail(`GET ${path} failed (${res.status}): ${res.text}`);
    rows.push(...(res.body?.value || []));
    const next = res.body?.['@odata.nextLink'];
    // nextLink is absolute; strip to a client-relative path
    path = next ? next.replace(/^.*\/api\/data\/v9\.2/, '') : null;
  }
  return rows;
}

function chunks(items, size) {
  const out = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

function normName(s) {
  return String(s || '')
    .toLowerCase()
    .replace(/^(dr\.?|prof\.?|professor)\s+/i, '')
    .replace(/[^a-z\s]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}
function normOrcid(s) {
  const m = String(s || '').replace(/[^0-9x]/gi, '');
  return m.length === 16 ? m.toLowerCase() : '';
}

function clustersOf(rows, keyFn) {
  const map = new Map();
  for (const r of rows) {
    const k = keyFn(r);
    if (!k) continue;
    if (!map.has(k)) map.set(k, []);
    map.get(k).push(r);
  }
  return [...map.values()].filter((g) => g.length > 1);
}

async function main() {
  loadEnvLocal();
  const resourceUrl = process.env.DYNAMICS_URL || process.env.DATAVERSE_URL;
  if (!resourceUrl) fail('Missing DYNAMICS_URL or DATAVERSE_URL');
  const token = await getAccessToken(resourceUrl);
  const client = createClient({ resourceUrl, token });

  // 1. All active person rows (statecode 0). Active-only: merging deactivated
  //    rows isn't the use case.
  const people = await queryAll(client, POTENTIAL_REVIEWER_SET, {
    '$select': 'wmkf_potentialreviewersid,wmkf_name,wmkf_orcid,wmkf_emailaddress,statecode,_wmkf_contact_value',
    '$filter': 'statecode eq 0',
  });
  console.log(`Active potential-reviewer rows: ${people.length}`);
  const withEmail = people.filter((p) => p.wmkf_emailaddress).length;
  const withOrcid = people.filter((p) => normOrcid(p.wmkf_orcid)).length;
  const withContact = people.filter((p) => p._wmkf_contact_value).length;
  console.log(`  with email: ${withEmail} | with valid ORCID: ${withOrcid} | promoted (has contact): ${withContact}`);

  // 2. Exact normalized-email dups (expected ~0 — alt-key blocks them).
  const emailDups = clustersOf(people, (p) => (p.wmkf_emailaddress || '').trim().toLowerCase());
  console.log(`\nExact normalized-email duplicate clusters: ${emailDups.length} (expected ~0; alt-key blocks exact dups)`);

  // 3. ORCID + name duplicate clusters.
  const orcidClusters = clustersOf(people, (p) => normOrcid(p.wmkf_orcid));
  const nameClusters = clustersOf(people, (p) => normName(p.wmkf_name));
  console.log(`ORCID duplicate clusters (same ORCID, ≥2 active rows): ${orcidClusters.length}`);
  console.log(`Name duplicate clusters (same normalized name, ≥2 active rows): ${nameClusters.length}`);

  // 4. Engagement: gather suggestions for every person id that appears in ANY
  //    cluster, classify each person engaged/not.
  const clusterPeople = new Set();
  for (const g of [...orcidClusters, ...nameClusters]) {
    for (const r of g) clusterPeople.add(r.wmkf_potentialreviewersid);
  }
  const ids = [...clusterPeople];
  const engaged = new Set();
  const hasAnySuggestion = new Set();
  for (const group of chunks(ids, 15)) {
    const filter = group.map((id) => `_wmkf_potentialreviewer_value eq ${escapeOdataString(id)}`).join(' or ');
    const suggestions = await queryAll(client, SUGGESTION_SET, {
      '$select': '_wmkf_potentialreviewer_value,wmkf_accepted,wmkf_responsetype,_wmkf_honorariumrequest_value,wmkf_reviewfilename,wmkf_externaltokenissued,wmkf_externaltokenrevoked',
      '$filter': filter,
    });
    for (const s of suggestions) {
      const pid = String(s._wmkf_potentialreviewer_value || '').toLowerCase();
      if (!pid) continue;
      hasAnySuggestion.add(pid);
      const liveToken = s.wmkf_externaltokenissued && !s.wmkf_externaltokenrevoked;
      const isEngaged = s.wmkf_accepted === true
        || (s.wmkf_responsetype !== null && s.wmkf_responsetype !== undefined)
        || !!s._wmkf_honorariumrequest_value
        || !!s.wmkf_reviewfilename
        || !!liveToken;
      if (isEngaged) engaged.add(pid);
    }
  }
  const isEng = (r) => engaged.has(String(r.wmkf_potentialreviewersid).toLowerCase());

  function profile(clusters, label) {
    let zero = 0, one = 0, twoPlus = 0, totalRows = 0;
    for (const g of clusters) {
      const n = g.filter(isEng).length;
      totalRows += g.length;
      if (n === 0) zero++;
      else if (n === 1) one++;
      else twoPlus++;
    }
    console.log(`\n${label}: ${clusters.length} clusters, ${totalRows} rows`);
    console.log(`  0 engaged members (SAFE pre-engagement merge): ${zero}`);
    console.log(`  exactly 1 engaged member (v1-handleable, engaged keeper): ${one}`);
    console.log(`  ≥2 engaged members (DANGEROUS tail — would block): ${twoPlus}`);
  }
  profile(orcidClusters, 'ORCID clusters by engaged-member count');
  profile(nameClusters, 'Name clusters by engaged-member count');

  console.log(`\nCluster persons with ANY suggestion row: ${hasAnySuggestion.size} of ${ids.length} clustered persons`);
  console.log(`Cluster persons that are ENGAGED: ${engaged.size} of ${ids.length}`);
}

main().catch((err) => fail(err?.stack || err?.message || String(err)));
