#!/usr/bin/env node
/**
 * One-off driver for the incumbent baseline freeze (2026-08-06, owner-
 * authorized execution). Not part of the suite's normal "build, don't
 * execute" posture — this is the authorized first run. Read-only against
 * production code; writes only under benchmarks/fuzzy-matching-falsification/baseline/.
 *
 * Usage: node run-baseline.js
 */
const fs = require('fs');
const path = require('path');
const { runSuite, loadCases } = require('./run');
const adapters = require('./adapters-incumbent');

const OUT_DIR = path.join(__dirname, 'baseline');
const JSONL_PATH = path.join(OUT_DIR, 'incumbent-2026-08-06.results.jsonl');

async function main() {
  const cases = loadCases();
  const byId = new Map(cases.map((c) => [c.id, c]));
  const lines = [];
  let done = 0;

  const { results, summary } = await runSuite(adapters, {
    onResult: (result) => {
      done += 1;
      const c = byId.get(result.id);
      lines.push(JSON.stringify({
        id: result.id,
        file: c?._file,
        family: c?.family,
        kind: c?.kind,
        label_status: c?.label_status,
        status: result.status,
        reason: result.reason,
        failures: result.failures,
        actual: result.actual,
        error: result.error,
      }));
      if (done % 20 === 0) {
        process.stderr.write(`... ${done}/${cases.length}\n`);
      }
    },
  });

  fs.writeFileSync(JSONL_PATH, lines.join('\n') + '\n');
  console.log(JSON.stringify(summary, null, 2));
  console.log(`\nWrote ${lines.length} result lines to ${JSONL_PATH}`);
}

main().catch((err) => {
  console.error('FATAL', err);
  process.exit(1);
});
