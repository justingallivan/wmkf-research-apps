#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const { CATALOG_REL, loadDocs, renderCatalog } = require('./lib/docs-catalog');

const repoRoot = path.resolve(__dirname, '..');
const docs = loadDocs(repoRoot);
const output = renderCatalog(docs);
fs.writeFileSync(path.join(repoRoot, CATALOG_REL), output);
console.log(`Generated ${CATALOG_REL} from ${docs.length} top-level markdown doc(s).`);
