#!/usr/bin/env node
/**
 * Generic comparator driver (S406, owner-authorized comparator runs — SESSION_PROMPT
 * Verified Open #1). `run-baseline.js` stays untouched as the frozen incumbent
 * driver; this is its parameterized sibling for every subsequent system under test.
 *
 * Read-only against repo code; writes only under
 * benchmarks/fuzzy-matching-falsification/baseline/.
 *
 * Usage: node run-comparator.js <adapter-module> <output-slug>
 *   e.g. node run-comparator.js ./adapters-ror ror-chosen-2026-08-07
 *
 * Emits <slug>.results.jsonl next to the incumbent baseline, one line per case.
 * Each line carries `expected` alongside `actual` so the analysis pass can compute
 * per-family numbers without re-joining against the case files — the incumbent
 * run had to re-join by hand.
 */
const fs = require('fs');
const path = require('path');
const { runSuite, loadCases } = require('./run');

const OUT_DIR = path.join(__dirname, 'baseline');

async function main() {
  const [adapterArg, slug] = process.argv.slice(2);
  if (!adapterArg || !slug) {
    console.error('Usage: node run-comparator.js <adapter-module> <output-slug>');
    process.exit(2);
  }
  if (!/^[\w.-]+$/.test(slug)) {
    console.error('output-slug must be a bare filename fragment (no path separators)');
    process.exit(2);
  }
  const adapters = require(adapterArg.startsWith('.') ? adapterArg : `./${adapterArg}`);
  const jsonlPath = path.join(OUT_DIR, `${slug}.results.jsonl`);
  if (fs.existsSync(jsonlPath)) {
    console.error(`Refusing to overwrite existing results: ${jsonlPath}`);
    console.error('Frozen result files are the record — pick a new slug.');
    process.exit(2);
  }

  const cases = loadCases();
  const byId = new Map(cases.map((c) => [c.id, c]));
  const lines = [];
  let done = 0;
  const startedAt = Date.now();

  const { summary } = await runSuite(adapters, {
    onResult: (result) => {
      done += 1;
      const c = byId.get(result.id);
      lines.push(JSON.stringify({
        id: result.id,
        file: c?._file,
        family: c?.family,
        kind: c?.kind,
        origin: c?.origin,
        label_status: c?.label_status,
        input: c?.input,
        expected: c?.expected,
        status: result.status,
        reason: result.reason,
        failures: result.failures,
        actual: result.actual,
        error: result.error,
      }));
      if (done % 20 === 0) {
        const rate = done / ((Date.now() - startedAt) / 1000);
        process.stderr.write(`... ${done}/${cases.length} (${rate.toFixed(1)}/s)\n`);
      }
    },
  });

  fs.writeFileSync(jsonlPath, lines.join('\n') + '\n');
  console.log(JSON.stringify(summary, null, 2));
  console.log(`\nWrote ${lines.length} result lines to ${jsonlPath}`);
  console.log(`Elapsed: ${((Date.now() - startedAt) / 1000).toFixed(0)}s`);
}

main().catch((err) => {
  console.error('FATAL', err);
  process.exit(1);
});
