'use strict';

const fs = require('fs');
const crypto = require('crypto');
const path = require('path');
const {
  assertValid,
  validateCase,
  validateCassette,
  validateManifest,
  validateResult,
} = require('./schema');
const { assertPublicationSafe } = require('./validate-publication-boundary');

const ROOT = __dirname;

function jsonFiles(directory) {
  if (!fs.existsSync(directory)) return [];
  return fs.readdirSync(directory, { withFileTypes: true })
    .flatMap((entry) => {
      const absolute = path.join(directory, entry.name);
      if (entry.isDirectory()) return jsonFiles(absolute);
      return entry.isFile() && entry.name.endsWith('.json') ? [absolute] : [];
    })
    .sort();
}

function parseJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function validateCaseFile(file, { seenIds, groupAssignments }) {
  const cases = parseJson(file);
  if (!Array.isArray(cases)) throw new Error(`${file}: public case files must contain an array`);
  for (const value of cases) {
    assertValid(value, validateCase, `${file}:${value?.id || 'unknown case'}`);
    assertPublicationSafe(value, { artifactType: 'case' });
    if (seenIds.has(value.id)) throw new Error(`${file}: duplicate case id ${value.id}`);
    seenIds.add(value.id);
    const assignment = JSON.stringify(value.first_split_assignment);
    if (groupAssignments.has(value.group) && groupAssignments.get(value.group) !== assignment) {
      throw new Error(`${file}: group ${value.group} changed its first split assignment`);
    }
    groupAssignments.set(value.group, assignment);
  }
  return cases.length;
}

function validateSingleFile(file, validator, artifactType) {
  const value = parseJson(file);
  assertValid(value, validator, file);
  assertPublicationSafe(value, { artifactType });
  return 1;
}

function validateManifestFile(file, root) {
  const manifest = parseJson(file);
  assertValid(manifest, validateManifest, file);
  assertPublicationSafe(manifest, { artifactType: 'manifest' });
  for (const artifact of manifest.artifacts) {
    const absolute = path.resolve(root, artifact.path);
    if (!absolute.startsWith(`${path.resolve(root)}${path.sep}`)) {
      throw new Error(`${file}: artifact path escapes the public harness root`);
    }
    const bytes = fs.readFileSync(absolute);
    const digest = crypto.createHash('sha256').update(bytes).digest('hex');
    if (digest !== artifact.sha256) throw new Error(`${file}: hash mismatch for ${artifact.path}`);
    const parsed = JSON.parse(bytes.toString('utf8'));
    const records = Array.isArray(parsed) ? parsed.length : 1;
    if (records !== artifact.records) throw new Error(`${file}: record-count mismatch for ${artifact.path}`);
  }
  return 1;
}

function validatePublicAssets({ root = ROOT } = {}) {
  const counts = { cases: 0, cassettes: 0, manifests: 0, results: 0 };
  const caseState = { seenIds: new Set(), groupAssignments: new Map() };
  for (const file of jsonFiles(path.join(root, 'public-cases'))) {
    counts.cases += validateCaseFile(file, caseState);
  }
  for (const file of jsonFiles(path.join(root, 'public-cassettes'))) {
    counts.cassettes += validateSingleFile(file, validateCassette, 'cassette');
  }
  for (const file of jsonFiles(path.join(root, 'manifests'))) {
    counts.manifests += validateManifestFile(file, root);
  }
  for (const file of jsonFiles(path.join(root, 'results'))) {
    counts.results += validateSingleFile(file, validateResult, 'result');
  }
  return counts;
}

if (require.main === module) {
  const counts = validatePublicAssets();
  process.stdout.write(`Validated ${counts.cases} cases, ${counts.cassettes} cassettes, ${counts.manifests} manifests, and ${counts.results} results.\n`);
}

module.exports = {
  jsonFiles,
  validatePublicAssets,
};
