#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const { CATALOG_REL, loadDocs, renderCatalog, validateDoc } = require('./lib/docs-catalog');

const repoRoot = path.resolve(__dirname, '..');

function main() {
  const docs = loadDocs(repoRoot);
  const violations = [];

  for (const doc of docs) {
    violations.push(...validateDoc(doc, repoRoot));
  }

  const catalogPath = path.join(repoRoot, CATALOG_REL);
  if (!fs.existsSync(catalogPath)) {
    violations.push(`${CATALOG_REL}: missing generated catalog; run npm run generate:docs-catalog`);
  } else {
    const actual = fs.readFileSync(catalogPath, 'utf8');
    const expected = renderCatalog(docs);
    if (actual !== expected) {
      violations.push(`${CATALOG_REL}: generated catalog is stale; run npm run generate:docs-catalog`);
    }
  }

  if (violations.length) {
    console.error(`docs-catalog FAILED: ${violations.length} violation(s).`);
    for (const violation of violations) console.error(`  ✗ ${violation}`);
    process.exit(1);
  }

  console.log(`docs-catalog OK — ${docs.length} top-level markdown doc(s) cataloged.`);
}

if (require.main === module) {
  try {
    main();
  } catch (error) {
    console.error(error.message || error);
    process.exit(2);
  }
}
