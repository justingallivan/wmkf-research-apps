#!/usr/bin/env node
/**
 * scripts/build-migrations-manifest.js
 *
 * Generates `lib/db/migrations-manifest.json` from the contents of
 * `lib/db/migrations/`. The manifest is committed to git and verified
 * fresh in CI via `check:migrations-manifest`.
 *
 * Wired into `package.json` `prebuild` so every `next build` regenerates
 * the file. Drift detected at runtime via `lib/utils/migration-drift.js`.
 *
 * See docs/archive/READINESS_AUDIT_PHASE0_PLAN.md § Step 4b.
 */

const fs = require('fs');
const path = require('path');

const MIGRATIONS_DIR = path.join(__dirname, '..', 'lib', 'db', 'migrations');
const MANIFEST_PATH = path.join(__dirname, '..', 'lib', 'db', 'migrations-manifest.json');

function build() {
  const files = fs.readdirSync(MIGRATIONS_DIR)
    .filter(f => /\.sql$/i.test(f))
    .sort();

  // Deterministic output — no timestamps or env-derived fields. The CI gate
  // `git diff --exit-code lib/db/migrations-manifest.json` only works when
  // the file content is stable across builds. The committed file is the
  // canonical source; CI regenerates and asserts no drift.
  const manifest = { files };

  const json = JSON.stringify(manifest, null, 2) + '\n';
  fs.writeFileSync(MANIFEST_PATH, json, 'utf8');
  console.log(`Wrote ${MANIFEST_PATH} (${files.length} files)`);
}

if (require.main === module) build();

module.exports = { build };
