#!/usr/bin/env node

/**
 * Freeze the Stage 3 reviewer-email validation cohort.
 *
 * Read-only inputs:
 * - the M1 reviewer-generation execution artifact;
 * - the prior 40-case email artifact (exclusion set);
 * - WMKF Dataverse reviewer/contact identity lookup; and
 * - OpenAlex institution search for country stratification.
 *
 * The only write is the local JSON artifact. Candidates are hash-ordered before
 * any lookup, then accepted only when no active name-consistent WMKF record has
 * an email. The resulting cohort is exactly 10 US and 10 non-US subjects.
 */

import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import './lib/use-extensionless.mjs';

const require = createRequire(import.meta.url);
const { normalizeReviewerName } = require('../lib/utils/reviewer-name-match');

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DEFAULT_EXECUTION = 'outputs/reviewer-holistic-m1/execution-v1.json';
const DEFAULT_EXCLUSIONS = 'outputs/reviewer-holistic-m1/reviewer-email-serp-first-40-v1.json';
const DEFAULT_OUTPUT = 'outputs/reviewer-holistic-m1/reviewer-email-page-first-stage3-cohort-v1.json';
const SELECTION_SEED = 'reviewer-email-page-first-stage3-v1';
const INVALID_AFFILIATION = /excluded|omitted|unable to|not applicable|not confidently|statistical\/population/i;

function option(name, fallback) {
  const index = process.argv.indexOf(name);
  return index >= 0 && process.argv[index + 1] ? process.argv[index + 1] : fallback;
}

function hasFlag(name) {
  return process.argv.includes(name);
}

