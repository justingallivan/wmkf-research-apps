'use strict';

const path = require('path');
const { jsonFiles, validatePublicAssets } = require('./validate-public-assets');

function validatePublicCases(root = __dirname) {
  const caseFiles = jsonFiles(path.join(root, 'public-cases'));
  const counts = validatePublicAssets({ root });
  return { files: caseFiles.length, cases: counts.cases };
}

if (require.main === module) {
  const counts = validatePublicCases();
  process.stdout.write(`Validated ${counts.cases} public cases in ${counts.files} files.\n`);
}

module.exports = { validatePublicCases };
