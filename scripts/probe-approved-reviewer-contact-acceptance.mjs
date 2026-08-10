#!/usr/bin/env node
/**
 * READ-ONLY: verify whether the Contacts in an approved Contact→Account link
 * manifest have evidence that their linked reviewer person accepted at least
 * one review invitation.
 *
 * Usage:
 *   DATAVERSE_ALLOW_PROD_READS=yes node scripts/probe-approved-reviewer-contact-acceptance.mjs \
 *     --manifest outputs/<task>/reviewer-contact-account-approved-links.json
 *   ... --output outputs/<task>/reviewer-contact-account-acceptance.json
 */

import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  RESPONSE_TYPE_MAP,
  REVIEW_STATUS_MAP,
} from '../shared/config/reviewerLifecycle.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const envPath = path.join(__dirname, '..', '.env.local');
if (fs.existsSync(envPath)) {
  for (const line of fs.readFileSync(envPath, 'utf8').split('\n')) {
    const match = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (!match) continue;
    const [, key, raw] = match;
    const value = raw.trim().replace(/^"(.*)"$/, '$1').replace(/^'(.*)'$/, '$1');
    if (!process.env[key]) process.env[key] = value;
  }
}

for (const key of ['DYNAMICS_TENANT_ID', 'DYNAMICS_CLIENT_ID', 'DYNAMICS_CLIENT_SECRET', 'DYNAMICS_URL']) {
  if (!process.env[key]) {
    console.error(`Missing required env var: ${key}`);
    process.exit(1);
  }
}

function optionValue(name, args) {
  const index = args.indexOf(name);
  if (index < 0) return null;
  const value = args[index + 1];
  if (!value || value.startsWith('--')) throw new Error(`${name} requires a value`);
  return value;
}

const args = process.argv.slice(2);
const manifestArg = optionValue('--manifest', args);
const outputArg = optionValue('--output', args);
if (!manifestArg) {
  console.error('--manifest is required.');
  process.exit(1);
}

const manifestPath = path.resolve(manifestArg);
const manifestBytes = fs.readFileSync(manifestPath);
const manifest = JSON.parse(manifestBytes.toString('utf8'));
if (!Array.isArray(manifest.links) || manifest.links.length === 0) {
  throw new Error('Manifest must contain a non-empty links array.');
}

const contactIds = new Set(manifest.links.map((row) => String(row.contactId).toLowerCase()));
if (contactIds.size !== manifest.links.length) {
  throw new Error('Manifest contains duplicate Contact IDs.');
}

const { withDalContext } = await import('../lib/dataverse/core/context.js');
const potentialReviewerAdapter = await import('../lib/dataverse/adapters/potential-reviewer.js');
const reviewerSuggestionAdapter = await import('../lib/dataverse/adapters/reviewer-suggestion.js');

const POST_ACCEPT_REVIEW_STATUSES = new Set(Object.values(REVIEW_STATUS_MAP));

function hasAcceptanceEvidence(row) {
  return row.wmkf_accepted === true
    || row.wmkf_responsetype === RESPONSE_TYPE_MAP.accepted
    || POST_ACCEPT_REVIEW_STATUSES.has(row.wmkf_reviewstatus)
    || Boolean(row.wmkf_materialssentat)
    || Boolean(row.wmkf_reviewreceivedat)
    || Boolean(row.wmkf_completedat)
    || Boolean(row.wmkf_coiackedat)
    || Boolean(row.wmkf_aiuseackedat);
}

function currentAcceptance(row) {
  return row.wmkf_accepted === true && row.wmkf_declined !== true;
}

function suggestionSummary(row) {
  return {
    suggestionId: row.wmkf_appreviewersuggestionid,
    requestId: row._wmkf_request_value || null,
    selected: row.wmkf_selected === true,
    invited: row.wmkf_invited === true,
    accepted: row.wmkf_accepted === true,
    declined: row.wmkf_declined === true,
    responseType: row.wmkf_responsetype ?? null,
    reviewStatus: row.wmkf_reviewstatus ?? null,
    responseReceivedAt: row.wmkf_responsereceivedat || null,
    materialsSentAt: row.wmkf_materialssentat || null,
    reviewReceivedAt: row.wmkf_reviewreceivedat || null,
    completedAt: row.wmkf_completedat || null,
    acceptanceEvidence: hasAcceptanceEvidence(row),
    currentAcceptance: currentAcceptance(row),
  };
}

