/**
 * apply-dataverse-schema: sandbox-only parity wave target guard.
 */

const {
  parseArgs,
  assertWaveExecutionAllowed,
} = require('../../scripts/apply-dataverse-schema');

const PARITY_WAVES = [
  '0-prod-parity-foundation',
  '29-prod-parity-tail',
];

function parse(...flags) {
  return parseArgs(['node', 'scripts/apply-dataverse-schema.js', ...flags]);
}

describe('apply-dataverse-schema target guard', () => {
  test.each(PARITY_WAVES)('refuses production execution of %s', (wave) => {
    const args = parse(`--wave=${wave}`, '--target=prod', '--execute');

    expect(() => assertWaveExecutionAllowed(args)).toThrow(
      `Refusing to execute sandbox-only parity wave '${wave}' against production.`,
    );
  });

  test.each(PARITY_WAVES)('allows sandbox execution of %s', (wave) => {
    const args = parse(`--wave=${wave}`, '--target=sandbox', '--execute');

    expect(() => assertWaveExecutionAllowed(args)).not.toThrow();
  });

  test.each(PARITY_WAVES)('allows a production dry run of %s', (wave) => {
    const args = parse(`--wave=${wave}`, '--target=prod');

    expect(() => assertWaveExecutionAllowed(args)).not.toThrow();
  });

  test('allows production execution of another wave', () => {
    const args = parse('--wave=28-meeting-tracker', '--target=prod', '--execute');

    expect(() => assertWaveExecutionAllowed(args)).not.toThrow();
  });
});
