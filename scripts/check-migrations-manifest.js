#!/usr/bin/env node
/**
 * scripts/check-migrations-manifest.js
 *
 * CI gate. Reads `lib/db/migrations-manifest.json#files` and compares to the
 * actual `.sql` files in `lib/db/migrations/`. Exits non-zero on drift,
 * surfacing the missing/extra files in stderr.
 *
 * Wired into `.github/workflows/test.yml` alongside the other check:* gates.
 * Also paired with `git diff --exit-code lib/db/migrations-manifest.json`
 * (after `npm run build`) to catch the case where a developer added a
 * migration but didn't regenerate the manifest.
 *
 * See docs/READINESS_AUDIT_PHASE0_PLAN.md § Step 4b.
 */

const fs = require('fs');
const path = require('path');

const MIGRATIONS_DIR = path.join(__dirname, '..', 'lib', 'db', 'migrations');
const MANIFEST_PATH = path.join(__dirname, '..', 'lib', 'db', 'migrations-manifest.json');

function check() {
  if (!fs.existsSync(MANIFEST_PATH)) {
    console.error(`Manifest missing: ${MANIFEST_PATH}`);
    console.error(`Run \`node scripts/build-migrations-manifest.js\` to generate it.`);
    return 1;
  }

  let manifest;
  try {
    manifest = JSON.parse(fs.readFileSync(MANIFEST_PATH, 'utf8'));
  } catch (err) {
    console.error(`Manifest is not valid JSON: ${MANIFEST_PATH}`);
    console.error(`  ${err.message}`);
    return 1;
  }

  if (!manifest || !Array.isArray(manifest.files)) {
    console.error(`Manifest malformed: ${MANIFEST_PATH}`);
    console.error('  Expected top-level object with a files array.');
    return 1;
  }

  const manifestFiles = manifest.files;
  const invalidEntries = manifestFiles.filter(f => typeof f !== 'string' || !/\.sql$/i.test(f));
  const duplicateEntries = manifestFiles.filter((f, i) => manifestFiles.indexOf(f) !== i);

  const dirFiles = fs.readdirSync(MIGRATIONS_DIR)
    .filter(f => /\.sql$/i.test(f))
    .sort();

  const manifestSet = new Set(manifestFiles);
  const dirSet = new Set(dirFiles);

  const onlyInManifest = manifestFiles.filter(f => !dirSet.has(f));
  const onlyInDir = dirFiles.filter(f => !manifestSet.has(f));

  // Order-sensitive — manifest must be sorted ascending.
  const manifestSorted = [...manifestFiles].sort();
  const orderDrift = manifestFiles.some((f, i) => f !== manifestSorted[i]);

  if (
    onlyInManifest.length === 0 &&
    onlyInDir.length === 0 &&
    !orderDrift &&
    invalidEntries.length === 0 &&
    duplicateEntries.length === 0
  ) {
    console.log(`migrations-manifest OK: ${manifestFiles.length} file(s)`);
    return 0;
  }

  console.error('migrations-manifest DRIFT:');
  if (invalidEntries.length) console.error(`  invalid manifest entries: ${invalidEntries.map(String).join(', ')}`);
  if (duplicateEntries.length) console.error(`  duplicate manifest entries: ${[...new Set(duplicateEntries)].join(', ')}`);
  if (onlyInManifest.length) console.error(`  in manifest but not in directory: ${onlyInManifest.join(', ')}`);
  if (onlyInDir.length)      console.error(`  in directory but not in manifest: ${onlyInDir.join(', ')}`);
  if (orderDrift)            console.error(`  manifest files not sorted ascending`);
  console.error(`\nRun \`node scripts/build-migrations-manifest.js\` to regenerate.`);
  return 1;
}

if (require.main === module) process.exit(check());

module.exports = { check };
