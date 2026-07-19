#!/usr/bin/env node

/**
 * Read-only SerpAPI experiment: does adding `lab` improve reviewer discovery?
 *
 * The evaluator uses the frozen 40-person reviewer-email cohort and compares
 * the production query with an otherwise-identical query containing `lab`.
 * It tests both live contact discovery and the retired Google-Scholar-profile
 * lookup so their effects remain separate.
 *
 * No resolver behavior or external records are changed. The only write is the
 * requested JSON artifact.
 *
 * Usage:
 *   node scripts/evaluate-serp-lab-query-variants.mjs --dry-run --limit 2
 *   node scripts/evaluate-serp-lab-query-variants.mjs --limit 10
 *   node scripts/evaluate-serp-lab-query-variants.mjs --mode contact --limit 40
 *   node scripts/evaluate-serp-lab-query-variants.mjs --mode both --output path.json
 */

import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { readFile, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const { ContactParser } = require('../lib/utils/contact-parser');
const { SerpContactService } = require('../lib/services/serp-contact-service');

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DEFAULT_INPUT = 'outputs/reviewer-holistic-m1/reviewer-email-serp-first-40-v1.json';
const DEFAULT_REFERENCE = 'outputs/reviewer-holistic-m1/reviewer-email-scholarly-production-40-v1.json';
const DEFAULT_OUTPUT = 'outputs/reviewer-holistic-m1/reviewer-email-serp-lab-query-variants-v1.json';
const SERP_CALL_COST_USD = 0.005;

function option(name, fallback = null) {
  const index = process.argv.indexOf(name);
  return index >= 0 && process.argv[index + 1] ? process.argv[index + 1] : fallback;
}

function hasFlag(name) {
  return process.argv.includes(name);
}

function positiveInteger(name, fallback) {
  const raw = option(name, String(fallback));
  const value = Number(raw);
  if (!Number.isInteger(value) || value < 0) {
    throw new Error(`${name} must be a non-negative integer`);
  }
  return value;
}

async function loadEnv() {
  for (const filename of ['.env', '.env.local']) {
    const envPath = path.join(ROOT, filename);
    if (!existsSync(envPath)) continue;
    const body = await readFile(envPath, 'utf8');
    for (const rawLine of body.split('\n')) {
      const line = rawLine.trim();
      if (!line || line.startsWith('#')) continue;
      const equals = line.indexOf('=');
      if (equals < 1) continue;
      const key = line.slice(0, equals).trim();
      let value = line.slice(equals + 1).trim();
      if ((value.startsWith('"') && value.endsWith('"'))
        || (value.startsWith("'") && value.endsWith("'"))) {
        value = value.slice(1, -1);
      }
      if (!process.env[key]) process.env[key] = value;
    }
  }
}

function fingerprint(subjects) {
  return createHash('sha256')
    .update(JSON.stringify(subjects.map(({ subjectKey, name, affiliation }) => ({
      subjectKey,
      name,
      affiliation,
    }))))
    .digest('hex');
}

function buildQueries(subject) {
  const cleanName = ContactParser.stripHonorifics(subject.name);
  const contactInstitution = subject.affiliation
    ? subject.affiliation.split(',')[0].trim()
    : '';
  const scholarInstitution = SerpContactService.extractInstitution(subject.affiliation);

  return {
    contact: {
      current: contactInstitution
        ? `"${cleanName}" ${contactInstitution} email`
        : `"${cleanName}" email`,
      lab: contactInstitution
        ? `"${cleanName}" lab ${contactInstitution} email`
        : `"${cleanName}" lab email`,
    },
    scholar: {
      current: scholarInstitution
        ? `"${cleanName}" ${scholarInstitution} site:scholar.google.com`
        : `"${cleanName}" site:scholar.google.com`,
      lab: scholarInstitution
        ? `"${cleanName}" lab ${scholarInstitution} site:scholar.google.com`
        : `"${cleanName}" lab site:scholar.google.com`,
    },
  };
}

function normalizeEmail(email) {
  return typeof email === 'string' ? email.trim().toLowerCase() : null;
}

function emailDomain(email) {
  return normalizeEmail(email)?.split('@')[1] || null;
}

function referenceIndex(referenceArtifact) {
  const bySubject = new Map();
  for (const row of referenceArtifact?.results || []) {
    const email = normalizeEmail(row.email);
    if (!row.subjectKey || !email) continue;
    bySubject.set(row.subjectKey, [{
      email,
      level: row.action === 'ready' ? 'ready' : 'quick_check',
      source: 'structured_scholarly',
      publicationCount: row.publicationCount || 0,
    }]);
  }
  return bySubject;
}

function extractContactOutcome(subject, organicResults, references) {
  const referenceEmails = new Set(references.map((item) => item.email));
  const readyReferenceEmails = new Set(
    references.filter((item) => item.level === 'ready').map((item) => item.email)
  );
  const referenceDomains = new Set(references.map((item) => emailDomain(item.email)).filter(Boolean));
  const emails = [];
  const facultyPages = [];
  const labPages = [];
  const usefulWebsites = [];
  const seenEmails = new Set();

  for (const item of organicResults) {
    const position = item.position || null;
    const link = typeof item.link === 'string' ? item.link : null;
    const title = typeof item.title === 'string' ? item.title : null;
    const snippet = typeof item.snippet === 'string' ? item.snippet : null;
    const email = normalizeEmail(SerpContactService.extractEmailFromText(snippet));

    if (email && !seenEmails.has(email)) {
      seenEmails.add(email);
      emails.push({
        email,
        position,
        title,
        link,
        nameConsistent: ContactParser.isNameConsistentEmail(email, subject.name),
        exactReference: referenceEmails.has(email),
        exactReadyReference: readyReferenceEmails.has(email),
        referenceDomain: referenceDomains.has(emailDomain(email)),
      });
    }

    if (link && SerpContactService.isFacultyPageUrl(link, subject.name)) {
      facultyPages.push({ position, title, link });
    }

    if (link
      && /\b(lab|laborator(?:y|ies))\b/i.test(`${title || ''} ${link} ${snippet || ''}`)
      && ContactParser.isUsefulWebsiteUrl(link, subject.name)) {
      labPages.push({ position, title, link });
    }

    if (link && ContactParser.isUsefulWebsiteUrl(link, subject.name)) {
      usefulWebsites.push({ position, title, link });
    }
  }

  const firstEmail = emails[0] || null;
  return {
    organicResultCount: organicResults.length,
    email: firstEmail?.email || null,
    emailHit: Boolean(firstEmail),
    nameConsistentEmailHit: Boolean(firstEmail?.nameConsistent),
    exactReferenceEmailHit: emails.some((item) => item.exactReference),
    exactReadyReferenceEmailHit: emails.some((item) => item.exactReadyReference),
    referenceDomainHit: emails.some((item) => item.referenceDomain),
    facultyPageHit: facultyPages.length > 0,
    labPageHit: labPages.length > 0,
    usefulWebsiteHit: usefulWebsites.length > 0,
    actionableLeadHit: Boolean(firstEmail) || facultyPages.length > 0 || labPages.length > 0,
    emails,
    facultyPages: facultyPages.slice(0, 3),
    labPages: labPages.slice(0, 3),
    usefulWebsites: usefulWebsites.slice(0, 3),
  };
}

function extractScholarOutcome(subject, organicResults) {
  const profiles = [];
  for (const item of organicResults) {
    if (!item.link?.includes('scholar.google.com/citations')) continue;
    const userMatch = item.link.match(/[?&]user=([^&]+)/);
    const nameMismatch = SerpContactService.scholarNameMismatch(subject.name, item.title);
    const institutionMismatch = SerpContactService.institutionConflicts(
      subject.affiliation,
      item.snippet
    );
    profiles.push({
      position: item.position || null,
      link: item.link,
      scholarId: userMatch ? userMatch[1] : null,
      title: item.title || null,
      snippet: item.snippet || null,
      displayName: SerpContactService.extractScholarDisplayName(item.title),
      nameMismatch,
      institutionMismatch,
      usable: !nameMismatch && !institutionMismatch,
    });
  }

  return {
    organicResultCount: organicResults.length,
    scholarProfileHit: profiles.length > 0,
    usableScholarProfileHit: profiles.some((profile) => profile.usable),
    nameMismatchOnly: profiles.length > 0
      && profiles.every((profile) => profile.nameMismatch),
    institutionMismatchOnly: profiles.length > 0
      && profiles.every((profile) => profile.institutionMismatch),
    profiles: profiles.slice(0, 3),
  };
}

async function fetchSerp(query, num, apiKey) {
  const started = Date.now();
  const params = new URLSearchParams({
    engine: 'google',
    q: query,
    num: String(num),
    api_key: apiKey,
  });
  const response = await fetch(`${SerpContactService.baseUrl}?${params}`);
  if (!response.ok) {
    const detail = (await response.text()).slice(0, 300);
    throw new Error(`SerpAPI ${response.status}: ${detail}`);
  }
  const data = await response.json();
  return {
    organicResults: data.organic_results || [],
    latencyMs: Date.now() - started,
    searchMetadataStatus: data.search_metadata?.status || null,
  };
}

async function mapWithConcurrency(items, concurrency, worker) {
  const results = new Array(items.length);
  let next = 0;
  async function run() {
    while (next < items.length) {
      const index = next++;
      results[index] = await worker(items[index], index);
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, run));
  return results;
}

function count(rows, pathParts) {
  return rows.filter((row) => {
    let value = row;
    for (const part of pathParts) value = value?.[part];
    return value === true;
  }).length;
}

function variantSummary(rows, mode, variant) {
  const base = {
    completed: rows.filter((row) => !row[mode]?.[variant]?.error).length,
    errors: rows.filter((row) => row[mode]?.[variant]?.error).length,
  };
  if (mode === 'contact') {
    return {
      ...base,
      emailHits: count(rows, [mode, variant, 'emailHit']),
      nameConsistentEmailHits: count(rows, [mode, variant, 'nameConsistentEmailHit']),
      exactReferenceEmailHits: count(rows, [mode, variant, 'exactReferenceEmailHit']),
      exactReadyReferenceEmailHits: count(rows, [mode, variant, 'exactReadyReferenceEmailHit']),
      referenceDomainHits: count(rows, [mode, variant, 'referenceDomainHit']),
      facultyPageHits: count(rows, [mode, variant, 'facultyPageHit']),
      labPageHits: count(rows, [mode, variant, 'labPageHit']),
      actionableLeadHits: count(rows, [mode, variant, 'actionableLeadHit']),
    };
  }
  return {
    ...base,
    scholarProfileHits: count(rows, [mode, variant, 'scholarProfileHit']),
    usableScholarProfileHits: count(rows, [mode, variant, 'usableScholarProfileHit']),
  };
}

function pairedDelta(rows, mode, metric) {
  const addedSubjects = [];
  const lostSubjects = [];
  for (const row of rows) {
    const current = row[mode]?.current?.[metric] === true;
    const lab = row[mode]?.lab?.[metric] === true;
    if (!current && lab) addedSubjects.push(row.name);
    if (current && !lab) lostSubjects.push(row.name);
  }
  return {
    added: addedSubjects.length,
    lost: lostSubjects.length,
    net: addedSubjects.length - lostSubjects.length,
    addedSubjects,
    lostSubjects,
  };
}

function modeSummary(rows, mode) {
  const metric = mode === 'contact' ? 'actionableLeadHit' : 'usableScholarProfileHit';
  const summary = {
    current: variantSummary(rows, mode, 'current'),
    lab: variantSummary(rows, mode, 'lab'),
    pairedPrimaryDelta: pairedDelta(rows, mode, metric),
  };
  if (mode === 'contact') {
    summary.pairedEmailDelta = pairedDelta(rows, mode, 'emailHit');
    summary.pairedNameConsistentEmailDelta = pairedDelta(
      rows,
      mode,
      'nameConsistentEmailHit'
    );
    summary.pairedExactReferenceEmailDelta = pairedDelta(
      rows,
      mode,
      'exactReferenceEmailHit'
    );
  } else {
    summary.pairedRawScholarProfileDelta = pairedDelta(
      rows,
      mode,
      'scholarProfileHit'
    );
  }
  return summary;
}

await loadEnv();

const mode = option('--mode', 'both');
if (!['contact', 'scholar', 'both'].includes(mode)) {
  throw new Error('--mode must be contact, scholar, or both');
}
const limit = positiveInteger('--limit', 40);
const offset = positiveInteger('--offset', 0);
const concurrency = positiveInteger('--concurrency', 2);
if (concurrency < 1) throw new Error('--concurrency must be at least 1');

const inputPath = path.resolve(ROOT, option('--input', DEFAULT_INPUT));
const referencePath = path.resolve(ROOT, option('--reference', DEFAULT_REFERENCE));
const outputPath = path.resolve(ROOT, option('--output', DEFAULT_OUTPUT));
const input = JSON.parse(await readFile(inputPath, 'utf8'));
const referenceArtifact = existsSync(referencePath)
  ? JSON.parse(await readFile(referencePath, 'utf8'))
  : { results: [] };
const referencesBySubject = referenceIndex(referenceArtifact);
const subjects = (input.results || [])
  .filter((subject) => subject?.subjectKey && subject?.name && subject?.affiliation)
  .slice(offset, limit > 0 ? offset + limit : undefined);
const selectedModes = mode === 'both' ? ['contact', 'scholar'] : [mode];
const dryRun = hasFlag('--dry-run');

if (dryRun) {
  const preview = subjects.map((subject) => ({
    subjectKey: subject.subjectKey,
    name: subject.name,
    affiliation: subject.affiliation,
    queries: buildQueries(subject),
  }));
  process.stdout.write(`${JSON.stringify({
    dryRun: true,
    subjects: preview,
    plannedCalls: subjects.length * selectedModes.length * 2,
    estimatedCostUsd: Number(
      (subjects.length * selectedModes.length * 2 * SERP_CALL_COST_USD).toFixed(3)
    ),
  }, null, 2)}\n`);
  process.exit(0);
}

const apiKey = process.env.SERP_API_KEY;
if (!apiKey) throw new Error('SERP_API_KEY is required (checked .env and .env.local)');

let callsAttempted = 0;
const startedAt = new Date().toISOString();
const results = await mapWithConcurrency(subjects, concurrency, async (subject, index) => {
  const row = {
    subjectKey: subject.subjectKey,
    name: subject.name,
    affiliation: subject.affiliation,
    references: referencesBySubject.get(subject.subjectKey) || [],
    queries: buildQueries(subject),
  };

  for (const selectedMode of selectedModes) {
    row[selectedMode] = {};
    for (const variant of ['current', 'lab']) {
      const query = row.queries[selectedMode][variant];
      callsAttempted += 1;
      try {
        const fetched = await fetchSerp(
          query,
          selectedMode === 'contact' ? 10 : 5,
          apiKey
        );
        row[selectedMode][variant] = {
          query,
          latencyMs: fetched.latencyMs,
          searchMetadataStatus: fetched.searchMetadataStatus,
          ...(selectedMode === 'contact'
            ? extractContactOutcome(subject, fetched.organicResults, row.references)
            : extractScholarOutcome(subject, fetched.organicResults)),
        };
      } catch (error) {
        row[selectedMode][variant] = { query, error: error.message };
      }
    }
  }

  process.stdout.write(`[${index + 1}/${subjects.length}] ${subject.name}\n`);
  return row;
});

const summary = {
  subjects: results.length,
  callsAttempted,
  estimatedCostUsd: Number((callsAttempted * SERP_CALL_COST_USD).toFixed(3)),
};
for (const selectedMode of selectedModes) {
  summary[selectedMode] = modeSummary(results, selectedMode);
}

const artifact = {
  schemaVersion: 1,
  artifactVersion: 'reviewer-email-serp-lab-query-variants-v1',
  createdAt: new Date().toISOString(),
  startedAt,
  sourceArtifact: path.relative(ROOT, inputPath),
  referenceArtifact: path.relative(ROOT, referencePath),
  sourceCohortFingerprint: input.baselineCohortFingerprint
    || input.subjectFingerprint
    || null,
  evaluatedSubjectFingerprint: fingerprint(subjects),
  contract: {
    persistence: false,
    engine: 'google',
    modes: selectedModes,
    currentContactQuery: '"Name" Institution email',
    labContactQuery: '"Name" lab Institution email',
    currentScholarQuery: '"Name" Institution site:scholar.google.com',
    labScholarQuery: '"Name" lab Institution site:scholar.google.com',
    contactResultCount: 10,
    scholarResultCount: 5,
    geoParameters: 'none (matches current production calls)',
    referenceUse: 'Structured scholarly addresses are comparison anchors, not exhaustive truth',
    manualAdjudicationRequired: true,
    estimatedPerCallCostUsd: SERP_CALL_COST_USD,
  },
  summary,
  results,
};

await writeFile(outputPath, `${JSON.stringify(artifact, null, 2)}\n`, 'utf8');
process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
process.stdout.write(`Wrote ${outputPath}\n`);
