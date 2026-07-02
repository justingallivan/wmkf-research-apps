#!/usr/bin/env node
/**
 * Dry-run by default. Backfills only the Dataverse suggestion id anchor onto
 * existing reviewer_find_roster blobs whose vetted email is present but whose
 * suggestionId is missing. Writes require --execute.
 *
 * Safety: stamps a roster row only when exactly one selected
 * wmkf_appreviewersuggestion on the same request has a linked potential
 * reviewer whose normalized name exactly matches the roster row. Does not write
 * emails or mutate Dataverse.
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { sql } from '@vercel/postgres';
import { pickVettedEmail } from '../lib/utils/reviewer-vetted-email.js';
import rosterStore from '../lib/services/reviewer-roster-store.js';
import nameMatch from '../lib/utils/reviewer-name-match.js';

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
if (!process.env.POSTGRES_URL && process.env.DATABASE_URL) {
  process.env.POSTGRES_URL = process.env.DATABASE_URL;
}

const execute = process.argv.includes('--execute');
const limitArg = process.argv.find((arg) => arg.startsWith('--limit='));
const limit = Math.min(5000, Math.max(1, Number(limitArg?.split('=')[1]) || 1000));
const normalizeReviewerName = nameMatch.normalizeReviewerName;
const { stampSuggestionAnchor } = rosterStore;

function die(message) {
  console.error(message);
  process.exit(1);
}

for (const key of ['DYNAMICS_TENANT_ID', 'DYNAMICS_CLIENT_ID', 'DYNAMICS_CLIENT_SECRET', 'DYNAMICS_URL']) {
  if (!process.env[key]) die(`Missing required env var: ${key}`);
}

async function getToken() {
  const r = await fetch(`https://login.microsoftonline.com/${process.env.DYNAMICS_TENANT_ID}/oauth2/v2.0/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'client_credentials',
      client_id: process.env.DYNAMICS_CLIENT_ID,
      client_secret: process.env.DYNAMICS_CLIENT_SECRET,
      scope: `${process.env.DYNAMICS_URL}/.default`,
    }),
  });
  if (!r.ok) throw new Error(`Token request failed: ${r.status}`);
  return (await r.json()).access_token;
}

async function getAll(token, urlPath) {
  let next = `${process.env.DYNAMICS_URL}/api/data/v9.2${urlPath}`;
  const rows = [];
  while (next) {
    const r = await fetch(next, {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/json',
        'OData-Version': '4.0',
        Prefer: 'odata.maxpagesize=500',
      },
    });
    const text = await r.text();
    let body;
    try { body = JSON.parse(text); } catch { body = text; }
    if (!r.ok) throw new Error(`GET ${urlPath} failed: ${r.status} ${typeof body === 'string' ? body : JSON.stringify(body)}`);
    rows.push(...(body.value || []));
    next = body['@odata.nextLink'] || null;
  }
  return rows;
}

async function selectedSuggestionsByName(token, requestId) {
  const suggestions = await getAll(
    token,
    `/wmkf_appreviewersuggestions?$select=wmkf_appreviewersuggestionid,_wmkf_potentialreviewer_value&$filter=_wmkf_request_value eq ${requestId} and wmkf_selected eq true`,
  );
  const personIds = [...new Set(suggestions.map((s) => s._wmkf_potentialreviewer_value).filter(Boolean))];
  const people = new Map();
  for (let i = 0; i < personIds.length; i += 20) {
    const filter = personIds.slice(i, i + 20).map((id) => `wmkf_potentialreviewersid eq ${id}`).join(' or ');
    const rows = await getAll(
      token,
      `/wmkf_potentialreviewerses?$select=wmkf_potentialreviewersid,wmkf_name&$filter=${encodeURIComponent(filter)}`,
    );
    for (const row of rows) people.set(row.wmkf_potentialreviewersid, row);
  }

  const byName = new Map();
  for (const suggestion of suggestions) {
    const person = people.get(suggestion._wmkf_potentialreviewer_value);
    const normalized = normalizeReviewerName(person?.wmkf_name);
    if (!normalized) continue;
    const list = byName.get(normalized) || [];
    list.push({
      suggestionId: suggestion.wmkf_appreviewersuggestionid,
      potentialReviewerId: suggestion._wmkf_potentialreviewer_value,
      name: person.wmkf_name,
    });
    byName.set(normalized, list);
  }
  return byName;
}

const rosterRes = await sql`
  SELECT request_id, normalized_name, display_name, candidate, updated_at
  FROM reviewer_find_roster
  WHERE status IN ('active', 'saved')
    AND candidate->>'suggestionId' IS NULL
    AND (candidate->>'emailPersistAllowed' = 'true'
         OR candidate->'contactEnrichment'->>'emailPersistAllowed' = 'true')
    AND COALESCE(NULLIF(candidate->>'email', ''), NULLIF(candidate->'contactEnrichment'->>'email', '')) IS NOT NULL
  ORDER BY updated_at DESC
  LIMIT ${limit}
`;

const candidates = rosterRes.rows
  .map((row) => ({ ...row, vetted: pickVettedEmail(row.candidate) }))
  .filter((row) => row.vetted);

const token = await getToken();
const suggestionsByRequest = new Map();
const summary = {
  mode: execute ? 'EXECUTE' : 'DRY RUN',
  scannedRosterRows: rosterRes.rows.length,
  vettedRows: candidates.length,
  wouldStamp: 0,
  stamped: 0,
  absent: 0,
  ambiguous: 0,
  errors: 0,
};

const skipped = [];
for (const row of candidates) {
  try {
    if (!suggestionsByRequest.has(row.request_id)) {
      suggestionsByRequest.set(row.request_id, await selectedSuggestionsByName(token, row.request_id));
    }
    const matches = suggestionsByRequest.get(row.request_id).get(row.normalized_name) || [];
    if (matches.length === 0) {
      summary.absent++;
      skipped.push(`ABSENT ${row.display_name} request=${row.request_id}`);
      continue;
    }
    if (matches.length > 1) {
      summary.ambiguous++;
      skipped.push(`AMBIGUOUS ${row.display_name} request=${row.request_id} matches=${matches.map((m) => m.suggestionId).join(',')}`);
      continue;
    }

    summary.wouldStamp++;
    const match = matches[0];
    if (execute) {
      const out = await stampSuggestionAnchor(row.request_id, row.display_name || row.candidate?.name, {
        suggestionId: match.suggestionId,
      });
      if (out.updated > 0) summary.stamped++;
      else skipped.push(`NO-ROW ${row.display_name} request=${row.request_id} suggestion=${match.suggestionId}`);
    }
  } catch (err) {
    summary.errors++;
    skipped.push(`ERROR ${row.display_name} request=${row.request_id}: ${err?.message || err}`);
  }
}

console.log(`Reviewer roster suggestion-anchor backfill (${summary.mode})`);
console.log(`  roster rows scanned: ${summary.scannedRosterRows}`);
console.log(`  vetted rows:         ${summary.vettedRows}`);
console.log(`  ${execute ? 'stamped' : 'would stamp'}:        ${execute ? summary.stamped : summary.wouldStamp}`);
console.log(`  absent matches:      ${summary.absent}`);
console.log(`  ambiguous matches:   ${summary.ambiguous}`);
console.log(`  row errors:          ${summary.errors}`);
if (!execute) console.log('\nNo writes performed. Re-run with --execute to stamp suggestionId anchors.');
if (skipped.length) {
  console.log('\nSkipped / notes:');
  for (const line of skipped.slice(0, 100)) console.log(`  - ${line}`);
  if (skipped.length > 100) console.log(`  ... ${skipped.length - 100} more`);
}
