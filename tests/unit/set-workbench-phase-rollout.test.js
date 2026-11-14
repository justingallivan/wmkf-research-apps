/** @jest-environment node */
import { parseArgs, buildValue } from '../../scripts/set-workbench-phase-rollout.mjs';
import { parsePhaseRollout } from '../../lib/services/workbench/phase-admission';

const A = '11111111-1111-4111-8111-111111111111';
const argv = (...args) => ['node', 'set-workbench-phase-rollout.mjs', ...args];

test('no mode only shows the current value', () => {
  expect(parseArgs(argv())).toMatchObject({ mode: null, execute: false });
});

test('a mode without --execute is a dry run', () => {
  expect(parseArgs(argv('on'))).toMatchObject({ mode: 'on', execute: false });
  expect(parseArgs(argv('pilot', `${A}, ${A.toUpperCase()}`))).toMatchObject({ mode: 'pilot', requestIds: [A, A.toUpperCase()] });
});

test('--execute needs a mode, the expected revision and the editor', () => {
  expect(() => parseArgs(argv('--execute'))).toThrow(/needs a mode/);
  expect(() => parseArgs(argv('off', '--execute', '--actor-email=x@example.org'))).toThrow(/--expected-revision/);
  expect(() => parseArgs(argv('off', '--execute', '--expected-revision=none'))).toThrow(/--actor-email/);
  expect(parseArgs(argv('off', '--execute', '--expected-revision=W/"5"', '--actor-email=x@example.org')))
    .toMatchObject({ mode: 'off', execute: true, expectedRevision: 'W/"5"', actorEmail: 'x@example.org' });
});

test('unknown modes, flags and stray arguments are refused', () => {
  expect(() => parseArgs(argv('all'))).toThrow(/Unknown mode/);
  expect(() => parseArgs(argv('on', '--force'))).toThrow(/Unknown flag/);
  expect(() => parseArgs(argv('on', A))).toThrow(/takes no further arguments/);
  expect(() => parseArgs(argv('pilot'))).toThrow(/pilot needs/);
});

test('the written value is exactly what the app accepts', () => {
  expect(buildValue({ mode: 'off' }, parsePhaseRollout)).toBe('{"mode":"off"}');
  expect(buildValue({ mode: 'on' }, parsePhaseRollout)).toBe('{"mode":"on"}');
  expect(buildValue({ mode: 'pilot', requestIds: [A.toUpperCase()] }, parsePhaseRollout))
    .toBe(`{"mode":"pilot","requestIds":["${A}"]}`);
  expect(() => buildValue({ mode: 'pilot', requestIds: ['1002794'] }, parsePhaseRollout)).toThrow(/read as off/);
});
