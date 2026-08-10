#!/usr/bin/env node
/**
 * READ-ONLY: show which reviewer-linked CRM Contacts that lack parentcustomerid
 * have deterministic exact matches to existing active Dataverse Accounts.
 *
 * Cohort:
 *   - every potential-reviewer person row linked to a CRM Contact
 *   - grouped by Contact (one report row per Contact)
 *   - only Contacts with no parentcustomerid are match candidates
 *   - includes Contacts with adx_organizationname (the historical "+2")
 *
 * Affiliation evidence, in order of provenance:
 *   1. accepted suggestion self-report (wmkf_revieweraffiliation)
 *   2. reviewer-confirmed main institution
 *   3. reviewer primary affiliation / compatibility organization field
 *   4. Contact free-text organization
 *
 * Account target labels:
 *   name, akoya_aka, wmkf_legalname, and wmkf_dc_aka.
 * Matching is conservative: Unicode/case/punctuation/whitespace normalization
 * only. No acronym expansion, fuzzy match, suffix stripping, or writes.
 *
 * Usage:
 *   node scripts/probe-reviewer-contact-account-link-candidates.mjs
 *   node scripts/probe-reviewer-contact-account-link-candidates.mjs --all
 *   node scripts/probe-reviewer-contact-account-link-candidates.mjs --json
 *   node scripts/probe-reviewer-contact-account-link-candidates.mjs --csv
 *   node scripts/probe-reviewer-contact-account-link-candidates.mjs --json --output /tmp/report.json
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import {
  buildAccountLabelIndex,
  classifyContactAccountTargets,
  collectAffiliationEvidence,
  csvCell,
  nonBlank,
} from './lib/reviewer-contact-account-link-report.mjs';

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

const args = new Set(process.argv.slice(2));
const outputModes = ['--json', '--csv'].filter((flag) => args.has(flag));
if (outputModes.length > 1) {
  console.error('Choose at most one output mode: --json or --csv.');
  process.exit(1);
}
const showAll = args.has('--all');
const outputArgIndex = process.argv.indexOf('--output');
const outputPath = outputArgIndex >= 0 ? process.argv[outputArgIndex + 1] : null;
if (outputArgIndex >= 0 && (!outputPath || outputPath.startsWith('--'))) {
  console.error('--output requires a file path.');
  process.exit(1);
}
if (outputPath && outputModes.length === 0) {
  console.error('--output requires either --json or --csv.');
  process.exit(1);
}

const { withDalContext } = await import('../lib/dataverse/core/context.js');
const accountAdapter = await import('../lib/dataverse/adapters/account.js');
const contactAdapter = await import('../lib/dataverse/adapters/contact.js');
const potentialReviewerAdapter = await import('../lib/dataverse/adapters/potential-reviewer.js');
const reviewerSuggestionAdapter = await import('../lib/dataverse/adapters/reviewer-suggestion.js');

async function mapWithConcurrency(items, limit, fn) {
  const results = new Array(items.length);
  let next = 0;
  async function worker() {
    while (next < items.length) {
      const index = next;
      next += 1;
      results[index] = await fn(items[index], index);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, () => worker()));
  return results;
}

function groupBy(rows, keyOf) {
  const grouped = new Map();
  for (const row of rows || []) {
    const key = keyOf(row);
    if (!key) continue;
    if (!grouped.has(key)) grouped.set(key, []);
    grouped.get(key).push(row);
  }
  return grouped;
}

function reviewerDisplayName(reviewer) {
  return nonBlank(reviewer?.wmkf_name)
    || [nonBlank(reviewer?.wmkf_firstname), nonBlank(reviewer?.wmkf_lastname)].filter(Boolean).join(' ')
    || '(unnamed reviewer)';
}

function renderTarget(target) {
  const labels = target.matchedLabels
    .map((label) => `${label.field}="${label.value}"`)
    .join(', ');
  return `${target.accountName} [${target.accountId}] via ${labels}`;
}

function toCsv(rows) {
  const headings = [
    'status', 'reviewer_names', 'potential_reviewer_ids', 'contact_id',
    'contact_free_text_organization', 'affiliation_evidence',
    'target_account_names', 'target_account_ids', 'target_match_labels',
    'unmatched_affiliation_evidence',
  ];
  const lines = [headings.map(csvCell).join(',')];
  for (const row of rows) {
    lines.push([
      row.status,
      row.reviewerNames.join(' | '),
      row.potentialReviewerIds.join(' | '),
      row.contactId,
      row.contactFreeTextOrganization,
      row.affiliationEvidence.map((item) => item.value).join(' | '),
      row.targets.map((target) => target.accountName).join(' | '),
      row.targets.map((target) => target.accountId).join(' | '),
      row.targets.map((target) => target.matchedLabels.map((label) => `${label.field}:${label.value}`).join('; ')).join(' | '),
      row.unmatchedEvidence.join(' | '),
    ].map(csvCell).join(','));
  }
  return `${lines.join('\n')}\n`;
}

function printHuman(report) {
  const s = report.summary;
  console.log(`Reviewer Contact → Account link candidates — ${report.generatedAt} (READ-ONLY)`);
  console.log(`  linked reviewer rows:                  ${s.linkedReviewerRows}`);
  console.log(`  unique linked Contacts:                ${s.uniqueLinkedContacts}`);
  console.log(`  Contacts already carrying any parent:  ${s.contactsWithParent}`);
  console.log(`  candidate Contacts without a parent:   ${s.candidateContacts}`);
  console.log(`    with Contact free-text organization: ${s.candidatesWithContactOrganization}`);
  console.log(`    without Contact organization:        ${s.candidatesWithoutContactOrganization}`);
  console.log(`  unique deterministic Account target:   ${s.uniqueExactTargets}`);
  console.log(`  ambiguous deterministic targets:       ${s.ambiguousExactTargets}`);
  console.log(`  affiliation present, no exact target:  ${s.noExactTarget}`);
  console.log(`  no affiliation evidence:               ${s.noAffiliation}`);
  console.log(`  active Accounts scanned:               ${s.activeAccountsScanned}\n`);

  if (s.uniqueLinkedContacts !== 160 || s.contactsWithParent !== 16 || s.candidateContacts !== 144) {
    console.log('NOTE: the live cohort has drifted from the historical 160 linked / 16 parented / 144 unparented scan.');
    console.log('The rows below reflect current Dataverse state, not the historical count.\n');
  }

  const unique = report.rows.filter((row) => row.status === 'unique_exact_target');
  console.log(`=== UNIQUE DETERMINISTIC TARGETS (${unique.length}) ===`);
  if (unique.length === 0) console.log('  (none)');
  for (const row of unique) {
    console.log(`\n${row.reviewerNames.join(' / ')}  contact=${row.contactId}`);
    console.log(`  affiliation: ${row.affiliationEvidence.map((item) => item.value).join(' | ')}`);
    console.log(`  target:      ${renderTarget(row.targets[0])}`);
    if (row.unmatchedEvidence.length) {
      console.log(`  unmatched additional evidence: ${row.unmatchedEvidence.join(' | ')}`);
    }
  }

  const ambiguous = report.rows.filter((row) => row.status === 'ambiguous_exact_targets');
  console.log(`\n=== AMBIGUOUS DETERMINISTIC TARGETS (${ambiguous.length}) ===`);
  if (ambiguous.length === 0) console.log('  (none)');
  for (const row of ambiguous) {
    console.log(`\n${row.reviewerNames.join(' / ')}  contact=${row.contactId}`);
    console.log(`  affiliation: ${row.affiliationEvidence.map((item) => item.value).join(' | ')}`);
    for (const target of row.targets) console.log(`  possible:    ${renderTarget(target)}`);
  }

  if (showAll) {
    const unmatched = report.rows.filter((row) =>
      row.status === 'no_exact_target' || row.status === 'no_affiliation');
    console.log(`\n=== NO DETERMINISTIC TARGET (${unmatched.length}) ===`);
    for (const row of unmatched) {
      const affiliation = row.affiliationEvidence.map((item) => item.value).join(' | ') || '(none)';
      console.log(`${row.reviewerNames.join(' / ')}  contact=${row.contactId}  affiliation=${affiliation}`);
    }
  }

  console.log('\nNo Dataverse or Postgres writes were performed.');
}

const report = await withDalContext('probe-reviewer-contact-account-link-candidates', async () => {
  const [reviewerResult, suggestionResult, accountResult] = await Promise.all([
    potentialReviewerAdapter.queryAllReviewers({
      select: [
        'wmkf_potentialreviewersid', 'wmkf_name', 'wmkf_firstname', 'wmkf_lastname',
        'wmkf_maininstitution', 'wmkf_primaryaffiliation', 'wmkf_organizationname',
        '_wmkf_contact_value', 'statecode',
      ].join(','),
      filter: '_wmkf_contact_value ne null',
      orderby: 'wmkf_name asc',
    }),
    reviewerSuggestionAdapter.queryAllSuggestions({
      select: [
        'wmkf_appreviewersuggestionid', '_wmkf_potentialreviewer_value',
        'wmkf_revieweraffiliation', 'wmkf_responsereceivedat',
      ].join(','),
      filter: 'wmkf_accepted eq true and wmkf_declined ne true and _wmkf_potentialreviewer_value ne null and wmkf_revieweraffiliation ne null',
      orderby: 'wmkf_responsereceivedat desc',
    }),
    accountAdapter.queryAllAccounts({
      select: 'accountid,name,akoya_aka,wmkf_legalname,wmkf_dc_aka,statecode',
      filter: 'statecode eq 0',
      orderby: 'name asc',
    }),
  ]);

  for (const [label, result] of [
    ['reviewer', reviewerResult],
    ['suggestion', suggestionResult],
    ['account', accountResult],
  ]) {
    if (result.capped) throw new Error(`${label} scan hit the export cap; refusing to report a partial population`);
  }

  const linkedReviewers = reviewerResult.records || [];
  const reviewersByContact = groupBy(linkedReviewers, (row) => nonBlank(row._wmkf_contact_value).toLowerCase());
  const contactIds = [...reviewersByContact.keys()];
  const contacts = await mapWithConcurrency(contactIds, 8, async (contactId) => {
    const contact = await contactAdapter.getInstitutionById(contactId);
    if (!contact) throw new Error(`linked Contact was not found: ${contactId}`);
    return contact;
  });

  const suggestionsByReviewer = groupBy(
    suggestionResult.records,
    (row) => nonBlank(row._wmkf_potentialreviewer_value).toLowerCase(),
  );
  const accountIndex = buildAccountLabelIndex(accountResult.records);
  const rows = [];
  let contactsWithParent = 0;

  for (const contact of contacts) {
    const contactId = nonBlank(contact.contactid).toLowerCase();
    const reviewers = reviewersByContact.get(contactId) || [];
    if (contact._parentcustomerid_value) {
      contactsWithParent += 1;
      continue;
    }
    const suggestions = reviewers.flatMap((reviewer) =>
      suggestionsByReviewer.get(nonBlank(reviewer.wmkf_potentialreviewersid).toLowerCase()) || []);
    const affiliationEvidence = collectAffiliationEvidence({ reviewers, suggestions, contact });
    const classification = classifyContactAccountTargets(affiliationEvidence, accountIndex);
    rows.push({
      status: classification.status,
      contactId,
      contactFreeTextOrganization: nonBlank(contact.adx_organizationname) || null,
      potentialReviewerIds: reviewers.map((reviewer) => reviewer.wmkf_potentialreviewersid),
      reviewerNames: reviewers.map(reviewerDisplayName),
      affiliationEvidence,
      targets: classification.targets,
      matchedEvidence: classification.matchedEvidence,
      unmatchedEvidence: classification.unmatchedEvidence,
    });
  }

  rows.sort((a, b) =>
    a.reviewerNames.join(' ').localeCompare(b.reviewerNames.join(' '))
    || a.contactId.localeCompare(b.contactId));
  const count = (status) => rows.filter((row) => row.status === status).length;
  return {
    generatedAt: new Date().toISOString(),
    matchingRule: 'exact after Unicode/case/punctuation/whitespace normalization across Account name/AKA/legal-name/DC-AKA labels',
    summary: {
      linkedReviewerRows: linkedReviewers.length,
      uniqueLinkedContacts: contactIds.length,
      contactsWithParent,
      candidateContacts: rows.length,
      candidatesWithContactOrganization: rows.filter((row) => row.contactFreeTextOrganization).length,
      candidatesWithoutContactOrganization: rows.filter((row) => !row.contactFreeTextOrganization).length,
      uniqueExactTargets: count('unique_exact_target'),
      ambiguousExactTargets: count('ambiguous_exact_targets'),
      noExactTarget: count('no_exact_target'),
      noAffiliation: count('no_affiliation'),
      activeAccountsScanned: accountResult.records.length,
    },
    rows,
  };
});

let renderedOutput = null;
if (args.has('--json')) {
  renderedOutput = `${JSON.stringify(report, null, 2)}\n`;
} else if (args.has('--csv')) {
  renderedOutput = toCsv(report.rows);
}

if (outputPath) {
  const resolvedOutputPath = path.resolve(outputPath);
  fs.mkdirSync(path.dirname(resolvedOutputPath), { recursive: true });
  fs.writeFileSync(resolvedOutputPath, renderedOutput, 'utf8');
  console.log(`Report written to ${resolvedOutputPath}`);
} else if (renderedOutput !== null) {
  process.stdout.write(renderedOutput);
} else {
  printHuman(report);
}
