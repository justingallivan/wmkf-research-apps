/**
 * @jest-environment node
 *
 * shared/config/granteeDeliverableStatus — value/label integrity,
 * isValidGranteeDeliverableValue, and parity with the Dataverse wave JSON
 * (the two are declared the source of truth for each other and MUST stay in sync).
 */
import fs from 'fs';
import path from 'path';
import {
  GRANTEE_DELIVERABLE_STATUS,
  GRANTEE_DELIVERABLE_LABEL,
  isValidGranteeDeliverableValue,
} from '../../shared/config/granteeDeliverableStatus';

test('values are the agreed numeric option-set codes (contiguous 100000000..100000007)', () => {
  expect(GRANTEE_DELIVERABLE_STATUS.DRAFTED).toBe(100000000);
  expect(GRANTEE_DELIVERABLE_STATUS.INVITED).toBe(100000001);
  expect(GRANTEE_DELIVERABLE_STATUS.REMINDER_SENT).toBe(100000002);
  expect(GRANTEE_DELIVERABLE_STATUS.SUBMITTED).toBe(100000003);
  expect(GRANTEE_DELIVERABLE_STATUS.STAFF_REVIEW).toBe(100000004);
  expect(GRANTEE_DELIVERABLE_STATUS.REVISION_REQUESTED).toBe(100000005);
  expect(GRANTEE_DELIVERABLE_STATUS.COMPLETE).toBe(100000006);
  expect(GRANTEE_DELIVERABLE_STATUS.CLOSED_NO_RESPONSE).toBe(100000007);
});

test('every value has a non-empty label and values are unique', () => {
  const values = Object.values(GRANTEE_DELIVERABLE_STATUS);
  for (const v of values) {
    expect(typeof GRANTEE_DELIVERABLE_LABEL[v]).toBe('string');
    expect(GRANTEE_DELIVERABLE_LABEL[v].length).toBeGreaterThan(0);
  }
  expect(new Set(values).size).toBe(values.length);
});

test('isValidGranteeDeliverableValue accepts option values (number and numeric string)', () => {
  expect(isValidGranteeDeliverableValue(100000000)).toBe(true);
  expect(isValidGranteeDeliverableValue(100000007)).toBe(true);
  expect(isValidGranteeDeliverableValue('100000003')).toBe(true);
});

test('isValidGranteeDeliverableValue rejects null/undefined/empty (clearing is not settable here)', () => {
  expect(isValidGranteeDeliverableValue(null)).toBe(false);
  expect(isValidGranteeDeliverableValue(undefined)).toBe(false);
  expect(isValidGranteeDeliverableValue('')).toBe(false);
});

test('isValidGranteeDeliverableValue rejects out-of-set and non-integer values', () => {
  expect(isValidGranteeDeliverableValue(999)).toBe(false);
  expect(isValidGranteeDeliverableValue(0)).toBe(false);
  expect(isValidGranteeDeliverableValue(100000003.5)).toBe(false);
  expect(isValidGranteeDeliverableValue('abc')).toBe(false);
  expect(isValidGranteeDeliverableValue({})).toBe(false);
});

test('config option set matches the Dataverse wave JSON exactly (source-of-truth parity)', () => {
  const waveJson = JSON.parse(fs.readFileSync(
    path.join(__dirname, '..', '..', 'lib', 'dataverse', 'schema', 'wave3-grantee-deliverable-table', 'wmkf_granteedeliverable.json'),
    'utf8',
  ));
  const statusAttr = waveJson.attributes.find((a) => a.schemaName === 'wmkf_DeliverableStatus');
  expect(statusAttr).toBeDefined();

  const jsonOptions = new Map(statusAttr.options.map((o) => [o.value, o.label]));
  const configOptions = new Map(
    Object.values(GRANTEE_DELIVERABLE_STATUS).map((v) => [v, GRANTEE_DELIVERABLE_LABEL[v]]),
  );

  // Same number of options, same value→label mapping both directions.
  expect(jsonOptions.size).toBe(configOptions.size);
  for (const [value, label] of configOptions) {
    expect(jsonOptions.get(value)).toBe(label);
  }
  for (const [value, label] of jsonOptions) {
    expect(configOptions.get(value)).toBe(label);
  }
});
