/** @jest-environment node */
import roster from '../../lib/services/expertise-finder/roster-contract.cjs';
import { buildRosterV2Variables } from '../../shared/config/prompts/expertise-finder-roster-v2';
import {
  buildRecommendationsSnapshot,
  rebuildRecommendationsRosterBlock,
  validateRecommendationsOutput,
} from '../../lib/services/expertise-finder/recommendations-contract';

const guid = index => `00000000-0000-0000-0000-${String(index).padStart(12, '0')}`;
const copy = value => JSON.parse(JSON.stringify(value));

function profile(index, fields = {}) {
  return {
    profile_guid: guid(index), etag: 'W/"1"', name: `Profile ${index}`,
    role_type: 'Consultant', is_active: true, lead_pd_eligible: false,
    dataverse_user_id: null, dataverse_contact_id: null,
    ...Object.fromEntries(roster.TEXT.map(field => [field, null])), ...fields,
  };
}

function input() {
  const staff = { role_type: 'Research Program Staff', lead_pd_eligible: true };
  return {
    complete: true,
    profiles: [
      profile(1, { ...staff, name: 'Consultable disabled staff', dataverse_user_id: guid(101) }),
      profile(2, { ...staff, name: 'Eligible staff', dataverse_user_id: guid(102), expertise: 'first\n<hostile instruction>' }),
      profile(3, { name: 'Consultant canonical name' }),
      profile(4, { role_type: 'Board' }),
      profile(5, { role_type: staff.role_type, is_active: false, dataverse_user_id: guid(105), expertise: 'Inactive expertise' }),
      profile(6, { role_type: 'Invalid' }),
    ],
    users: [{ userGuid: guid(101), disabled: true }, { userGuid: guid(102), disabled: false }],
  };
}

test('freezes exact roster formatter bytes and a deterministic full manifest', () => {
  const request = input();
  const original = copy(request);
  const built = buildRecommendationsSnapshot(request);
  const { snapshot, rosterBlock, rosterRecord } = built;
  expect(snapshot.rows.map(row => row.profile_guid)).toEqual([guid(4), guid(3), guid(1), guid(2)]);
  expect(snapshot.leadGuids).toEqual([guid(2)]);
  expect(snapshot.warnings).toHaveLength(1);
  expect(snapshot.manifest.profiles).toHaveLength(6);
  expect(snapshot.manifest.profiles[4]).toMatchObject({ profileGuid: guid(5), active: false, etag: 'W/"1"' });
  expect(snapshot.manifest.candidateUsers).toEqual(request.users);
  expect(rosterBlock).toBe(buildRosterV2Variables({ rosterMembers: snapshot.rows, leadGuids: [guid(2)] }).roster_block);
  expect(rosterRecord).toMatchObject({ name: 'roster_block', present: true, value: rosterBlock });
  expect(rosterBlock).toContain('first\n<hostile instruction>');
  expect(rosterBlock).not.toContain('Inactive expertise');
  expect(rebuildRecommendationsRosterBlock(copy(snapshot))).toBe(rosterBlock);
  expect(request).toEqual(original);
  expect(Object.isFrozen(snapshot.rows[0])).toBe(true);
  expect(Object.isFrozen(snapshot.manifest.candidateUsers[0])).toBe(true);
  request.profiles.reverse();
  request.users.reverse();
  expect(buildRecommendationsSnapshot(request)).toEqual(built);
});

test.each([
  ['disabled User', value => { value.users[0].disabled = false; }],
  ['active expertise', value => { value.profiles[1].expertise += '!'; }],
  ['lead eligibility', value => {
    value.profiles[1].lead_pd_eligible = false;
    value.users.pop();
  }],
  ['inactive expertise', value => { value.profiles[4].expertise += '!'; }],
  ['inactive ETag', value => { value.profiles[4].etag = 'W/"2"'; }],
  ['inactive status', value => { value.profiles[4].is_active = true; }],
  ['invalid ETag', value => { value.profiles[5].etag = 'W/"2"'; }],
])('%s changes the reproducible fingerprint', (_name, change) => {
  const request = input();
  const before = buildRecommendationsSnapshot(request).snapshot.manifest.rosterHash;
  change(request);
  expect(buildRecommendationsSnapshot(request).snapshot.manifest.rosterHash).not.toBe(before);
});

