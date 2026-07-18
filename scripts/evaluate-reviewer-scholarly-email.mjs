#!/usr/bin/env node

/**
 * Read-only evaluator for the structured reviewer-email tier.
 *
 * Defaults to the frozen 40-person reviewer-email cohort. It calls only NCBI
 * PubMed and Europe PMC through the production resolver, performs no Dataverse
 * writes, and emits a versioned JSON artifact with per-candidate evidence.
 *
 * Usage:
 *   node scripts/evaluate-reviewer-scholarly-email.mjs
 *   node scripts/evaluate-reviewer-scholarly-email.mjs --limit 5
 *   node scripts/evaluate-reviewer-scholarly-email.mjs --input path.json --output path.json
 */

import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { findScholarlyEmail } = require('../lib/services/contact-enrichment/scholarly-email');

const DEFAULT_INPUT = 'outputs/reviewer-holistic-m1/reviewer-email-serp-first-40-v1.json';
const DEFAULT_OUTPUT = 'outputs/reviewer-holistic-m1/reviewer-email-scholarly-production-40-v1.json';

function option(name, fallback = null) {
  const index = process.argv.indexOf(name);
  return index >= 0 && process.argv[index + 1] ? process.argv[index + 1] : fallback;
}

function fingerprint(subjects) {
  return createHash('sha256')
    .update(JSON.stringify(subjects.map((subject) => ({
      subjectKey: subject.subjectKey,
      name: subject.name,
      affiliation: subject.affiliation,
    }))))
    .digest('hex');
}

async function mapWithConcurrency(items, concurrency, worker) {
  const results = new Array(items.length);
  let nextIndex = 0;
  async function run() {
    while (nextIndex < items.length) {
      const index = nextIndex++;
      results[index] = await worker(items[index], index);
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, run));
  return results;
}

const inputPath = path.resolve(option('--input', DEFAULT_INPUT));
const outputPath = path.resolve(option('--output', DEFAULT_OUTPUT));
const limitValue = Number(option('--limit', '0'));
const input = JSON.parse(await readFile(inputPath, 'utf8'));
const subjects = (Array.isArray(input.results) ? input.results : [])
  .filter((subject) => subject?.name && subject?.affiliation)
  .slice(0, Number.isFinite(limitValue) && limitValue > 0 ? limitValue : undefined);

const startedAt = new Date().toISOString();
const results = await mapWithConcurrency(subjects, 2, async (subject, index) => {
  const started = Date.now();
  try {
    const resolution = await findScholarlyEmail({
      name: subject.name,
      affiliation: subject.affiliation,
      orcidId: subject.orcidUrl || null,
      publications: [],
    });
    const action = resolution.status === 'found'
      ? (resolution.publicationCount >= 2 ? 'ready' : 'quick_check')
      : 'missing';
    process.stdout.write(`[${index + 1}/${subjects.length}] ${subject.name}: ${action}\n`);
    return {
      subjectKey: subject.subjectKey || null,
      name: subject.name,
      affiliation: subject.affiliation,
      action,
      email: resolution.email || null,
      publicationCount: resolution.publicationCount || 0,
      providers: resolution.providers || [],
      publications: resolution.publications || [],
      conflictCandidates: resolution.candidates || [],
      resolverStatus: resolution.status,
      providerErrors: resolution.providerErrors || [],
      latencyMs: Date.now() - started,
    };
  } catch (error) {
    process.stdout.write(`[${index + 1}/${subjects.length}] ${subject.name}: error\n`);
    return {
      subjectKey: subject.subjectKey || null,
      name: subject.name,
      affiliation: subject.affiliation,
      action: 'missing',
      email: null,
      publicationCount: 0,
      resolverStatus: 'error',
      providerErrors: [],
      error: error.message,
      latencyMs: Date.now() - started,
    };
  }
});

const summary = {
  subjects: results.length,
  ready: results.filter((result) => result.action === 'ready').length,
  quickCheck: results.filter((result) => result.action === 'quick_check').length,
  missing: results.filter((result) => result.action === 'missing').length,
  conflicts: results.filter((result) => result.resolverStatus === 'conflict').length,
  errors: results.filter((result) => result.resolverStatus === 'error').length,
  providerErrors: results.reduce((sum, result) => sum + (result.providerErrors?.length || 0), 0),
};

const artifact = {
  schemaVersion: 1,
  artifactVersion: 'reviewer-email-scholarly-production-40-v1',
  createdAt: new Date().toISOString(),
  startedAt,
  sourceArtifact: inputPath,
  sourceCohortFingerprint: input.baselineCohortFingerprint || input.subjectFingerprint || null,
  evaluatedSubjectFingerprint: fingerprint(subjects),
  contract: {
    persistence: false,
    providers: ['NCBI PubMed', 'Europe PMC'],
    samePublicationAcrossProvidersCountsOnce: true,
    readyRule: 'same address on at least two distinct recent works',
    quickCheckRule: 'same address on exactly one recent work',
    identityRule: 'full-forename surname match or exact ORCID plus candidate-affiliation corroboration',
    deliverabilityChecked: false,
  },
  summary,
  results,
};

await writeFile(outputPath, `${JSON.stringify(artifact, null, 2)}\n`, 'utf8');
process.stdout.write(`${JSON.stringify(summary)}\n`);
process.stdout.write(`Wrote ${outputPath}\n`);
