/**
 * Plan §7: sentiment results are staff-only and never reach a Board or briefing token surface. No file under
 * the token-served external routes, external pages or external library imports any sentiment module
 * (service, store, reader, view or order helper). Scanner: tests/helpers/import-census.js (string-literal
 * specifiers only; a computed specifier is a documented blind spot).
 * @jest-environment node
 */
const path = require('path');
const { readSourceFiles, findImporters } = require('../helpers/import-census');

const root = path.resolve(__dirname, '../..');
const PATTERN = /discussion-sentiment/;
const TOKEN_SURFACES = ['pages/api/external', 'pages/external', 'lib/external'].map((dir) => path.join(root, dir));
const read = (roots) => readSourceFiles(roots, { relativeTo: root });

test('no Board, briefing or other token surface imports a sentiment module', () => {
  const files = read(TOKEN_SURFACES);
  // Denominator: the scan really covered the briefing and presentation token routes.
  expect(files.length).toBeGreaterThan(20);
  expect(files.some((f) => f.file === 'pages/api/external/briefing/[token]/context.js')).toBe(true);
  expect(files.some((f) => f.file.startsWith('pages/api/external/presentation/'))).toBe(true);
  expect(findImporters(files, PATTERN)).toEqual([]);
  // The shared scanner skips side-effect imports (`import 'x'`), so check those here.
  const bare = files.filter((f) => /import\s*['"][^'"]*discussion-sentiment/.test(f.content)).map((f) => f.file);
  expect(bare).toEqual([]);
});

test('the scanner does see the staff routes that do import the sentiment service (positive control)', () => {
  const importers = findImporters(read([path.join(root, 'pages/api/meeting-tracker')]), PATTERN);
  expect(importers).toEqual(expect.arrayContaining([
    'pages/api/meeting-tracker/visits/[requestId]/discussion-sentiment.js',
    'pages/api/meeting-tracker/visits/[requestId]/discussion-sentiment/accept.js',
    'pages/api/meeting-tracker/visits/[requestId]/discussion-sentiment/withdraw.js',
  ]));
});
