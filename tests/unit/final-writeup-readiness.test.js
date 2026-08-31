import {
  FINAL_WRITEUP_SCHEMA_READY_FLAG,
  isFinalWriteupSchemaReady,
} from '../../lib/utils/final-writeup-readiness.js';
import {
  FINAL_WRITEUP_SELECT_FIELDS,
  requestDocumentSelect,
} from '../../lib/dataverse/adapters/request-document.js';

test('only the literal on enables Final Writeup schema access', () => {
  for (const value of [undefined, '', 'off', 'true', 'ON', 'invalid']) {
    expect(isFinalWriteupSchemaReady({
      ...(value === undefined ? {} : { [FINAL_WRITEUP_SCHEMA_READY_FLAG]: value }),
    })).toBe(false);
  }
  expect(isFinalWriteupSchemaReady({
    [FINAL_WRITEUP_SCHEMA_READY_FLAG]: 'on',
  })).toBe(true);
});

test('adapter excludes Wave 22 fields until readiness is explicit', () => {
  const base = requestDocumentSelect({
    includeGuardedReopen: false,
    includeFinalWriteup: false,
  }).split(',');
  const ready = requestDocumentSelect({
    includeGuardedReopen: false,
    includeFinalWriteup: true,
  }).split(',');

  for (const field of FINAL_WRITEUP_SELECT_FIELDS) {
    expect(base).not.toContain(field);
    expect(ready).toContain(field);
  }
});
