/**
 * @jest-environment node
 */

import { parseArgs } from '../../scripts/backfill-review-docx-sharepoint.mjs';

test('defaults to dry run and requires an exact cycle', () => {
  expect(parseArgs(['--cycle', 'D26'])).toMatchObject({
    execute: false, cycleCode: 'D26', requestNumber: null, manifestPath: null,
  });
  expect(() => parseArgs([])).toThrow('--cycle');
  expect(() => parseArgs(['--cycle', 'd26'])).toThrow('exact uppercase');
});

test('requires a reviewed manifest for execute and has no force mode', () => {
  expect(() => parseArgs(['--cycle', 'D26', '--execute'])).toThrow('--manifest');
  expect(parseArgs(['--cycle=D26', '--execute', '--manifest', '/private/tmp/review.json']))
    .toMatchObject({ execute: true, cycleCode: 'D26', manifestPath: '/private/tmp/review.json' });
  expect(() => parseArgs(['--cycle', 'D26', '--force'])).toThrow('Unsupported argument');
});

test('keeps request-number and dry-run output contracts explicit', () => {
  expect(parseArgs(['--cycle', 'D26', '--request-number', '1002903', '--output', '/private/tmp/manifest.json']))
    .toMatchObject({ requestNumber: '1002903', outputPath: '/private/tmp/manifest.json' });
  expect(() => parseArgs(['--cycle', 'D26', '--request-number', 'abc'])).toThrow('digits');
  expect(() => parseArgs(['--cycle', 'D26', '--manifest', '/private/tmp/input.json']))
    .toThrow('execute-only');
  expect(() => parseArgs(['--cycle', 'D26', '--cycle=D26'])).toThrow('only once');
});
