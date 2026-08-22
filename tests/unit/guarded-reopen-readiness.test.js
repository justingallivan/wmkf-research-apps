import {
  GUARDED_REOPEN_SCHEMA_READY_FLAG,
  isGuardedReopenSchemaReady,
} from '../../lib/utils/guarded-reopen-readiness.js';
import {
  GUARDED_REOPEN_SELECT_FIELDS,
  requestDocumentSelect,
} from '../../lib/dataverse/adapters/request-document.js';

test('only the literal on enables guarded-reopen schema access', () => {
  for (const value of [undefined, '', 'off', 'true', 'ON', 'invalid']) {
    expect(isGuardedReopenSchemaReady({
      ...(value === undefined ? {} : { [GUARDED_REOPEN_SCHEMA_READY_FLAG]: value }),
    })).toBe(false);
  }
  expect(isGuardedReopenSchemaReady({
    [GUARDED_REOPEN_SCHEMA_READY_FLAG]: 'on',
  })).toBe(true);
});

test('adapter excludes Wave 20 fields until readiness is explicit', () => {
  const base = requestDocumentSelect({ includeGuardedReopen: false }).split(',');
  const ready = requestDocumentSelect({ includeGuardedReopen: true }).split(',');

  for (const field of GUARDED_REOPEN_SELECT_FIELDS) {
    expect(base).not.toContain(field);
    expect(ready).toContain(field);
  }
});
