/**
 * @jest-environment node
 */

const {
  MAX_LIMIT,
  UsageError,
  buildQueries,
  formatHuman,
  parseArgs,
  runCli,
} = require('../../scripts/report-reviewer-identity-shadow-log');

describe('reviewer identity shadow-log report', () => {
  test('supports help and rejects ambiguous or unsafe arguments', () => {
    expect(parseArgs(['--help'])).toMatchObject({ help: true });
    expect(parseArgs(['--run', 'run-1'])).toMatchObject({ limit: MAX_LIMIT });
    expect(() => parseArgs(['--run'])).toThrow(UsageError);
    expect(() => parseArgs(['--days', '7', '--run', 'run-1']))
      .toThrow('--run and --days cannot be used together');
    expect(() => parseArgs(['--mode', 'legacy']))
      .toThrow('--mode must be shadow or combined');
    expect(() => parseArgs(['--limit', String(MAX_LIMIT + 1)]))
      .toThrow(`--limit must be between 1 and ${MAX_LIMIT}`);
  });

  test('scopes both the summary and transcript to the requested run and mode', () => {
    const args = parseArgs([
      '--run', 'run-123',
      '--mode', 'combined',
      '--limit', '50',
    ]);
    const queries = buildQueries(args);

    expect(queries.summary.text).toContain('run_id = $1');
    expect(queries.summary.text).toContain('resolver_mode = $2');
    expect(queries.summary.text).not.toContain('MAKE_INTERVAL');
    expect(queries.summary.params).toEqual(['run-123', 'combined']);

    expect(queries.rows.text).toContain('run_id = $1');
    expect(queries.rows.text).toContain('resolver_mode = $2');
    expect(queries.rows.text).toContain('LIMIT $3');
    expect(queries.rows.text).toContain('SELECT run_id, resolver_mode, event_type, candidate_key');
    expect(queries.rows.params).toEqual(['run-123', 'combined', 50]);
  });

  test('default attention rows separate errors, arm disagreements, and combined outcomes', () => {
    const queries = buildQueries(parseArgs([]));

    expect(queries.summary.text).toContain('AS arm_disagreements');
    expect(queries.summary.text).toContain('AS authoritative_binds');
    expect(queries.summary.text).toContain('AS authoritative_reviews');
    expect(queries.summary.text).toContain('AS authoritative_abstentions');
    expect(queries.summary.text).toContain('AS authoritative_other');
    expect(queries.rows.text).toMatch(/event_type = 'error'/);
    expect(queries.rows.text).toMatch(/resolver_mode = 'combined'/);
    expect(queries.rows.text).toMatch(/legacy_decision IS DISTINCT FROM works_decision/);
    expect(queries.rows.params).toEqual([30, 200]);
  });

  test('human output includes mode and candidate attribution for errors', () => {
    const args = parseArgs(['--run', 'run-1']);
    const output = formatHuman({
      summary: {
        comparisons: '0',
        runs: '1',
        arm_disagreements: '0',
        authoritative_binds: '0',
        authoritative_reviews: '0',
        authoritative_abstentions: '0',
        authoritative_other: '0',
        errors: '1',
        oldest: '2026-07-19T10:00:00.000Z',
        newest: '2026-07-19T10:00:00.000Z',
      },
      rows: [{
        run_id: 'run-1',
        resolver_mode: 'combined',
        event_type: 'error',
        candidate_key: 'abcd1234abcd1234',
        error_code: 'reviewer_identity_shadow_timeout',
        created_at: '2026-07-19T10:00:00.000Z',
      }],
    }, args);

    expect(output).toContain('mode=combined');
    expect(output).toContain('key=abcd1234abcd1234');
    expect(output).toContain('ERROR reviewer_identity_shadow_timeout');
  });

  test('human output labels combined rows authoritative and shadow rows observational', () => {
    const args = parseArgs(['--all']);
    const base = {
      event_type: 'comparison',
      candidate_key: 'abcd1234abcd1234',
      legacy_decision: 'bind',
      works_decision: 'review',
      combined_decision: 'review',
      combined_reason: 'anchor_disagreement',
      anchors_agree: false,
      created_at: '2026-07-19T10:00:00.000Z',
    };
    const output = formatHuman({
      summary: {
        comparisons: '2',
        runs: '2',
        arm_disagreements: '2',
        authoritative_binds: '0',
        authoritative_reviews: '1',
        authoritative_abstentions: '0',
        authoritative_other: '0',
        errors: '0',
        oldest: base.created_at,
        newest: base.created_at,
      },
      rows: [
        { ...base, run_id: 'combined-run', resolver_mode: 'combined' },
        { ...base, run_id: 'shadow-run', resolver_mode: 'shadow' },
      ],
    }, args);

    expect(output).toContain('authoritative=review');
    expect(output).toContain('shadow-combined=review');
    expect(output).toContain('armDisagreement=true');
  });

  test('CLI help requires neither environment nor database connection', async () => {
    const ClientClass = jest.fn(() => {
      throw new Error('database should not be constructed');
    });
    const output = [];
    await expect(runCli({
      argv: ['--help'],
      env: {},
      ClientClass,
      log: (line) => output.push(line),
      error: (line) => output.push(line),
    })).resolves.toBe(0);

    expect(ClientClass).not.toHaveBeenCalled();
    expect(output.join('\n')).toContain('--mode <shadow|combined>');
  });

  test('missing-table failures are explicit and still close the client', async () => {
    const missingTable = new Error('relation does not exist');
    missingTable.code = '42P01';
    const client = {
      connect: jest.fn(async () => {}),
      query: jest.fn(async () => { throw missingTable; }),
      end: jest.fn(async () => {}),
    };
    const ClientClass = jest.fn(() => client);
    const errors = [];

    await expect(runCli({
      argv: [],
      env: { POSTGRES_URL: 'postgres://example.invalid/test' },
      ClientClass,
      log: jest.fn(),
      error: (line) => errors.push(line),
    })).resolves.toBe(1);

    expect(client.end).toHaveBeenCalledTimes(1);
    expect(errors.join('\n')).toContain('Migration 026 has not been applied');
  });
});
