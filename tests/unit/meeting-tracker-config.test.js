import { readFileSync } from 'fs';
import { resolve } from 'path';
import {
  DELIBERATION_SESSION_STATUS,
  DELIBERATION_SESSION_STATUS_LABEL,
  MEETING_TRACKER_DEFAULTS,
  MEETING_TRACKER_SCHEMA_READY_FLAG,
  isMeetingTrackerSchemaReady,
} from '../../shared/config/meetingTracker';

test('Meeting Tracker readiness requires literal on', () => {
  for (const value of [undefined, '', 'off', 'ON', 'true', 'on\n']) {
    expect(isMeetingTrackerSchemaReady(value === undefined
      ? {}
      : { [MEETING_TRACKER_SCHEMA_READY_FLAG]: value })).toBe(false);
  }
  expect(isMeetingTrackerSchemaReady({
    [MEETING_TRACKER_SCHEMA_READY_FLAG]: 'on',
  })).toBe(true);
});

test('session status labels and scheduling defaults match the Wave 28 contract', () => {
  expect(DELIBERATION_SESSION_STATUS).toEqual({
    PLANNED: 100000000,
    HELD: 100000001,
    CANCELLED: 100000002,
  });
  expect(DELIBERATION_SESSION_STATUS_LABEL).toEqual({
    100000000: 'Planned',
    100000001: 'Held',
    100000002: 'Cancelled',
  });
  expect(MEETING_TRACKER_DEFAULTS).toEqual({ sessionMinutes: 90, slotMinutes: 15 });

  const schema = JSON.parse(readFileSync(resolve(
    process.cwd(),
    'lib/dataverse/schema/wave28-meeting-tracker/wmkf_deliberationsession.json',
  ), 'utf8'));
  const options = schema.attributes
    .find((attribute) => attribute.schemaName === 'wmkf_Status')
    .options
    .map(({ value, label }) => [value, label]);
  expect(Object.fromEntries(options)).toEqual(DELIBERATION_SESSION_STATUS_LABEL);
});

test('Wave 28 preserves repeat scheduling and explicit app actor attribution', () => {
  const readSpec = (filename) => JSON.parse(readFileSync(resolve(
    process.cwd(),
    'lib/dataverse/schema/wave28-meeting-tracker',
    filename,
  ), 'utf8'));
  const session = readSpec('wmkf_deliberationsession.json');
  const slot = readSpec('wmkf_deliberationslot.json');

  expect(session.alternateKeys).toEqual([]);
  expect(slot.alternateKeys).toEqual([]);
  expect(slot.relationships.find((relationship) => (
    relationship.lookupSchemaName === 'wmkf_Request'
  ))).toMatchObject({ referencedEntity: 'akoya_request', required: 'ApplicationRequired' });
  for (const spec of [session, slot]) {
    expect(spec.relationships.find((relationship) => (
      relationship.lookupSchemaName === 'wmkf_UpdatedBy'
    ))).toMatchObject({ referencedEntity: 'systemuser', required: 'ApplicationRequired' });
  }
});
