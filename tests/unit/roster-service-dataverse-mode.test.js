/** @jest-environment node */
jest.mock('../../lib/dataverse/adapters/expertise-profile', () => ({ get: jest.fn(), list: jest.fn(), users: jest.fn(), update: jest.fn(), create: jest.fn(), byCreationKey: jest.fn() }));
jest.mock('../../lib/dataverse/adapters/system-user', () => ({ getById: jest.fn() }));
jest.mock('../../lib/dataverse/adapters/contact', () => ({ getByIdWithSelect: jest.fn() }));
jest.mock('../../lib/services/expertise-finder/roster-lifecycle.cjs', () => ({ withRosterWrite: jest.fn(), creationKey: jest.fn(), fail: jest.fn() }));
jest.mock('../../lib/services/expertise-finder/roster-binding.js', () => ({ ensureProfileBinding: jest.fn() }));
import * as profiles from '../../lib/dataverse/adapters/expertise-profile';
import { saveRoster, listRoster } from '../../lib/services/expertise-finder/roster-service';
import { ensureProfileBinding } from '../../lib/services/expertise-finder/roster-binding.js';
import { processAnnotations } from '../../lib/services/dynamics/annotations';
const contract = require('../../lib/services/expertise-finder/roster-contract.cjs');
const lifecycle = require('../../lib/services/expertise-finder/roster-lifecycle.cjs');

const ID = '11111111-1111-4111-8111-111111111111';
const ACTOR = '33333333-3333-4333-8333-333333333333';
const MUTATION = '55555555-5555-4555-8555-555555555555';
const saved = { ...process.env };
let row;

beforeEach(() => {
  jest.resetAllMocks();
  Object.assign(process.env, { EXPERTISE_ROSTER_BACKEND: 'dataverse', DYNAMICS_URL: 'https://wmkf.crm.dynamics.com', DYNAMICS_IMPERSONATION_ENABLED: 'true' });
  delete process.env.EXPERTISE_ROSTER_REHEARSAL;
  row = processAnnotations({ wmkf_expertiseprofileid: ID, wmkf_name: 'Synthetic Board', wmkf_category: contract.CATEGORIES.Board, statecode: 0, wmkf_leadpdeligible: false, wmkf_creationkey: `app_${MUTATION}`, '@odata.etag': 'W/"7"' });
  ensureProfileBinding.mockResolvedValue(41);
});
afterAll(() => { process.env = saved; });

test('create binds the confirmed profile for this deployment host without the lifecycle lease', async () => {
  profiles.byCreationKey.mockResolvedValueOnce(null).mockResolvedValueOnce(row);
  profiles.create.mockResolvedValue();
  const result = await saveRoster({ name: 'Synthetic Board', role_type: 'Board', is_active: true, mutation_id: MUTATION }, ACTOR, { create: true });
  expect(result.success).toBe(true);
  expect(ensureProfileBinding).toHaveBeenCalledWith('wmkf.crm.dynamics.com', ID);
  expect(lifecycle.withRosterWrite).not.toHaveBeenCalled();
});

test('a failed bind after a confirmed create surfaces an error so the client retries with the same identity', async () => {
  profiles.byCreationKey.mockResolvedValueOnce(null).mockResolvedValueOnce(row);
  profiles.create.mockResolvedValue();
  ensureProfileBinding.mockRejectedValue(new Error('db down'));
  await expect(saveRoster({ name: 'Synthetic Board', role_type: 'Board', is_active: true, mutation_id: MUTATION }, ACTOR, { create: true })).rejects.toThrow('db down');
  expect(profiles.create).toHaveBeenCalledTimes(1);
});

test('update with a failed bind is still a saved update with a warning', async () => {
  profiles.get.mockResolvedValue(row);
  profiles.update.mockResolvedValue();
  ensureProfileBinding.mockRejectedValue(new Error('db down'));
  const result = await saveRoster({ id: ID, etag: 'W/"7"', name: 'Synthetic Board', role_type: 'Board', is_active: true }, ACTOR);
  expect(result.success).toBe(true);
  expect(result.warning).toMatch(/numeric roster reconciliation is incomplete/);
});

test('list reports the dataverse backend label', async () => {
  profiles.list.mockResolvedValue([row]);
  profiles.users.mockResolvedValue([]);
  const result = await listRoster({});
  expect(result.backend).toBe('dataverse');
  expect(result.members).toHaveLength(1);
});
