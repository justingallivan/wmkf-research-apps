import {
  FINAL_WRITEUP_ACKNOWLEDGEMENT_SCHEMA_READY_FLAG,
  isFinalWriteupAcknowledgementSchemaReady,
} from '../../lib/utils/final-writeup-acknowledgement-readiness.js';

test('only literal on enables the Wave 23 acknowledgement runtime', () => {
  for (const value of [undefined, '', 'off', 'true', 'ON', 'active', 'invalid']) {
    expect(isFinalWriteupAcknowledgementSchemaReady({
      ...(value === undefined
        ? {}
        : { [FINAL_WRITEUP_ACKNOWLEDGEMENT_SCHEMA_READY_FLAG]: value }),
    })).toBe(false);
  }
  expect(isFinalWriteupAcknowledgementSchemaReady({
    [FINAL_WRITEUP_ACKNOWLEDGEMENT_SCHEMA_READY_FLAG]: 'on',
  })).toBe(true);
});
