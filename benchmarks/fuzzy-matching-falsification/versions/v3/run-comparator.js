#!/usr/bin/env node
'use strict';

const crypto = require('crypto');
const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const { loadCases } = require('../v2/run');
const { runSuite } = require('./run');

const OUT_DIR = path.join(__dirname, 'results');
const REPO_ROOT = path.resolve(__dirname, '../../../..');

function sourceCommit() {
  return execFileSync('git', ['rev-parse', 'HEAD'], {
    cwd: REPO_ROOT,
    encoding: 'utf8',
  }).trim();
}

async function main() {
  const [adapterArg, slug] = process.argv.slice(2);
  if (!adapterArg || !slug) {
    console.error('Usage: node run-comparator.js <candidate-adapter-module> <output-slug>');
    process.exit(2);
  }
  if (!/^[\w.-]+$/.test(slug)) {
    console.error('output-slug must be a bare filename fragment');
    process.exit(2);
  }
  const candidateAdapter = require(adapterArg.startsWith('.') ? adapterArg : `./${adapterArg}`);
  const outputPath = path.join(OUT_DIR, `${slug}.results.jsonl`);
  const summaryPath = path.join(OUT_DIR, `${slug}.summary.json`);
  if (fs.existsSync(outputPath) || fs.existsSync(summaryPath)) {
    console.error(`Refusing to overwrite existing result slug: ${slug}`);
    process.exit(2);
  }
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const byId = new Map(loadCases().map((c) => [c.id, c]));
  const lines = [];
  const { summary } = await runSuite(candidateAdapter, {
    onResult(result) {
      const c = byId.get(result.id);
      const record = {
        id: result.id,
        file: c?._file,
        family: c?.family,
        kind: c?.kind,
        status: result.status,
        reason: result.reason,
      };
      if (result.status !== 'skipped') {
        Object.assign(record, {
          origin: c?.origin,
          label_status: c?.label_status,
          input: c?.input,
          expected_v1: c?.expected,
          expected_v2: c?.v2,
          failures: result.failures,
          actual: result.actual,
          error: result.error,
        });
      }
      lines.push(JSON.stringify(record));
    },
  });
  const resultBytes = `${lines.join('\n')}\n`;
  fs.writeFileSync(outputPath, resultBytes);
  const persistedSummary = {
    ...summary,
    adapter_provenance: {
      ...candidateAdapter.metadata,
      source_commit: sourceCommit(),
    },
    result_file: path.basename(outputPath),
    result_sha256: crypto.createHash('sha256').update(resultBytes).digest('hex'),
  };
  fs.writeFileSync(summaryPath, `${JSON.stringify(persistedSummary, null, 2)}\n`);
  console.log(JSON.stringify(persistedSummary, null, 2));
  console.log(`Wrote ${lines.length} result lines to ${outputPath}`);
  console.log(`Wrote summary to ${summaryPath}`);
}

main().catch((error) => {
  console.error('FATAL', error);
  process.exit(1);
});
