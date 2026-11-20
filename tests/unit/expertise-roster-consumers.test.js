/** @jest-environment node */
jest.mock('@vercel/postgres', () => ({ sql: { query: jest.fn() } }));
jest.mock('../../lib/dataverse/adapters/expertise-profile', () => ({ list: jest.fn() }));
import { sql } from '@vercel/postgres';
import { list } from '../../lib/dataverse/adapters/expertise-profile';
import { readConsumerRoster, eligibleRoster, hydrateFeedbackAuthors } from '../../lib/services/expertise-finder/roster-consumer-service';
import { loadSharedConsultantFeedbackForBriefing } from '../../lib/services/consultant-feedback-service';
const id = '11111111-1111-4111-8111-111111111111';
beforeEach(() => {
  process.env.EXPERTISE_ROSTER_BACKEND = 'dataverse'; process.env.DYNAMICS_URL = 'https://wmkf.crm.dynamics.com';
  list.mockResolvedValue([{ wmkf_expertiseprofileid: id, wmkf_name: 'Historical person', wmkf_category: 100000001, statecode: 1 }]);
  sql.query.mockResolvedValue({ rows: [{ roster_id: 13, dataverse_profile_guid: id }] });
});
afterEach(() => { delete process.env.EXPERTISE_ROSTER_BACKEND; jest.clearAllMocks(); });
test('numeric identities hydrate inactive authors; excluded 35 stays unavailable', async () => {
  expect(await eligibleRoster(['Consultant'])).toEqual([]);
  expect(await hydrateFeedbackAuthors([{ consultant_roster_id: 13 }, { consultant_roster_id: 35 }])).toEqual([
    expect.objectContaining({ roster_name: 'Historical person' }), expect.objectContaining({ roster_name: 'Unavailable consultant' }),
  ]);
});
test('unbound profiles fail closed, including inactive direct CRM creations', async () => {
  sql.query.mockResolvedValue({ rows: [] });
  await expect(readConsumerRoster()).rejects.toMatchObject({ httpStatus: 503 });
});
test('read outage cannot masquerade as empty roster or unavailable individual', async () => {
  list.mockRejectedValue(Error('outage'));
  await expect(hydrateFeedbackAuthors([{ consultant_roster_id: 35 }])).rejects.toMatchObject({ httpStatus: 503, code: 'roster_unavailable' });
});
test('external shared briefing marks entire feedback unavailable on roster outage', async () => {
  sql.query.mockImplementation(async q => ({ rows: q.includes('FROM consultant_feedback') ? [{ id: 1, consultant_roster_id: 35 }] : [] }));
  list.mockRejectedValue(Error('outage'));
  const spy = jest.spyOn(console, 'error').mockImplementation(() => {});
  expect(await loadSharedConsultantFeedbackForBriefing(id)).toMatchObject({ status: 'unavailable', items: [] });
  spy.mockRestore();
});
