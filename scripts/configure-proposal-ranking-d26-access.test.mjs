import test from 'node:test';
import assert from 'node:assert/strict';
import {
  isSystemUserGuid,
  parseArgs,
  rosterFingerprint,
  validateProfileMapping,
} from './configure-proposal-ranking-d26-access.mjs';

test('operator command defaults to dry-run and requires explicit Production selection', () => {
  assert.deepEqual(parseArgs(['node', 'script', '--target=production']), {
    apply: false,
    expectedRosterHash: null,
    target: 'production',
  });
  assert.throws(() => parseArgs(['node', 'script']), /Pass exactly --target=production/);
});

test('apply requires a reviewed dry-run hash and rejects an unused hash', () => {
  assert.throws(
    () => parseArgs(['node', 'script', '--target=production', '--apply']),
    /requires --expected-roster-sha256/,
  );
  assert.throws(
    () => parseArgs(['node', 'script', '--target=production', `--expected-roster-sha256=${'a'.repeat(64)}`]),
    /accepted only with --apply/,
  );
  assert.equal(parseArgs(['node', 'script', '--target=production', '--apply', `--expected-roster-sha256=${'a'.repeat(64)}`]).apply, true);
});

test('system user validation accepts only canonical GUID shape', () => {
  assert.equal(isSystemUserGuid('53e97fb3-a006-f111-8406-000d3a352682'), true);
  assert.equal(isSystemUserGuid('53e97fb3-a006-f111-8406-000d3a352682x'), false);
  assert.equal(isSystemUserGuid('53e97fb3-a006-f111-8406-000d3a35268'), false);
  assert.equal(isSystemUserGuid(null), false);
});

test('profile mapping rejects inactive, duplicate, and reverse-map-conflicting rows', () => {
  const row = { id: 7, name: 'staff-profile', is_active: true, needs_linking: false, dynamics_systemuser_id: 'user-id' };
  assert.deepEqual(validateProfileMapping([row], 7, 'user-id'), { profileId: 7, profileName: 'staff-profile' });
  assert.throws(() => validateProfileMapping([row, row], 7, 'user-id'), /missing_or_ambiguous/);
  assert.throws(() => validateProfileMapping([{ ...row, is_active: false }], 7, 'user-id'), /mapping_invalid/);
  assert.throws(() => validateProfileMapping([row], 8, 'user-id'), /canonical_profile_mapping_disagrees/);
  assert.throws(() => validateProfileMapping([row], 7, 'other-id'), /mapping_invalid/);
});

test('roster fingerprint binds request identities, participant mappings, and facilitator identity', () => {
  const requests = [{
    akoya_requestid: 'request-guid',
    akoya_requestnum: '1001000',
    wmkf_meetingdate: '2026-12-01T00:00:00Z',
    _akoya_programid_value: 'program-guid',
    _wmkf_programdirector_value: 'user-guid',
  }];
  const participants = [{ systemUserId: 'user-guid', profileId: 7 }];
  const facilitator = { systemUserId: 'facilitator-guid', profileId: 8 };
  const baseline = rosterFingerprint(requests, participants, facilitator);
  assert.equal(rosterFingerprint(requests, participants, facilitator), baseline);
  assert.notEqual(rosterFingerprint(requests, [{ systemUserId: 'user-guid', profileId: 9 }], facilitator), baseline);
  assert.notEqual(rosterFingerprint(requests, participants, { systemUserId: 'other-guid', profileId: 8 }), baseline);
});
