/** @jest-environment node */
import roster from '../../lib/services/expertise-finder/roster-contract.cjs';
import {
  buildRecommendationsSnapshot,
  compareRecommendationsRosterFreshness,
} from '../../lib/services/expertise-finder/recommendations-contract';

const guid = index => `00000000-0000-0000-0000-${String(index).padStart(12, '0')}`;

function projection() {
  const profile = (index, fields) => ({
    profile_guid: guid(index), etag: 'W/"1"', name: `Profile ${index}`,
    role_type: 'Research Program Staff', is_active: true, lead_pd_eligible: true,
    dataverse_user_id: guid(index + 100), dataverse_contact_id: null,
    ...Object.fromEntries(roster.TEXT.map(field => [field, null])), ...fields,
  });
  return {
    complete: true,
    profiles: [
      profile(1, { expertise: 'Example expertise' }),
      profile(2, {}),
      profile(3, { is_active: false, lead_pd_eligible: false }),
    ],
    users: [{ userGuid: guid(101), disabled: false }, { userGuid: guid(102), disabled: true }],
  };
}
const retainedHash = () => buildRecommendationsSnapshot(projection()).snapshot.manifest.rosterHash;

test('compares a fresh reordered projection using only the retained hash', () => {
  const expectedRosterHash = retainedHash();
  const current = projection();
  current.profiles.reverse();
  current.users.reverse();
  const original = JSON.stringify(current);
  expect(compareRecommendationsRosterFreshness({ expectedRosterHash, current })).toEqual({ freshness: 'current' });
  expect(JSON.stringify(current)).toBe(original);
});

test.each([
  ['active expertise', value => { value.profiles[0].expertise += '!'; }],
  ['inactive ETag', value => { value.profiles[2].etag = 'W/"2"'; }],
  ['disabled candidate re-enabled', value => { value.users[1].disabled = false; }],
  ['enabled candidate disabled', value => { value.users[0].disabled = true; }],
  ['lead eligibility removed', value => {
    value.profiles[0].lead_pd_eligible = false;
    value.users.shift();
  }],
  ['complete empty roster', value => { value.profiles = []; value.users = []; }],
])('reports a valid change in %s as stale', (_label, change) => {
  const current = projection();
  change(current);
  expect(compareRecommendationsRosterFreshness({ expectedRosterHash: retainedHash(), current }))
    .toEqual({ freshness: 'stale' });
});

test.each([
  undefined, null, 'A'.repeat(64), 'a'.repeat(63), 'a'.repeat(64) + '\n', { hash: 'a'.repeat(64) },
])('reports a malformed retained hash as unknown %#', expectedRosterHash => {
  expect(compareRecommendationsRosterFreshness({ expectedRosterHash, current: projection() }))
    .toEqual({ freshness: 'unknown' });
});

test('reports omitted input as unknown', () => {
  expect(compareRecommendationsRosterFreshness()).toEqual({ freshness: 'unknown' });
  expect(compareRecommendationsRosterFreshness({ expectedRosterHash: retainedHash() })).toEqual({ freshness: 'unknown' });
});

test.each([
  ['incomplete paging', value => { value.complete = false; }],
  ['missing projection field', value => { delete value.profiles[0].expertise; }],
  ['invalid ETag', value => { delete value.profiles[0].etag; }],
  ['missing disabled candidate state', value => { value.users.pop(); }],
  ['malformed disabled state', value => { value.users[1].disabled = null; }],
  ['unexpected User state', value => { value.users.push({ userGuid: guid(103), disabled: false }); }],
  ['encoded roster overflow', value => { value.profiles[0].expertise = 'é'.repeat(32_000); }],
])('reports unverifiable %s as unknown', (_label, change) => {
  const current = projection();
  change(current);
  expect(compareRecommendationsRosterFreshness({ expectedRosterHash: retainedHash(), current }))
    .toEqual({ freshness: 'unknown' });
});
