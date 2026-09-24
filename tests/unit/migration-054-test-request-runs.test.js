import fs from 'node:fs';
import path from 'node:path';
import { LEDGER_REASON_CODES, LEDGER_RECEIPT_KEYS, LEDGER_STEPS } from '../../lib/services/test-requests/run-ledger.js';

/**
 * Migration 054 (lib/db/migrations/054_test_request_runs.sql) adds CHECK
 * constraints enforced by live Postgres, not application code. This repo has
 * no live/in-memory Postgres harness for exercising CHECK constraint
 * behavior directly (see
 * tests/unit/migration-053-pre-site-distribution-review-bundle.test.js for
 * the precedent this file mirrors). So this test is a pure-JS mirror of each
 * constraint's boolean logic, kept byte-for-byte equivalent to the SQL — if
 * the SQL and this mirror diverge, both must be re-checked together.
 */

const STATUSES = ['prepared', 'creating', 'ready', 'needs_attention', 'retiring', 'retired'];
const RESOURCE_OUTCOMES = [
  'planned', 'dispatched', 'verified', 'recovered', 'conflict', 'rejected', 'ambiguous', 'failed',
];

/** Mirrors the `status` CHECK on test_request_runs. */
function isValidStatus(status) {
  return STATUSES.includes(status);
}

/** Mirrors test_request_runs_needs_attention_reason_coherence. */
function satisfiesNeedsAttentionCoherence({ status, needsAttentionReason = null }) {
  if (status === 'needs_attention') return needsAttentionReason !== null;
  return needsAttentionReason === null;
}

/** Mirrors test_request_runs_ready_request_number. */
const REQUEST_NUMBER_SHAPE = /^[0-9]{1,10}$/;
/** Mirrors test_request_runs_request_number_shape. */
function satisfiesRequestNumberShape({ destinationRequestNumber = null }) {
  return destinationRequestNumber === null || REQUEST_NUMBER_SHAPE.test(destinationRequestNumber);
}
function satisfiesReadyRequestNumber({ status, destinationRequestNumber = null }) {
  return status !== 'ready' || (destinationRequestNumber !== null && REQUEST_NUMBER_SHAPE.test(destinationRequestNumber));
}

/** Mirrors test_request_runs_completed_at_coherence. */
function satisfiesCompletedAtCoherence({ status, completedAt = null }) {
  if (status === 'ready') return completedAt !== null;
  if (['prepared', 'creating', 'needs_attention'].includes(status)) return completedAt === null;
  // retiring/retired: reachable from ready (completed_at set) or from
  // needs_attention (completed_at null), so either is admitted.
  return status === 'retiring' || status === 'retired';
}

/** Mirrors the `resource_kind` CHECK on test_request_run_resources. */
function isValidResourceKind(kind) {
  return [
    'dataverse_request', 'dataverse_request_patch', 'sharepoint_folder',
    'dataverse_document_location', 'sharepoint_file', 'workflow_bypass',
  ].includes(kind);
}

/** Mirrors the `system` CHECK on test_request_run_resources. */
function isValidResourceSystem(system) {
  return system === 'dataverse' || system === 'sharepoint';
}

/** Mirrors the `outcome` CHECK on test_request_run_resources. */
function isValidResourceOutcome(outcome) {
  return RESOURCE_OUTCOMES.includes(outcome);
}

/** Mirrors the `destination_environment` CHECK on test_request_runs. */
function isValidDestinationEnvironment(env) {
  return env === 'sandbox' || env === 'production';
}

