/**
 * @jest-environment node
 */
import { parseArgs } from '../../scripts/run-reviewer-holistic-m1.mjs';

describe('reviewer holistic paid executor CLI', () => {
  test('defaults to read-only preflight', () => {
    expect(parseArgs([])).toEqual({
      mode: 'preflight',
      confirmPaidRuns: null,
      maxRuns: 60,
      retryFailed: false,
      help: false,
    });
  });

  test('paid execution requires the exact 60-run acknowledgement', () => {
    expect(() => parseArgs(['--execute'])).toThrow('--confirm-paid-runs=60');
    expect(() => parseArgs(['--execute', '--confirm-paid-runs=59'])).toThrow('--confirm-paid-runs=60');
    expect(parseArgs(['--execute', '--confirm-paid-runs=60', '--max-runs=5', '--retry-failed'])).toEqual({
      mode: 'execute',
      confirmPaidRuns: '60',
      maxRuns: 5,
      retryFailed: true,
      help: false,
    });
  });

  test('unknown, contradictory, and out-of-range inputs fail closed', () => {
    expect(() => parseArgs(['--unknown'])).toThrow('unknown argument');
    expect(() => parseArgs(['--preflight', '--execute', '--confirm-paid-runs=60'])).toThrow('choose exactly one');
    expect(() => parseArgs(['--max-runs=0'])).toThrow('--max-runs');
    expect(() => parseArgs(['--preflight', '--retry-failed'])).toThrow('valid only with --execute');
  });
});

