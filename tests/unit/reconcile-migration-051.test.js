/** @jest-environment node */

const {
  trackerDiff,
  assertTrackerStage,
  validateMeasurementSchema,
  assertMeasurementDisabled,
  cleanupObsolete038,
  _constants,
} = require('../../scripts/reconcile-migration-051');
const manifest = require('../../lib/db/migrations-manifest.json');

const { MIGRATION_038, MIGRATION_045, MIGRATION_051, EXPECTED_COLUMNS, EXPECTED_CHECK_LITERALS } = _constants;

function rows(names) {
  return names.map((name) => ({ name, applied_at: new Date('2026-09-15T00:00:00Z'), applied_by: 'test' }));
}

function postApplyRows() {
  return rows([...manifest.files, MIGRATION_038]);
}

function validSchema() {
  const columns = EXPECTED_COLUMNS.map(([column_name, data_type, is_nullable, character_maximum_length, defaultFragment]) => ({
    column_name,
    data_type,
    is_nullable,
    character_maximum_length,
    column_default: defaultFragment === 'nextval' ? "nextval('measurement_id_seq'::regclass)" : defaultFragment,
  }));
  const constraints = [
    { contype: 'p', definition: 'PRIMARY KEY (id)' },
    ...Object.entries(EXPECTED_CHECK_LITERALS).map(([column, literals]) => ({
      contype: 'c',
      definition: `CHECK (${column} IN (${literals.map((value) => `'${value}'`).join(', ')}))`,
    })),
  ];
  const indexes = [
    { indexname: 'idx_reviewer_institution_measurement_created', indexdef: 'CREATE INDEX x ON public.t USING btree (created_at)' },
    { indexname: 'idx_reviewer_institution_measurement_case', indexdef: 'CREATE INDEX y ON public.t USING btree (case_key, created_at)' },
  ];
  return { columns, constraints, indexes, rowCount: 0 };
}

test('tracker stages distinguish the expected missing, extra-only, and exact states', () => {
  const preflight = rows([...manifest.files.filter((name) => name !== MIGRATION_051), MIGRATION_038]);
  expect(assertTrackerStage('preflight', preflight)).toMatchObject({ missing: [MIGRATION_051], extra: [MIGRATION_038] });
  expect(assertTrackerStage('post-apply', postApplyRows())).toMatchObject({ missing: [], extra: [MIGRATION_038] });
  expect(assertTrackerStage('final', rows(manifest.files))).toMatchObject({ missing: [], extra: [] });
  expect(trackerDiff(postApplyRows()).trackedCount).toBe(manifest.files.length + 1);
});

test('tracker cleanup preconditions fail closed on any sibling mismatch', () => {
  expect(() => assertTrackerStage('preflight', rows(manifest.files))).toThrow(/precondition failed/);
  expect(() => assertTrackerStage('post-apply', rows(manifest.files))).toThrow(/extra=none/);
  expect(() => assertTrackerStage('final', postApplyRows())).toThrow(/extra=038_cycle_dossiers/);
  expect(() => assertTrackerStage('post-apply', rows([...manifest.files.filter((name) => name !== MIGRATION_045), MIGRATION_038]))).toThrow(/045 and 051/);
});

test('measurement schema verifier rejects rows, missing constraints, and column drift', () => {
  expect(validateMeasurementSchema(validSchema())).toEqual([]);
  const withRows = validSchema();
  withRows.rowCount = 1;
  expect(validateMeasurementSchema(withRows)).toContain('expected empty measurement table, found 1 rows');
  const missingCheck = validSchema();
  missingCheck.constraints = missingCheck.constraints.filter((constraint) => !constraint.definition.includes('proposed_action'));
  expect(validateMeasurementSchema(missingCheck).join(' ')).toMatch(/proposed_action/);
  const changedColumn = validSchema();
  changedColumn.columns[1].character_maximum_length = 32;
  expect(validateMeasurementSchema(changedColumn)).toContain('column 2 does not match case_key');
});

test('exact-on measurement is the only rejected flag value', () => {
  expect(() => assertMeasurementDisabled({ REVIEWER_INSTITUTION_MEASUREMENT: 'on' })).toThrow(/exact-on/);
  expect(() => assertMeasurementDisabled({ REVIEWER_INSTITUTION_MEASUREMENT: 'off' })).not.toThrow();
  expect(() => assertMeasurementDisabled({})).not.toThrow();
});

test('cleanup deletes only obsolete 038 and commits only after exact final parity', async () => {
  const query = jest.fn();
  query
    .mockResolvedValueOnce({}) // BEGIN
    .mockResolvedValueOnce({}) // LOCK
    .mockResolvedValueOnce({ rows: postApplyRows() }) // SELECT FOR UPDATE
    .mockResolvedValueOnce({ rowCount: 1, rows: rows([MIGRATION_038]) }) // DELETE
    .mockResolvedValueOnce({ rows: rows(manifest.files) }) // final SELECT
    .mockResolvedValueOnce({}); // COMMIT
  const result = await cleanupObsolete038({ query });
  expect(result.deleted.name).toBe(MIGRATION_038);
  expect(query.mock.calls[3]).toEqual([
    'DELETE FROM schema_migrations WHERE name = $1 RETURNING name, applied_at, applied_by',
    [MIGRATION_038],
  ]);
  expect(query.mock.calls.at(-1)[0]).toBe('COMMIT');
});

test('cleanup rolls back when the exact delete does not affect one row', async () => {
  const query = jest.fn();
  query
    .mockResolvedValueOnce({})
    .mockResolvedValueOnce({})
    .mockResolvedValueOnce({ rows: postApplyRows() })
    .mockResolvedValueOnce({ rowCount: 0, rows: [] })
    .mockResolvedValueOnce({});
  await expect(cleanupObsolete038({ query })).rejects.toThrow(/deleted 0/);
  expect(query.mock.calls.at(-1)[0]).toBe('ROLLBACK');
});