describe('migration 054 CHECK constraints (pure-JS mirror)', () => {
  describe('status enum', () => {
    it.each(STATUSES)('accepts %s', (status) => {
      expect(isValidStatus(status)).toBe(true);
    });

    it('rejects an unknown status', () => {
      expect(isValidStatus('archived')).toBe(false);
      expect(isValidStatus('')).toBe(false);
    });
  });

  describe('test_request_runs_needs_attention_reason_coherence', () => {
    it('requires a reason when status is needs_attention', () => {
      expect(satisfiesNeedsAttentionCoherence({ status: 'needs_attention', needsAttentionReason: 'stuck' })).toBe(true);
      expect(satisfiesNeedsAttentionCoherence({ status: 'needs_attention', needsAttentionReason: null })).toBe(false);
    });

    it('forbids a reason for every other status', () => {
      for (const status of STATUSES.filter((s) => s !== 'needs_attention')) {
        expect(satisfiesNeedsAttentionCoherence({ status, needsAttentionReason: null })).toBe(true);
        expect(satisfiesNeedsAttentionCoherence({ status, needsAttentionReason: 'stuck' })).toBe(false);
      }
    });
  });

  describe('test_request_runs_completed_at_coherence', () => {
    it('ready requires completed_at', () => {
      expect(satisfiesCompletedAtCoherence({ status: 'ready', completedAt: new Date() })).toBe(true);
      expect(satisfiesCompletedAtCoherence({ status: 'ready', completedAt: null })).toBe(false);
    });

    it('pre-terminal states forbid completed_at', () => {
      for (const status of ['prepared', 'creating', 'needs_attention']) {
        expect(satisfiesCompletedAtCoherence({ status, completedAt: new Date() })).toBe(false);
        expect(satisfiesCompletedAtCoherence({ status, completedAt: null })).toBe(true);
      }
    });

    it('retiring/retired admit either, so ready -> retiring and needs_attention -> retiring are both legal', () => {
      for (const status of ['retiring', 'retired']) {
        expect(satisfiesCompletedAtCoherence({ status, completedAt: new Date() })).toBe(true);
        expect(satisfiesCompletedAtCoherence({ status, completedAt: null })).toBe(true);
      }
    });
  });

  describe('test_request_runs_ready_request_number', () => {
    it('ready requires a destination request number; other states do not', () => {
      expect(satisfiesReadyRequestNumber({ status: 'ready', destinationRequestNumber: '1000340' })).toBe(true);
      expect(satisfiesReadyRequestNumber({ status: 'ready' })).toBe(false);
      expect(satisfiesReadyRequestNumber({ status: 'ready', destinationRequestNumber: '' })).toBe(false);
      expect(satisfiesReadyRequestNumber({ status: 'ready', destinationRequestNumber: 'abc' })).toBe(false);
      expect(satisfiesRequestNumberShape({ destinationRequestNumber: 'abc' })).toBe(false);
      expect(satisfiesRequestNumberShape({ destinationRequestNumber: '' })).toBe(false);
      expect(satisfiesRequestNumberShape({ destinationRequestNumber: null })).toBe(true);
      expect(satisfiesRequestNumberShape({ destinationRequestNumber: '1000340' })).toBe(true);
      for (const status of ['prepared', 'creating', 'needs_attention', 'retiring', 'retired']) {
        expect(satisfiesReadyRequestNumber({ status })).toBe(true);
      }
    });
  });

  describe('destination_environment enum', () => {
    it('accepts sandbox and production', () => {
      expect(isValidDestinationEnvironment('sandbox')).toBe(true);
      expect(isValidDestinationEnvironment('production')).toBe(true);
    });

    it('rejects anything else', () => {
      expect(isValidDestinationEnvironment('staging')).toBe(false);
    });
  });

  describe('resource_kind enum', () => {
    it.each([
      'dataverse_request', 'dataverse_request_patch', 'sharepoint_folder',
      'dataverse_document_location', 'sharepoint_file', 'workflow_bypass',
    ])('accepts %s', (kind) => {
      expect(isValidResourceKind(kind)).toBe(true);
    });

    it('rejects an unknown kind', () => {
      expect(isValidResourceKind('dataverse_delete')).toBe(false);
    });
  });

  describe('resource system enum', () => {
    it('accepts dataverse and sharepoint', () => {
      expect(isValidResourceSystem('dataverse')).toBe(true);
      expect(isValidResourceSystem('sharepoint')).toBe(true);
    });

    it('rejects anything else', () => {
      expect(isValidResourceSystem('graph')).toBe(false);
    });
  });

  describe('resource outcome enum', () => {
    it.each(RESOURCE_OUTCOMES)('accepts %s', (outcome) => {
      expect(isValidResourceOutcome(outcome)).toBe(true);
    });

    it('rejects an unknown outcome', () => {
      expect(isValidResourceOutcome('succeeded')).toBe(false);
    });
  });
});

