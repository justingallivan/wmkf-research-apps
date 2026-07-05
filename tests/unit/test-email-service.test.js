/**
 * Unit tests for lib/services/admin/test-email-service.js (Stage 5 batch 1).
 * Logic-level, DynamicsService mocked; assumes the shell already resolved
 * from/actingUserSystemId and established the DAL context.
 *
 * @jest-environment node
 */

jest.mock('../../lib/services/dynamics-service', () => ({
  DynamicsService: {
    createAndSendEmail: jest.fn(),
    createEmailActivity: jest.fn(),
  },
}));

import { DynamicsService } from '../../lib/services/dynamics-service';
import { sendTestEmail } from '../../lib/services/admin/test-email-service';

const args = {
  to: 'r@x.org', subject: 'S', body: 'B',
  from: 'sender@wmkeck.org', actingUserSystemId: 'sys-1',
};

beforeEach(() => {
  DynamicsService.createAndSendEmail.mockReset().mockResolvedValue({ emailId: 'sent-1' });
  DynamicsService.createEmailActivity.mockReset().mockResolvedValue('draft-1');
});

describe('sendTestEmail', () => {
  it('send mode: createAndSendEmail with full args, sent envelope', async () => {
    const r = await sendTestEmail({ ...args, sendMode: 'send' });
    expect(DynamicsService.createAndSendEmail).toHaveBeenCalledWith({
      subject: 'S', body: 'B', from: 'sender@wmkeck.org', to: 'r@x.org', actingUserSystemId: 'sys-1',
    });
    expect(DynamicsService.createEmailActivity).not.toHaveBeenCalled();
    expect(r).toEqual({
      success: true, emailId: 'sent-1', status: 'sent',
      message: 'Email sent successfully from sender@wmkeck.org to r@x.org',
    });
  });

  it('any non-send mode drafts: createEmailActivity, draft envelope', async () => {
    const r = await sendTestEmail({ ...args, sendMode: 'draft' });
    expect(DynamicsService.createEmailActivity).toHaveBeenCalledWith({
      subject: 'S', body: 'B', from: 'sender@wmkeck.org', to: 'r@x.org', actingUserSystemId: 'sys-1',
    });
    expect(DynamicsService.createAndSendEmail).not.toHaveBeenCalled();
    expect(r).toEqual({
      success: true, emailId: 'draft-1', status: 'draft',
      message: 'Draft email created (not sent). Activity ID: draft-1',
    });
  });

  it('undefined sendMode drafts (historical default branch)', async () => {
    const r = await sendTestEmail({ ...args });
    expect(DynamicsService.createEmailActivity).toHaveBeenCalledTimes(1);
    expect(r.status).toBe('draft');
  });

  it('provider errors propagate raw for the shell to map to 500', async () => {
    DynamicsService.createAndSendEmail.mockRejectedValueOnce(new Error('Dynamics unavailable'));
    await expect(sendTestEmail({ ...args, sendMode: 'send' })).rejects.toThrow('Dynamics unavailable');
  });
});
