/**
 * @jest-environment node
 */

const {
  DEFAULT_BENCHMARK,
  DEFAULT_OUTPUT,
  includeRorProviderFailures,
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

describe('ROR evaluator provider-health gate', () => {
  const cleanPromotion = {
    pass: true,
    gates: { providerFailures: { actual: 0, maximum: 0, pass: true } },
  };

  test('voids an otherwise passing run when the ROR resolver recorded a failure', () => {
    expect(includeRorProviderFailures(cleanPromotion, { providerFailures: 1 })).toEqual({
      pass: false,
      gates: {
        providerFailures: {
          actual: 1,
          maximum: 0,
          pass: false,
          rowFailureCases: 0,
          rorResolverFailures: 1,
        },
      },
    });
  });

  test('preserves a clean result and rejects missing resolver metrics', () => {
    expect(includeRorProviderFailures(cleanPromotion, { providerFailures: 0 }).pass).toBe(true);
    expect(() => includeRorProviderFailures(cleanPromotion, {})).toThrow(
      'valid institution resolver provider-failure count',
    );
  });
});