describe('migration 054 real SQL contains the load-bearing predicates the pure-JS mirror assumes', () => {
  const migration = fs.readFileSync(
    path.join(process.cwd(), 'lib/db/migrations/054_test_request_runs.sql'),
    'utf8',
  );

  it('defines the status CHECK with all six states', () => {
    for (const status of STATUSES) {
      expect(migration).toContain(`'${status}'`);
    }
  });

  it('defines the needs_attention_reason coherence constraint', () => {
    expect(migration).toContain('test_request_runs_needs_attention_reason_coherence');
    expect(migration).toContain("status = 'needs_attention' AND needs_attention_reason IS NOT NULL");
    expect(migration).toContain("status <> 'needs_attention' AND needs_attention_reason IS NULL");
  });

  it('defines the ready-requires-request-number constraint', () => {
    expect(migration).toContain('test_request_runs_ready_request_number');
    // NULL ~ regex is NULL and a NULL CHECK passes, so the non-null test is explicit.
    expect(migration).toContain("status <> 'ready' OR (destination_request_number IS NOT NULL AND destination_request_number ~ '^[0-9]{1,10}$')");
    expect(migration).toContain('test_request_runs_request_number_shape');
    expect(migration).toContain("destination_request_number IS NULL OR destination_request_number ~ '^[0-9]{1,10}$'");
  });

  it('defines the completed_at coherence constraint', () => {
    expect(migration).toContain('test_request_runs_completed_at_coherence');
    expect(migration).toContain("(status = 'ready' AND completed_at IS NOT NULL)");
    expect(migration).toContain("(status IN ('prepared', 'creating', 'needs_attention') AND completed_at IS NULL)");
    expect(migration).toContain("OR status IN ('retiring', 'retired')");
  });

  it('defines the resource outcome CHECK with all eight outcomes', () => {
    for (const outcome of RESOURCE_OUTCOMES) {
      expect(migration).toContain(`'${outcome}'`);
    }
  });

  it('uses IF NOT EXISTS for both tables and both indexes', () => {
    expect((migration.match(/CREATE TABLE IF NOT EXISTS/g) || []).length).toBe(2);
    expect((migration.match(/CREATE INDEX IF NOT EXISTS/g) || []).length).toBe(3);
  });

  it('never stores credentials, bodies, or bundle contents (no such columns declared)', () => {
    // Column declarations only: the receipt function and the credential CHECKs
    // legitimately NAME the shapes they reject.
    const columnNames = migration
      .split('\n')
      .map((line) => line.match(/^\s{2}([a-z_]+)\s+(?:UUID|TEXT|INTEGER|BIGSERIAL|TIMESTAMPTZ|DATE|JSONB)\b/))
      .filter(Boolean)
      .map((match) => match[1]);
    expect(columnNames.length).toBeGreaterThan(40);
    expect(columnNames.join('\n')).not.toMatch(/credential|bearer|body|bundle_bytes|document|access_token|purpose|narrative/i);
  });

  it('enforces the receipt grammar in PostgreSQL (Codex round twelve): a receipt function guards all three JSONB columns', () => {
    expect(migration).toContain('CREATE OR REPLACE FUNCTION test_request_receipt_ok(receipt JSONB)');
    expect(migration).toContain('planned_identity  JSONB NOT NULL CHECK (test_request_receipt_ok(planned_identity))');
    expect(migration).toContain('source_provenance JSONB NULL CHECK (test_request_receipt_ok(source_provenance))');
    expect(migration).toContain('readback          JSONB NULL CHECK (test_request_receipt_ok(readback))');
    for (const key of LEDGER_RECEIPT_KEYS) expect(migration).toContain(`'${key}'`);
    // Credential prefixes are excluded at the run level too, inside the b! wrapper.
    expect(migration).toContain("expected_graph_drive_id !~ '^(b!)?(gh[pousr]_|github_pat_|sk-|xox[abprs]-|AKIA[0-9A-Z]{16}|eyJ[A-Za-z0-9_-]{8}|glpat-|AIza|Bearer_)'");
    // The fresh-install mirror carries the identical function body.
    const setupSql = fs.readFileSync(path.join(process.cwd(), 'scripts/setup-database.js'), 'utf8');
    const fnBody = (sql) => {
      const start = sql.indexOf('CREATE OR REPLACE FUNCTION test_request_receipt_ok');
      const end = sql.indexOf('$receipt$', sql.indexOf('$receipt$', start) + 9);
      expect(start).toBeGreaterThan(-1);
      expect(end).toBeGreaterThan(start);
      return sql.slice(start, end).replace(/\s+/g, ' ').trim();
    };
    expect(fnBody(setupSql)).toBe(fnBody(migration));
    expect(fnBody(migration)).not.toContain('\\');
  });

  it('enforces the JS text grammars in PostgreSQL (Codex round eleven): every grammar-bound column has a CHECK', () => {
    for (const name of [
      'test_request_runs_actor_id_shape', 'test_request_runs_idempotency_key_digest', 'test_request_runs_current_step_enum',
      'test_request_runs_recipe_enum', 'test_request_runs_host_shapes', 'test_request_runs_source_shapes',
      'test_request_runs_digest_shapes', 'test_request_runs_graph_identity_shapes', 'test_request_runs_fiscal_year_shape',
      'test_request_runs_test_label_derived', 'test_request_runs_reason_codes',
      'test_request_run_resources_step_enum', 'test_request_run_resources_error_code',
    ]) {
      expect(migration).toContain(`CONSTRAINT ${name}`);
    }
    expect(migration).toContain("expected_graph_drive_id ~ '^b![A-Za-z0-9_-]{16,120}$'");
    expect(migration).toContain("idempotency_key ~ '^[0-9a-f]{64}$'");
    // The SQL enum lists are generated from the JS exports; both step and reason sets must appear in full.
    for (const step of LEDGER_STEPS) expect(migration).toContain(`'${step}'`);
    for (const code of LEDGER_REASON_CODES) expect(migration).toContain(`'${code}'`);
  });
});

