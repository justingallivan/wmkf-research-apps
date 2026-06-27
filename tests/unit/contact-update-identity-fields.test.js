/**
 * @jest-environment node
 */

import { DynamicsService } from '../../lib/services/dynamics-service.js';
import { updateIdentityFields } from '../../lib/dataverse/adapters/contact.js';

afterEach(() => jest.restoreAllMocks());

describe('contact.updateIdentityFields', () => {
  test('only-provided-fields PATCH: only jobTitle produces only jobtitle payload', async () => {
    const patch = jest.spyOn(DynamicsService, 'updateRecord').mockResolvedValue(undefined);

    const out = await updateIdentityFields('contact-1', { jobTitle: 'Professor' }, { actingUserSystemId: 'user-1' });

    expect(out).toEqual({ updated: ['jobtitle'] });
    expect(patch).toHaveBeenCalledTimes(1);
    expect(patch).toHaveBeenCalledWith(
      'contacts',
      'contact-1',
      { jobtitle: 'Professor' },
      { actingUserSystemId: 'user-1' },
    );
  });

  test('never blanks: undefined, null, empty, and whitespace-only fields are omitted', async () => {
    const patch = jest.spyOn(DynamicsService, 'updateRecord').mockResolvedValue(undefined);

    const out = await updateIdentityFields('contact-1', {
      firstName: undefined,
      lastName: null,
      nickname: '',
      jobTitle: '   ',
    });

    expect(out).toEqual({ updated: [] });
    expect(patch).not.toHaveBeenCalled();
  });

  test('calls DynamicsService.updateRecord with correct entity, id, and trimmed payload', async () => {
    const patch = jest.spyOn(DynamicsService, 'updateRecord').mockResolvedValue(undefined);

    await updateIdentityFields('contact-2', {
      firstName: ' Ada ',
      lastName: 'Lovelace',
      nickname: ' Countess ',
      jobTitle: '',
    });

    expect(patch).toHaveBeenCalledTimes(1);
    expect(patch.mock.calls[0]).toEqual([
      'contacts',
      'contact-2',
      { firstname: 'Ada', lastname: 'Lovelace', nickname: 'Countess' },
      { actingUserSystemId: undefined },
    ]);
  });

  test('nickname-only PATCH writes contacts.nickname', async () => {
    const patch = jest.spyOn(DynamicsService, 'updateRecord').mockResolvedValue(undefined);

    const out = await updateIdentityFields('contact-3', { nickname: 'Dr. Lee' }, { actingUserSystemId: 'user-2' });

    expect(out).toEqual({ updated: ['nickname'] });
    expect(patch).toHaveBeenCalledWith(
      'contacts',
      'contact-3',
      { nickname: 'Dr. Lee' },
      { actingUserSystemId: 'user-2' },
    );
  });
});
