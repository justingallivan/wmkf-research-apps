/**
 * @jest-environment node
 *
 * potential-reviewer.update — S308 board-writeup identity fields map to their
 * dedicated columns (and are subject to the existing no-op-diff guard).
 */

import { DynamicsService } from '../../lib/services/dynamics-service.js';
import { update } from '../../lib/dataverse/adapters/potential-reviewer.js';

const PID = '22222222-2222-2222-2222-222222222222';

afterEach(() => jest.restoreAllMocks());

describe('potential-reviewer.update — board identity', () => {
  it('maps academicRank/primaryDepartment/mainInstitution to their columns', async () => {
    jest.spyOn(DynamicsService, 'getRecord').mockResolvedValue({}); // no existing values
    const patch = jest.spyOn(DynamicsService, 'updateRecord').mockResolvedValue(undefined);

    await update(PID, { academicRank: 'Professor', primaryDepartment: 'Chemistry', mainInstitution: 'MIT' }, { actingUserSystemId: 'u1' });

    expect(patch).toHaveBeenCalledTimes(1);
    const [, id, payload] = patch.mock.calls[0];
    expect(id).toBe(PID);
    expect(payload).toMatchObject({
      wmkf_academicrank: 'Professor',
      wmkf_primarydepartment: 'Chemistry',
      wmkf_maininstitution: 'MIT',
    });
    // Must NOT touch the enrichment affiliation/department columns.
    expect(payload).not.toHaveProperty('wmkf_primaryaffiliation');
    expect(payload).not.toHaveProperty('wmkf_department');
  });

  it('drops a board field whose value already matches CRM (no-op diff)', async () => {
    jest.spyOn(DynamicsService, 'getRecord').mockResolvedValue({ wmkf_academicrank: 'Professor' });
    const patch = jest.spyOn(DynamicsService, 'updateRecord').mockResolvedValue(undefined);

    await update(PID, { academicRank: 'Professor', mainInstitution: 'MIT' }, {});

    const [, , payload] = patch.mock.calls[0];
    expect(payload).not.toHaveProperty('wmkf_academicrank'); // unchanged → dropped
    expect(payload).toMatchObject({ wmkf_maininstitution: 'MIT' });
  });
});
