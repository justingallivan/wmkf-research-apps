#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const { loadCases } = require('../v2/run');
const { runSuite } = require('./run');

const OUT_DIR = path.join(__dirname, 'results');

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
  if (fs.existsSync(outputPath)) {
    console.error(`Refusing to overwrite existing results: ${outputPath}`);
    process.exit(2);
  }
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const byId = new Map(loadCases().map((c) => [c.id, c]));
  const lines = [];
  const { summary } = await runSuite(candidateAdapter, {
    onResult(result) {
      const c = byId.get(result.id);
      lines.push(JSON.stringify({
        id: result.id,
        file: c?._file,
        family: c?.family,
        kind: c?.kind,
        origin: c?.origin,
        label_status: c?.label_status,
        input: c?.input,
        expected_v1: c?.expected,
        expected_v2: c?.v2,
        status: result.status,
        reason: result.reason,
        failures: result.failures,
        actual: result.actual,
        error: result.error,
      }));
    },
  });
  fs.writeFileSync(outputPath, `${lines.join('\n')}\n`);
  console.log(JSON.stringify(summary, null, 2));
  console.log(`Wrote ${lines.length} result lines to ${outputPath}`);
}

main().catch((error) => {
  console.error('FATAL', error);
  process.exit(1);
});
