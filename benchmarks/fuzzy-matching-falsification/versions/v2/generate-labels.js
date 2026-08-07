#!/usr/bin/env node
'use strict';

/**
 * Rebuild the v2 canonical-ID overlay from the checksum-pinned ROR v2.11 dump.
 * The raw dump is ignored and offline-only; the small selected registry and
 * case overlay are tracked so ordinary validation does not require 291 MiB.
 */
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { loadCases } = require('../../run');
const { PAIR_LABELS, ROR_ID_BY_EXPECTED_NAME } = require('./labels-source');

const BENCHMARKS_ROOT = path.resolve(__dirname, '../../..');
const DUMP_PATH = path.join(BENCHMARKS_ROOT, 'compact-ror-index/.data/v2.11-2026-08-03-ror-data.json');
const EXPECTED_DUMP_SHA256 = '5984c0455f5af6dd9af69e8ad5df3220d28ee0804b67a4d987ef98f079ce1daa';

function sha256(buffer) {
  return crypto.createHash('sha256').update(buffer).digest('hex');
}

function resolveLabel(c) {
  if (c.kind === 'pair-consistency') {
    const pairLabel = PAIR_LABELS[c.id];
    if (!pairLabel) throw new Error(`Missing pair label for ${c.id}`);
    return { id: c.id, kind: c.kind, ...pairLabel };
  }

  const expectedNames = c.expected?.target?.name === 'MULTIPLE'
    ? c.expected.multi_org
    : c.expected?.target?.name
      ? [c.expected.target.name]
      : [];
  const expectedRorIds = expectedNames.map((name) => {
    // HMS was withdrawn into Harvard in pinned v2.11; the active canonical
    // label is Harvard while the source record remains in the selected registry.
    if (name === 'Harvard Medical School') return 'https://ror.org/03vek6s52';
    const id = ROR_ID_BY_EXPECTED_NAME[name];
    if (!id) throw new Error(`Missing expected-name ROR mapping for ${c.id}: ${name}`);
    return id;
  });
  const mustNotRorIds = (c.expected?.must_not_resolve_to ?? []).map((name) => {
    const id = ROR_ID_BY_EXPECTED_NAME[name];
    if (!id) throw new Error(`Missing veto-name ROR mapping for ${c.id}: ${name}`);
    return id;
  });
  return {
    id: c.id,
    kind: c.kind,
    expected_ror_ids: [...new Set(expectedRorIds)].sort(),
    must_not_ror_ids: [...new Set(mustNotRorIds)].sort(),
  };
}

function selectedRecord(record) {
  return {
    id: record.id,
    status: record.status,
    names: record.names,
    domains: record.domains,
    locations: record.locations,
    types: record.types,
    relationships: record.relationships,
  };
}

function main() {
  if (!fs.existsSync(DUMP_PATH)) {
    throw new Error(`Pinned dump missing: ${DUMP_PATH}\nRun benchmarks/compact-ror-index/run-experiment.js first.`);
  }
  const raw = fs.readFileSync(DUMP_PATH);
  const actualSha = sha256(raw);
  if (actualSha !== EXPECTED_DUMP_SHA256) {
    throw new Error(`Pinned dump checksum mismatch: expected ${EXPECTED_DUMP_SHA256}, got ${actualSha}`);
  }
  const records = JSON.parse(raw);
  const byId = new Map(records.map((record) => [record.id, record]));
  const labels = loadCases()
    .filter((c) => c.decision === 'institution')
    .map(resolveLabel)
    .sort((a, b) => a.id.localeCompare(b.id));

  const referenced = new Set();
  for (const label of labels) {
    for (const key of ['expected_ror_ids', 'must_not_ror_ids']) {
      for (const id of label[key] ?? []) referenced.add(id);
    }
    for (const key of ['listed_ror_id', 'evidence_source_ror_id', 'evidence_canonical_ror_id']) {
      if (label[key]) referenced.add(label[key]);
    }
  }
  const selected = [...referenced].sort().map((id) => {
    const record = byId.get(id);
    if (!record) throw new Error(`Pinned dump does not contain referenced ROR id ${id}`);
    return selectedRecord(record);
  });

  fs.writeFileSync(path.join(__dirname, 'case-labels.jsonl'), `${labels.map(JSON.stringify).join('\n')}\n`);
  fs.writeFileSync(path.join(__dirname, 'canonical-entities.json'), `${JSON.stringify({
    schema_version: 'ror-canonical-entities/v1',
    source: {
      release: 'v2.11-2026-08-03',
      sha256: EXPECTED_DUMP_SHA256,
    },
    organizations: selected,
  }, null, 2)}\n`);
  console.log(`wrote ${labels.length} labels and ${selected.length} canonical entities`);
}

main();
