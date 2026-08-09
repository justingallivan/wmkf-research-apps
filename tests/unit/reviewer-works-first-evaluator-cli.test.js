/**
 * @jest-environment node
 */

const {
  DEFAULT_BENCHMARK,
  DEFAULT_OUTPUT,
  parseCli,
} = require('../../scripts/evaluate-reviewer-works-first');

describe('evaluate-reviewer-works-first parseCli', () => {
  test('defaults institutionResolverArm to incumbent', () => {
    const options = parseCli([]);
    expect(options.institutionResolverArm).toBe('incumbent');
    expect(options.benchmarkPath).toBe(DEFAULT_BENCHMARK);
    expect(options.outputPath).toBe(DEFAULT_OUTPUT);
    expect(options.caseIds).toEqual([]);
  });

  test('accepts --institution-resolver ror', () => {
    const options = parseCli(['--institution-resolver', 'ror']);
    expect(options.institutionResolverArm).toBe('ror');
  });

  test('accepts --institution-resolver incumbent explicitly', () => {
    const options = parseCli(['--institution-resolver', 'incumbent']);
    expect(options.institutionResolverArm).toBe('incumbent');
  });

  test('rejects an invalid --institution-resolver value', () => {
    expect(() => parseCli(['--institution-resolver', 'bogus'])).toThrow(
      '--institution-resolver must be one of: incumbent, ror',
    );
  });

  test('rejects a missing --institution-resolver value', () => {
    expect(() => parseCli(['--institution-resolver'])).toThrow(
      '--institution-resolver must be one of: incumbent, ror',
    );
  });

  test('--output is still parsed and resolved to an absolute path', () => {
    const options = parseCli(['--output', 'outputs/example.json']);
    expect(options.outputPath.endsWith('outputs/example.json')).toBe(true);
    expect(options.institutionResolverArm).toBe('incumbent');
  });

  test('--institution-resolver combines with other flags', () => {
    const options = parseCli([
      '--output', 'outputs/example.json',
      '--institution-resolver', 'ror',
      '--case', 'case-1',
    ]);
    expect(options.institutionResolverArm).toBe('ror');
    expect(options.caseIds).toEqual(['case-1']);
  });
});
