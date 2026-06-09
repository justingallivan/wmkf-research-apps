#!/usr/bin/env node
/**
 * READ-ONLY dry run: list recent wmkf_potentialreviewer rows with zero
 * wmkf_appreviewersuggestion rows.
 *
 * This does not delete anything. Delete rights and ownership are uncertain,
 * and upsertByEmail can reuse these reviewer person rows on a later successful
 * save, so this script only identifies candidates for a human cleanup review.
 */

import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { loadEnvLocal, getAccessToken, createClient } = require('../lib/dataverse/client.js');

const daysArg = Number.parseInt(process.argv[2] || '30', 10);
const DAYS = Number.isFinite(daysArg) && daysArg > 0 ? daysArg : 30;
const POTENTIAL_REVIEWER_SET = 'wmkf_potentialreviewerses';
const SUGGESTION_SET = 'wmkf_appreviewersuggestions';

function fail(message) {
  console.error(message);
  process.exit(1);
}

function cutoffIso(days) {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - days);
  return d.toISOString();
}

function escapeOdataString(value) {
  return String(value).replace(/'/g, "''");
}

async function queryAll(client, entitySet, params) {
  const rows = [];
  let path = `/${entitySet}?${new URLSearchParams(params).toString()}`;
  while (path) {
    const res = await client.get(path);
    if (!res.ok) fail(`GET ${path} failed (${res.status}): ${res.text}`);
    rows.push(...(res.body?.value || []));
    const next = res.body?.['@odata.nextLink'];
    path = next || null;
  }
  return rows;
}

function chunks(items, size) {
  const out = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

async function main() {
  loadEnvLocal();
  const resourceUrl = process.env.DYNAMICS_URL || process.env.DATAVERSE_URL;
  if (!resourceUrl) fail('Missing DYNAMICS_URL or DATAVERSE_URL');

  const token = await getAccessToken(resourceUrl);
  const client = createClient({ resourceUrl, token });
  const cutoff = cutoffIso(DAYS);

  const reviewers = await queryAll(client, POTENTIAL_REVIEWER_SET, {
    '$select': 'wmkf_potentialreviewersid,wmkf_name,wmkf_emailaddress,createdon',
    '$filter': `createdon ge ${cutoff}`,
    '$orderby': 'createdon desc',
  });

  const idsWithSuggestions = new Set();
  for (const group of chunks(reviewers.map((r) => r.wmkf_potentialreviewersid).filter(Boolean), 20)) {
    const filter = group.map((id) => `_wmkf_potentialreviewer_value eq ${escapeOdataString(id)}`).join(' or ');
    const suggestions = await queryAll(client, SUGGESTION_SET, {
      '$select': 'wmkf_appreviewersuggestionid,_wmkf_potentialreviewer_value',
      '$filter': filter,
    });
    for (const suggestion of suggestions) {
      if (suggestion._wmkf_potentialreviewer_value) {
        idsWithSuggestions.add(String(suggestion._wmkf_potentialreviewer_value).toLowerCase());
      }
    }
  }

  const orphans = reviewers.filter((r) => !idsWithSuggestions.has(String(r.wmkf_potentialreviewersid).toLowerCase()));
  console.log(`Recent orphan potential reviewers: ${orphans.length} of ${reviewers.length} created since ${cutoff} (${DAYS} days)`);
  for (const r of orphans) {
    console.log([
      r.wmkf_potentialreviewersid,
      r.createdon || '',
      r.wmkf_name || '(unnamed)',
      r.wmkf_emailaddress || '(no email)',
    ].join('\t'));
  }
}

main().catch((err) => fail(err?.stack || err?.message || String(err)));