function sha256(value) {
  return createHash('sha256').update(String(value)).digest('hex');
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

async function atomicWriteJson(outputPath, value) {
  await mkdir(path.dirname(outputPath), { recursive: true });
  const temporary = `${outputPath}.tmp-${process.pid}`;
  await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
  await rename(temporary, outputPath);
}

function mostFrequent(values) {
  const counts = new Map();
  for (const value of values.filter(Boolean)) {
    counts.set(value, (counts.get(value) || 0) + 1);
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0]?.[0] || null;
}

function buildCandidatePool(execution, excludedNames) {
  const byName = new Map();
  for (const run of execution.runs || []) {
    for (const suggestion of run.result?.reviewerSuggestions || []) {
      const normalizedName = normalizeReviewerName(suggestion.name);
      const affiliation = String(suggestion.suggestedInstitution || '').trim();
      if (!normalizedName || !affiliation || INVALID_AFFILIATION.test(affiliation)) continue;
      if (excludedNames.has(normalizedName)) continue;
      const existing = byName.get(normalizedName) || {
        normalizedName,
        names: [],
        affiliations: [],
        expertiseAreas: new Set(),
      };
      existing.names.push(suggestion.name);
      existing.affiliations.push(affiliation);
      for (const expertise of suggestion.expertiseAreas || []) {
        if (String(expertise).trim()) existing.expertiseAreas.add(String(expertise).trim());
      }
      byName.set(normalizedName, existing);
    }
  }
  return [...byName.values()].map((row) => {
    const name = mostFrequent(row.names);
    const affiliation = mostFrequent(row.affiliations);
    const subjectKey = sha256(`${row.normalizedName}::${affiliation.toLowerCase()}`).slice(0, 16);
    return {
      subjectKey,
      subjectViewKey: subjectKey,
      personKey: subjectKey,
      normalizedName: row.normalizedName,
      name,
      affiliation,
      expertiseAreas: [...row.expertiseAreas].sort(),
      selectionOrder: sha256(`${SELECTION_SEED}|${row.normalizedName}|${affiliation}`),
    };
  }).sort((a, b) => a.selectionOrder.localeCompare(b.selectionOrder));
}

function meaningfulTokens(value) {
  const generic = new Set([
    'and', 'the', 'of', 'for', 'at', 'university', 'institute', 'institution',
    'college', 'school', 'medical', 'medicine', 'research', 'center', 'centre',
    'laboratory', 'department', 'national',
  ]);
  return String(value || '')
    .normalize('NFD')
    .replace(/\p{Mn}/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .split(/\s+/)
    .filter((token) => token.length >= 3 && !generic.has(token));
}

function institutionMatchStrength(query, displayName) {
  const queryTokens = meaningfulTokens(query);
  const displayTokens = new Set(meaningfulTokens(displayName));
  const overlap = queryTokens.filter((token) => displayTokens.has(token));
  const queryNorm = queryTokens.join(' ');
  const displayNorm = [...displayTokens].join(' ');
  const acronym = String(query || '').trim().replace(/[^A-Z]/g, '');
  const displayAcronym = String(displayName || '')
    .split(/\s+/)
    .filter((token) => /^[A-Z]/.test(token))
    .map((token) => token[0])
    .join('');
  if (queryNorm && displayNorm && (queryNorm.includes(displayNorm) || displayNorm.includes(queryNorm))) {
    return 3;
  }
  if (overlap.length >= Math.min(2, queryTokens.length) && overlap.some((token) => token.length >= 4)) {
    return 2;
  }
  if (acronym.length >= 3 && acronym === displayAcronym) return 2;
  return 0;
}

async function classifyInstitution(affiliation) {
  const url = new URL('https://api.openalex.org/institutions');
  url.searchParams.set('search', affiliation.split(/[;/]/)[0].trim());
  url.searchParams.set('per-page', '5');
  if (process.env.OPENALEX_API_KEY) url.searchParams.set('api_key', process.env.OPENALEX_API_KEY);
  const response = await fetch(url, { signal: AbortSignal.timeout(15_000) });
  if (!response.ok) throw new Error(`OpenAlex institution search failed (${response.status})`);
  const payload = await response.json();
  const candidates = (payload.results || [])
    .map((record) => ({
      openAlexId: record.id || null,
      displayName: record.display_name || null,
      countryCode: record.country_code || null,
      homepageUrl: record.homepage_url || null,
      matchStrength: institutionMatchStrength(affiliation, record.display_name),
    }))
    .filter((record) => record.countryCode && record.matchStrength >= 2)
    .sort((a, b) => b.matchStrength - a.matchStrength);
  const best = candidates[0] || null;
  if (!best) return { status: 'unresolved', affiliation };
  return {
    status: 'resolved',
    geography: best.countryCode === 'US' ? 'US' : 'non-US',
    affiliation,
    ...best,
  };
}

async function mapWithConcurrency(items, concurrency, worker) {
  const results = new Array(items.length);
  let next = 0;
  async function run() {
    while (next < items.length) {
      const index = next++;
      try {
        results[index] = await worker(items[index], index);
      } catch (error) {
        results[index] = { error: String(error.message || error).slice(0, 500) };
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, run));
  return results;
}

async function main() {
  const execute = hasFlag('--execute');
  const executionPath = path.resolve(ROOT, option('--execution', DEFAULT_EXECUTION));
  const exclusionsPath = path.resolve(ROOT, option('--exclusions', DEFAULT_EXCLUSIONS));
  const outputPath = path.resolve(ROOT, option('--output', DEFAULT_OUTPUT));
  await loadEnv();

  const executionText = await readFile(executionPath, 'utf8');
  const exclusionsText = await readFile(exclusionsPath, 'utf8');
  const execution = JSON.parse(executionText);
  const exclusions = JSON.parse(exclusionsText);
  if (execution.status !== 'complete') throw new Error('Execution source artifact is not complete');
  if (!Array.isArray(exclusions.results) || exclusions.results.length !== 40) {
    throw new Error('Expected the exact 40-case exclusion artifact');
  }
  const excludedNames = new Set(exclusions.results.map((row) =>
    normalizeReviewerName(row.name || row.normalizedName)
  ));
  excludedNames.add(normalizeReviewerName('David Liu'));
  excludedNames.add(normalizeReviewerName('Feng Zhang'));
  const pool = buildCandidatePool(execution, excludedNames);

  if (!execute) {
    process.stdout.write(`${JSON.stringify({
      dryRun: true,
      persistence: false,
      externalWrites: false,
      sourceCandidates: pool.length,
      target: { US: 10, 'non-US': 10 },
      excludedPriorCases: excludedNames.size,
      output: path.relative(ROOT, outputPath),
    }, null, 2)}\n`);
    return;
  }

  const { lookupReviewerIdentity } = await import('../lib/services/reviewer-identity-lookup.js');
  const { withDalContext } = await import('../lib/dataverse/core/context.js');
  const selected = { US: [], 'non-US': [] };
  const screened = [];
  const batchSize = 30;

  await withDalContext('reviewer-page-first-stage3-cohort-readonly', async () => {
    for (let start = 0; start < pool.length; start += batchSize) {
      if (selected.US.length >= 10 && selected['non-US'].length >= 10) break;
      const batch = pool.slice(start, start + batchSize);
      const countries = await mapWithConcurrency(batch, 3, (subject) =>
        classifyInstitution(subject.affiliation)
      );
      for (let i = 0; i < batch.length; i++) {
        if (selected.US.length >= 10 && selected['non-US'].length >= 10) break;
        const subject = batch[i];
        const country = countries[i];
        if (country.error || country.status !== 'resolved') {
          screened.push({
            subjectKey: subject.subjectKey,
            name: subject.name,
            affiliation: subject.affiliation,
            eligible: false,
            reason: country.error ? 'country_lookup_error' : 'country_unresolved',
            countryEvidence: country,
          });
          continue;
        }
        if (selected[country.geography].length >= 10) continue;

        let lookup;
        try {
          lookup = await lookupReviewerIdentity({ name: subject.name });
        } catch (error) {
          screened.push({
            subjectKey: subject.subjectKey,
            name: subject.name,
            affiliation: subject.affiliation,
            eligible: false,
            reason: 'internal_lookup_error',
            error: String(error.message || error).slice(0, 500),
            countryEvidence: country,
          });
          continue;
        }
        const candidates = lookup.outcome === 'candidates' ? lookup.candidates : [];
        const active = candidates.filter((candidate) => candidate.context?.active !== false);
        const internalEmails = [...new Set(active
          .map((candidate) => candidate.context?.email?.trim().toLowerCase())
          .filter(Boolean))];
        const eligible = internalEmails.length === 0;
        const screenedRow = {
          subjectKey: subject.subjectKey,
          name: subject.name,
          affiliation: subject.affiliation,
          eligible,
          reason: eligible ? 'new_to_wmkf_no_active_internal_email' : 'active_internal_email_exists',
          internalMatchCount: active.length,
          internalEmailCount: internalEmails.length,
          countryEvidence: country,
        };
        screened.push(screenedRow);
        if (eligible) {
          selected[country.geography].push({
            ...subject,
            geography: country.geography,
            countryCode: country.countryCode,
            countryEvidence: country,
            newToWmkfEvidence: {
              checkedAt: new Date().toISOString(),
              activeNameConsistentMatchCount: active.length,
              activeInternalEmailCount: 0,
            },
            inputFootprint: {
              fields: ['name', 'affiliation', 'expertiseAreas'],
              email: false,
              orcid: false,
              website: false,
              publications: false,
              references: false,
            },
          });
        }
      }
    }
  });

  if (selected.US.length !== 10 || selected['non-US'].length !== 10) {
    throw new Error(`Unable to freeze 10+10 cohort: US=${selected.US.length}, non-US=${selected['non-US'].length}`);
  }
  const subjects = [...selected.US, ...selected['non-US']];
  const artifact = {
    schemaVersion: 1,
    artifactVersion: 'reviewer-email-page-first-stage3-cohort-v1',
    status: 'frozen',
    createdAt: new Date().toISOString(),
    contract: {
      persistence: false,
      localWritesOnly: true,
      selectionSeed: SELECTION_SEED,
      newToWmkf: 'no email on an active name-consistent WMKF reviewer/contact record',
      thinFootprint: 'source input contains name, affiliation, and expertise only',
      geography: { US: 10, 'non-US': 10 },
      excluded: 'all people in the frozen 40-case artifact plus David Liu and Feng Zhang controls',
    },
    sourceArtifacts: {
      execution: path.relative(ROOT, executionPath),
      exclusions: path.relative(ROOT, exclusionsPath),
    },
    sourceFingerprint: sha256(`${sha256(executionText)}|${sha256(exclusionsText)}`),
    cohortFingerprint: sha256(JSON.stringify(subjects.map((subject) => ({
      subjectKey: subject.subjectKey,
      name: subject.name,
      affiliation: subject.affiliation,
      geography: subject.geography,
    })))),
    counts: {
      subjects: subjects.length,
      US: selected.US.length,
      nonUS: selected['non-US'].length,
      screened: screened.length,
      sourcePool: pool.length,
    },
    subjects,
    screened,
  };
  await atomicWriteJson(outputPath, artifact);
  process.stdout.write(`${JSON.stringify({
    status: artifact.status,
    counts: artifact.counts,
    cohortFingerprint: artifact.cohortFingerprint,
    output: outputPath,
  }, null, 2)}\n`);
}

await main();