describe('migrations manifest lists 054 last and its setup-database.js mirror matches', () => {
  const manifest = JSON.parse(fs.readFileSync(
    path.join(process.cwd(), 'lib/db/migrations-manifest.json'),
    'utf8',
  ));

  it('has 054_test_request_runs.sql as the last entry', () => {
    expect(manifest.files[manifest.files.length - 1]).toBe('054_test_request_runs.sql');
  });

  function normalize(sql) {
    return sql.replace(/\s+/g, ' ').trim();
  }

  function extractCreateTableBodies(sql) {
    const bodies = [];
    const regex = /CREATE TABLE IF NOT EXISTS\s+(\w+)\s*\(/g;
    let match;
    while ((match = regex.exec(sql)) !== null) {
      const tableName = match[1];
      const start = match.index + match[0].length;
      let depth = 1;
      let i = start;
      while (i < sql.length && depth > 0) {
        if (sql[i] === '(') depth += 1;
        else if (sql[i] === ')') depth -= 1;
        i += 1;
      }
      bodies.push({ tableName, body: normalize(sql.slice(start, i - 1)) });
    }
    return bodies;
  }

  it('setup-database.js V55 mirror has the same CREATE TABLE bodies as migration 054', () => {
    const migrationSql = fs.readFileSync(
      path.join(process.cwd(), 'lib/db/migrations/054_test_request_runs.sql'),
      'utf8',
    );
    const setupSql = fs.readFileSync(
      path.join(process.cwd(), 'scripts/setup-database.js'),
      'utf8',
    );

    const migrationTables = extractCreateTableBodies(migrationSql);
    expect(migrationTables.map((t) => t.tableName)).toEqual([
      'test_request_runs',
      'test_request_run_resources',
    ]);

    // Isolate the v55Statements array text in setup-database.js so we don't
    // accidentally match some other migration's mirrored CREATE TABLE.
    const v55Start = setupSql.indexOf('const v55Statements = [');
    expect(v55Start).toBeGreaterThan(-1);
    const v55End = setupSql.indexOf('\n];', v55Start);
    const v55Text = setupSql.slice(v55Start, v55End);

    const setupTables = extractCreateTableBodies(v55Text);
    expect(setupTables.map((t) => t.tableName)).toEqual([
      'test_request_runs',
      'test_request_run_resources',
    ]);

    for (let i = 0; i < migrationTables.length; i++) {
      expect(setupTables[i].body).toBe(migrationTables[i].body);
    }
  });
});