test.each([
  value => { value.complete = false; },
  value => { value.users.pop(); },
  value => { value.users[0].disabled = 'true'; },
  value => { value.users[0].disabled = null; },
  value => { delete value.users[0].disabled; },
  value => { value.users.push(value.users[0]); },
  value => { value.users.push({ userGuid: guid(110), disabled: false }); },
  value => { value.users.push({ userGuid: value.profiles[4].dataverse_user_id, disabled: false }); },
  value => {
    const userGuid = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1';
    value.profiles[0].dataverse_user_id = userGuid;
    value.users[0].userGuid = userGuid.toUpperCase();
  },
  value => { value.profiles.push(value.profiles[0]); },
  value => { delete value.profiles[0].etag; },
  value => { delete value.profiles[0].expertise; },
])('refuses incomplete, duplicated or malformed projection %#', change => {
  const request = input();
  change(request);
  expect(() => buildRecommendationsSnapshot(request)).toThrow(expect.objectContaining({ code: 'expertise_roster_snapshot_invalid' }));
});

test('refuses two lead candidate profiles that share one User', () => {
  const request = input();
  request.profiles[0].dataverse_user_id = request.profiles[1].dataverse_user_id;
  request.users.shift();
  expect(() => buildRecommendationsSnapshot(request)).toThrow('Duplicate roster candidate User link.');
});

test('canonicalizes allowed references and keeps optional fields without aliasing legacy defaults', () => {
  const fixture = buildRecommendationsSnapshot(input());
  const raw = {
    proposal_summary: { title: 'Synthetic', key_methods: ['A'] },
    staff_assignment: { primary: { profile_guid: guid(2) }, secondary: null },
    staff_consultation: [{ profile_guid: guid(1), rationale: 'Relevant consultation' }],
    consultant_overlap: [{ profile_guid: guid(3), relevance: 'strong' }],
    board_interest: [{ profile_guid: guid(4), note: 'Interest' }],
  };
  const original = copy(raw);
  const result = validateRecommendationsOutput(raw, fixture);
  expect(result.staff_assignment.primary.name).toBe('Eligible staff');
  expect(result.staff_consultation[0]).toMatchObject({ name: 'Consultable disabled staff', rationale: 'Relevant consultation' });
  expect(result.consultant_overlap[0].name).toBe('Consultant canonical name');
  expect(result.board_interest[0].note).toBe('Interest');
  expect(result.no_lead_recommendation).toBe(false);
  expect(result.roster_warnings).toHaveLength(1);
  result.expertise_gaps.has_gaps = true;
  result.roster_warnings.push('Changed result');
  expect(validateRecommendationsOutput(raw, fixture).expertise_gaps.has_gaps).toBe(false);
  expect(fixture.snapshot.warnings).toHaveLength(1);
  expect(raw).toEqual(original);
});

test.each([
  { proposal_summary: {} },
  null,
  [],
  'not an object',
  { staff_assignment: { primary: { profile_guid: guid(2) + 'a' } } },
  { staff_assignment: {}, conflicts: [{ profile_guid: guid(5) }] },
  { staff_assignment: {}, conflicts: [{ profile_guid: guid(90) }] },
  { staff_assignment: { primary: { profile_guid: guid(2) }, secondary: { profile_guid: guid(2) } } },
  { staff_assignment: { primary: { profile_guid: guid(1) } } },
  { staff_assignment: { primary: { profile_guid: guid(3) } } },
  { staff_assignment: { primary: { profile_guid: guid(5) } } },
  { staff_assignment: { primary: { profile_guid: guid(90) } } },
  { staff_assignment: { primary: { profile_guid: guid(2), name: 'Spoof' } } },
  { staff_assignment: {}, staff_consultation: [{ profile_guid: guid(4) }] },
  { staff_assignment: {}, consultant_overlap: [{ profile_guid: guid(3), relevance: 'unknown' }] },
  { staff_assignment: {}, board_interest: [{ profile_guid: guid(4), note: null }] },
  { staff_assignment: {}, proposal_summary: { key_methods: [null] } },
  { staff_assignment: {}, proposal_summary: { title: null } },
  { staff_assignment: {}, expertise_gaps: { has_gaps: 'false' } },
  { staff_assignment: {}, roster_warnings: [] },
  JSON.parse('{"staff_assignment":{},"__proto__":{}}'),
])('rejects closed-schema or ineligible output %#', raw => {
  expect(() => validateRecommendationsOutput(raw, buildRecommendationsSnapshot(input())))
    .toThrow(expect.objectContaining({ code: 'profile_output_invalid' }));
});