const live = await withDalContext('probe-approved-reviewer-contact-acceptance', async () => {
  const [reviewerResult, suggestionResult] = await Promise.all([
    potentialReviewerAdapter.queryAllReviewers({
      select: 'wmkf_potentialreviewersid,_wmkf_contact_value,statecode',
      filter: '_wmkf_contact_value ne null',
      orderby: 'wmkf_potentialreviewersid asc',
    }),
    reviewerSuggestionAdapter.queryAllSuggestions({
      select: [
        'wmkf_appreviewersuggestionid', '_wmkf_potentialreviewer_value', '_wmkf_request_value',
        'wmkf_selected', 'wmkf_invited', 'wmkf_accepted', 'wmkf_declined',
        'wmkf_responsetype', 'wmkf_reviewstatus', 'wmkf_responsereceivedat',
        'wmkf_materialssentat', 'wmkf_reviewreceivedat', 'wmkf_completedat',
        'wmkf_coiackedat', 'wmkf_aiuseackedat', 'statecode',
      ].join(','),
      filter: '_wmkf_potentialreviewer_value ne null',
      orderby: 'createdon asc',
    }),
  ]);
  if (reviewerResult.capped || suggestionResult.capped) {
    throw new Error('Dataverse scan hit the export cap; refusing to report a partial population.');
  }
  return {
    reviewers: reviewerResult.records || [],
    suggestions: suggestionResult.records || [],
  };
});

const reviewerIdsByContact = new Map();
for (const reviewer of live.reviewers) {
  const contactId = String(reviewer._wmkf_contact_value || '').toLowerCase();
  if (!contactIds.has(contactId)) continue;
  if (!reviewerIdsByContact.has(contactId)) reviewerIdsByContact.set(contactId, []);
  reviewerIdsByContact.get(contactId).push(String(reviewer.wmkf_potentialreviewersid).toLowerCase());
}

const suggestionsByReviewer = new Map();
for (const suggestion of live.suggestions) {
  const reviewerId = String(suggestion._wmkf_potentialreviewer_value || '').toLowerCase();
  if (!suggestionsByReviewer.has(reviewerId)) suggestionsByReviewer.set(reviewerId, []);
  suggestionsByReviewer.get(reviewerId).push(suggestion);
}

const people = manifest.links.map((link) => {
  const contactId = String(link.contactId).toLowerCase();
  const potentialReviewerIds = reviewerIdsByContact.get(contactId) || [];
  const suggestions = potentialReviewerIds.flatMap((reviewerId) => suggestionsByReviewer.get(reviewerId) || []);
  const evidenceRows = suggestions.filter(hasAcceptanceEvidence);
  const currentRows = suggestions.filter(currentAcceptance);
  const acceptanceCategory = currentRows.length > 0
    ? 'currently_accepted'
    : evidenceRows.length > 0
      ? 'historical_acceptance_only'
      : 'no_acceptance_evidence';
  return {
    reviewer: link.reviewer,
    contactId,
    potentialReviewerIds,
    acceptanceCategory,
    suggestionCount: suggestions.length,
    invitedSuggestionCount: suggestions.filter((row) => row.wmkf_invited === true).length,
    declinedSuggestionCount: suggestions.filter((row) => row.wmkf_declined === true).length,
    suggestions: suggestions.map(suggestionSummary),
  };
}).sort((a, b) => a.reviewer.localeCompare(b.reviewer));

const count = (category) => people.filter((person) => person.acceptanceCategory === category).length;
const report = {
  generatedAt: new Date().toISOString(),
  manifestPath,
  manifestSha256: crypto.createHash('sha256').update(manifestBytes).digest('hex'),
  definition: {
    currentlyAccepted: 'At least one suggestion has wmkf_accepted=true and is not declined.',
    historicalAcceptanceOnly: 'No current acceptance, but a suggestion retains a post-accept response/status/timestamp signal.',
    noAcceptanceEvidence: 'No suggestion has a current or retained post-accept signal.',
  },
  summary: {
    contactsChecked: people.length,
    currentlyAccepted: count('currently_accepted'),
    historicalAcceptanceOnly: count('historical_acceptance_only'),
    noAcceptanceEvidence: count('no_acceptance_evidence'),
    allHaveAcceptanceEvidence: count('no_acceptance_evidence') === 0,
  },
  people,
  noAcceptanceEvidence: people.filter((person) => person.acceptanceCategory === 'no_acceptance_evidence'),
  historicalAcceptanceOnly: people.filter((person) => person.acceptanceCategory === 'historical_acceptance_only'),
  note: 'Read-only probe; no Dataverse or Postgres writes were performed.',
};

const rendered = `${JSON.stringify(report, null, 2)}\n`;
if (outputArg) {
  const outputPath = path.resolve(outputArg);
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, rendered, 'utf8');
  console.log(`Report written to ${outputPath}`);
} else {
  process.stdout.write(rendered);
}
