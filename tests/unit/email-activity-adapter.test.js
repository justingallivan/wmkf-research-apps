import { DynamicsService } from '../../lib/services/dynamics-service.js';
import * as emailActivityAdapter from '../../lib/dataverse/adapters/email-activity.js';

afterEach(() => jest.restoreAllMocks());

test('email correlation and attachment reads stay behind escaped adapter filters', async () => {
  const query = jest.spyOn(DynamicsService, 'queryRecords')
    .mockResolvedValueOnce({ records: [{ activityid: 'mail-1' }] })
    .mockResolvedValueOnce({ records: [{ activitymimeattachmentid: 'attachment-1' }] });

  await expect(emailActivityAdapter.findByCorrelation("operation'oops"))
    .resolves.toEqual([{ activityid: 'mail-1' }]);
  await expect(emailActivityAdapter.findAttachments(
    '11111111-1111-4111-8111-111111111111',
    "frozen'oops.pdf",
  )).resolves.toEqual([{ activitymimeattachmentid: 'attachment-1' }]);

  expect(query.mock.calls[0]).toEqual(['emails', expect.objectContaining({
    filter: "subcategory eq 'operation''oops'",
    top: 2,
  })]);
  expect(query.mock.calls[1]).toEqual(['activitymimeattachments', expect.objectContaining({
    filter: "_objectid_value eq 11111111-1111-4111-8111-111111111111 and filename eq 'frozen''oops.pdf'",
    top: 3,
  })]);
});

test('granular email writes delegate actor and no-fallback options unchanged', async () => {
  const send = jest.spyOn(DynamicsService, 'sendEmail').mockResolvedValue(undefined);
  const options = {
    actingUserSystemId: '22222222-2222-4222-8222-222222222222',
    noFallback: true,
  };

  await emailActivityAdapter.send('11111111-1111-4111-8111-111111111111', options);
  expect(send).toHaveBeenCalledWith('11111111-1111-4111-8111-111111111111', options);
});
