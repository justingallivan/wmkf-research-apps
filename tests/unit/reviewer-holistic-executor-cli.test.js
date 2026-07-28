/**
 * @jest-environment node
 */
import { parseArgs } from '../../scripts/run-reviewer-holistic-m1.mjs';

describe('reviewer holistic paid executor CLI', () => {
  const externalInputs = [
    '--manifest-file=/secure/manifest.json',
    '--proposal-evaluation-file=/secure/proposals.json',
    '--cohort-file=/secure/cohort.json',
  ];

  test('defaults to read-only preflight only after all external inputs are explicit', () => {
    expect(() => parseArgs([])).toThrow('--manifest-file');
    expect(() => parseArgs([externalInputs[0]])).toThrow('--proposal-evaluation-file');
    expect(() => parseArgs(externalInputs.slice(0, 2))).toThrow('--cohort-file');
    expect(parseArgs(externalInputs)).toEqual({
      mode: 'preflight',
      confirmPaidRuns: null,
      maxRuns: 60,
      retryFailed: false,
      help: false,
      manifestPath: '/secure/manifest.json',
      proposalEvaluationPath: '/secure/proposals.json',
      cohortPath: '/secure/cohort.json',
    });
  });

  test('paid execution requires the exact 60-run acknowledgement', () => {
    expect(() => parseArgs([...externalInputs, '--execute'])).toThrow('--confirm-paid-runs=60');
    expect(() => parseArgs([...externalInputs, '--execute', '--confirm-paid-runs=59'])).toThrow('--confirm-paid-runs=60');
    expect(parseArgs([
      ...externalInputs,
      '--execute',
      '--confirm-paid-runs=60',
      '--max-runs=5',
      '--retry-failed',
    ])).toEqual({
      mode: 'execute',
      confirmPaidRuns: '60',
      maxRuns: 5,
      retryFailed: true,
      help: false,
      manifestPath: '/secure/manifest.json',
      proposalEvaluationPath: '/secure/proposals.json',
      cohortPath: '/secure/cohort.json',
    });
  });

  test('unknown, contradictory, and out-of-range inputs fail closed', () => {
    expect(() => parseArgs([...externalInputs, '--unknown'])).toThrow('unknown argument');
    expect(() => parseArgs([
      ...externalInputs,
      '--preflight',
      '--execute',
      '--confirm-paid-runs=60',
    ])).toThrow('choose exactly one');
    expect(() => parseArgs([...externalInputs, '--max-runs=0'])).toThrow('--max-runs');
    expect(() => parseArgs([...externalInputs, '--preflight', '--retry-failed'])).toThrow(
      'valid only with --execute',
    );
    expect(() => parseArgs([
      `--manifest-file=${process.cwd()}/tests/fixtures/reviewer-holistic-evaluation-manifest-v2.synthetic.json`,
      externalInputs[1],
      externalInputs[2],
    ])).toThrow('outside the repository');
  });
});
