/**
 * @jest-environment node
 */

import { parseArgs, resultPathFor } from '../../scripts/repair-review-docx-sharepoint.mjs';

const ID = '11111111-1111-4111-8111-111111111111';

test('requires exact cycle, request, and suggestion identities', () => {
  expect(parseArgs([
    '--cycle', 'D26', '--request-number', '1002874', '--suggestion', ID,
  ])).toMatchObject({
    execute: false, cycleCode: 'D26', requestNumber: '1002874', suggestionId: ID,
  });
  expect(() => parseArgs(['--cycle', 'D26', '--request-number', '1002874']))
    .toThrow('--suggestion');
  expect(() => parseArgs([
    '--cycle', 'd26', '--request-number', '1002874', '--suggestion', ID,
  ])).toThrow('exact uppercase');
});

test('requires a manifest for execute and exposes no cleanup or overwrite option', () => {
  expect(() => parseArgs([
    '--cycle', 'D26', '--request-number', '1002874', '--suggestion', ID, '--execute',
  ])).toThrow('--manifest');
  expect(() => parseArgs([
    '--cycle', 'D26', '--request-number', '1002874', '--suggestion', ID, '--cleanup-old',
  ])).toThrow('Unsupported argument');
  expect(() => parseArgs([
    '--cycle', 'D26', '--request-number', '1002874', '--suggestion', ID, '--manifest=', '--execute',
  ])).toThrow('--manifest requires a value');
});

test('uses a unique execution-result artifact path', () => {
  expect(resultPathFor('/private/tmp/repair.json', '2026-09-03T23:31:02.345Z'))
    .toBe('/private/tmp/repair.execute-result-2026-09-03T23-31-02-345Z.json');
});