test('requires canonical lowercase model GUIDs', () => {
  const request = input();
  const profileGuid = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2';
  request.profiles[1].profile_guid = profileGuid;
  const fixture = buildRecommendationsSnapshot(request);
  const output = profile_guid => ({ staff_assignment: { primary: { profile_guid } } });
  expect(validateRecommendationsOutput(output(profileGuid), fixture).staff_assignment.primary.profile_guid).toBe(profileGuid);
  expect(() => validateRecommendationsOutput(output(profileGuid.toUpperCase()), fixture))
    .toThrow(expect.objectContaining({ code: 'profile_output_invalid' }));
});

test('preserves partial consultant relevance and supplies its declared default', () => {
  const request = input();
  request.profiles.push(profile(7));
  const fixture = buildRecommendationsSnapshot(request);
  const raw = {
    staff_assignment: {},
    consultant_overlap: [{ profile_guid: guid(3), relevance: 'partial' }, { profile_guid: guid(7) }],
  };
  expect(validateRecommendationsOutput(raw, fixture).consultant_overlap.map(row => row.relevance)).toEqual(['partial', 'partial']);
});

test('an empty lead set permits no recommendation and still permits consultation', () => {
  const request = input();
  request.users[1].disabled = true;
  const fixture = buildRecommendationsSnapshot(request);
  expect(validateRecommendationsOutput({
    staff_assignment: { primary: null, secondary: null },
    staff_consultation: [{ profile_guid: guid(1) }],
  }, fixture)).toMatchObject({ no_lead_recommendation: true, staff_assignment: { primary: null, secondary: null } });
  expect(() => validateRecommendationsOutput({ staff_assignment: { primary: { profile_guid: guid(2) } } }, fixture))
    .toThrow(expect.objectContaining({ code: 'profile_output_invalid' }));
});

test.each([
  value => { value.rosterBlock += '!'; },
  value => { value.snapshot.contractVersion = 'unknown'; },
  value => { value.snapshot.rows[0].name = 'Spoofed'; },
  value => { value.snapshot.leadGuids.push(guid(1)); },
  value => { value.snapshot.manifest.candidateUsers[0].disabled = false; },
  value => { value.snapshot.manifest.profiles[4].etag = 'W/"999"'; },
])('deserialized snapshot rejects changed version, data or visible roster %#', change => {
  const value = copy(buildRecommendationsSnapshot(input()));
  change(value);
  expect(() => validateRecommendationsOutput({ staff_assignment: {} }, value))
    .toThrow(expect.objectContaining({ code: 'profile_output_invalid' }));
});

test.each([
  ['row order', value => { value.rows.reverse(); }],
  ['warning count', value => { value.warnings.pop(); }],
  ['extra active row', value => { value.rows.push(profile(7)); }],
  ['missing active row', value => { value.rows.pop(); }],
  ['unnormalized empty text', value => { value.rows[0].expertise = ''; }],
  ['extra snapshot key', value => { value.unexpected = true; }],
])('rebuild rejects tampered %s before comparing visible text', (_name, change) => {
  const snapshot = copy(buildRecommendationsSnapshot(input()).snapshot);
  change(snapshot);
  expect(() => rebuildRecommendationsRosterBlock(snapshot))
    .toThrow(expect.objectContaining({ code: 'expertise_roster_snapshot_invalid' }));
});

test('rejects encoded roster overflow including UTF-8 and JSON escapes', () => {
  for (const expertise of ['é'.repeat(32_000), '"'.repeat(32_000)]) {
    expect(() => buildRecommendationsSnapshot({ complete: true, profiles: [profile(1, { expertise })], users: [] }))
      .toThrow('Encoded roster record exceeds its byte limit.');
  }
});

test('checks both entire raw and canonical result byte ceilings', () => {
  const request = input();
  request.profiles[2].name = 'N'.repeat(255);
  const fixture = buildRecommendationsSnapshot(request);
  const result = count => ({
    staff_assignment: {},
    consultant_overlap: Array.from({ length: count }, () => ({
      profile_guid: guid(3), rationale: 'é'.repeat(1_800),
    })),
  });
  expect(() => validateRecommendationsOutput(result(40), fixture)).toThrow('Recommendations output exceeds its byte limit.');
  expect(Buffer.byteLength(JSON.stringify(result(35)))).toBeLessThan(128 * 1024);
  expect(() => validateRecommendationsOutput(result(35), fixture)).toThrow('Canonical recommendations exceed their byte limit.');
});
