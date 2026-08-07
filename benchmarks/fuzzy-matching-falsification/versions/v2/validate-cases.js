#!/usr/bin/env node
'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const manifest = require('./manifest.json');
const registry = require('./canonical-entities.json');
const { loadCases, loadLabels } = require('./run');
const { relationshipBetween } = require('./relationship');

const BASE_DIR = path.resolve(__dirname, manifest.base_suite);

function sha256(filePath) {
  return crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
}

function main() {
  const problems = [];
  for (const [relativePath, expectedHash] of Object.entries(manifest.base_files_sha256)) {
    const actualHash = sha256(path.join(BASE_DIR, relativePath));
    if (actualHash !== expectedHash) {
      problems.push(`frozen base changed: ${relativePath} expected ${expectedHash}, got ${actualHash}`);
    }
  }

  const cases = loadCases();
  const labels = loadLabels();
  const institutionCases = cases.filter((c) => c.decision === 'institution');
  if (labels.size !== institutionCases.length) {
    problems.push(`expected ${institutionCases.length} institution labels, found ${labels.size}`);
  }
  for (const c of institutionCases) {
    if (!labels.has(c.id)) problems.push(`missing canonical label for ${c.id}`);
  }
  for (const id of labels.keys()) {
    if (!institutionCases.some((c) => c.id === id)) problems.push(`orphan canonical label ${id}`);
  }

  if (registry.source.release !== manifest.ror_source.release
    || registry.source.sha256 !== manifest.ror_source.sha256) {
    problems.push('canonical entity registry source does not match manifest');
  }
  const byId = new Map(registry.organizations.map((organization) => [organization.id, organization]));
  for (const label of labels.values()) {
    for (const key of ['expected_ror_ids', 'must_not_ror_ids']) {
      for (const id of label[key] ?? []) {
        if (!byId.has(id)) problems.push(`${label.id}: ${key} references missing ${id}`);
      }
    }
    if (label.kind !== 'pair-consistency') continue;
    const listed = byId.get(label.listed_ror_id);
    const source = byId.get(label.evidence_source_ror_id);
    const canonical = byId.get(label.evidence_canonical_ror_id);
    if (!listed) problems.push(`${label.id}: missing listed record ${label.listed_ror_id}`);
    if (!source) problems.push(`${label.id}: missing evidence source record ${label.evidence_source_ror_id}`);
    if (!canonical) problems.push(`${label.id}: missing evidence canonical record ${label.evidence_canonical_ror_id}`);
    if (!listed || !source || !canonical) continue;
    const relation = relationshipBetween(
      { ror_id: listed.id, relationships: listed.relationships },
      { ror_id: source.id, relationships: source.relationships },
    );
    if (relation !== label.expected_relationship) {
      problems.push(`${label.id}: pinned relation expected ${label.expected_relationship}, got ${relation}`);
    }
    if (canonical.status !== 'active') {
      problems.push(`${label.id}: canonical record ${canonical.id} is ${canonical.status}, not active`);
    }
    if (source.id !== canonical.id) {
      const successor = source.relationships.find((relationship) => (
        relationship.type === 'successor' && relationship.id === canonical.id
      ));
      if (!successor) problems.push(`${label.id}: source ${source.id} does not point to canonical ${canonical.id}`);
    }
  }

  console.log(`base files: ${Object.keys(manifest.base_files_sha256).length} frozen hashes OK`);
  console.log(`cases: ${cases.length} base, ${institutionCases.length} institution labels`);
  console.log(`canonical entities: ${registry.organizations.length} from ${registry.source.release}`);
  if (problems.length) {
    console.error(`${problems.length} problem(s):`);
    for (const problem of problems) console.error(`  - ${problem}`);
    process.exit(1);
  }
  console.log('v2 schema and canonical labels OK');
}

main();
