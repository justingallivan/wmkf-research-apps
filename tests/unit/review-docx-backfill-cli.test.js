/**
 * @jest-environment node
 */

import {
  backfillExitCode,
  parseArgs,
  resultPathFor,
} from '../../scripts/backfill-review-docx-sharepoint.mjs';

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

test('uses a unique execution-result path that cannot overwrite the manifest', () => {
  expect(resultPathFor('/private/tmp/review.json', '2026-09-03T20:01:02.345Z'))
    .toBe('/private/tmp/review.execute-result-2026-09-03T20-01-02-345Z.json');
  expect(resultPathFor('/private/tmp/review.manifest', '2026-09-03T20:01:02.345Z'))
    .toBe('/private/tmp/review.manifest.execute-result-2026-09-03T20-01-02-345Z.json');
});

test('maps blocking dry runs and row failures to a nonzero CLI exit', () => {
  expect(backfillExitCode({ manifest: { summary: { blocking: 1 } } })).toBe(1);
  expect(backfillExitCode({ manifest: { summary: { blocking: 0 } } })).toBe(0);
  expect(backfillExitCode({ report: { summary: { failed: 2 } } })).toBe(1);
  expect(backfillExitCode({ report: { summary: { failed: 0 } } })).toBe(0);
});
