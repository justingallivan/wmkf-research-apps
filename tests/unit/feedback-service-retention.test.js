/**
 * @jest-environment node
 */

jest.mock('@vercel/postgres', () => ({ sql: jest.fn() }));

const { sql } = require('@vercel/postgres');
const FeedbackService = require('../../lib/services/feedback-service');

function sqlTemplate(callIndex = 0) {
  const [strings] = sql.mock.calls[callIndex];
  return Array.isArray(strings) ? strings.join('?') : '';
}

beforeEach(() => {
  sql.mockReset();
});

describe('Dynamics feedback acknowledgement retention', () => {
  test('the first admin acknowledgement timestamp is not restarted by later status changes', async () => {
    sql.mockResolvedValueOnce({ rows: [{ id: 7, status: 'resolved' }] });

    await FeedbackService.updateFeedback(7, {
      status: 'resolved',
      adminNote: null,
      reviewedBy: 3,
    });

    expect(sqlTemplate()).toMatch(
      /reviewed_at\s*=\s*COALESCE\(reviewed_at,\s*CURRENT_TIMESTAMP\)/i,
    );
    expect(sqlTemplate()).toMatch(
      /reviewed_by\s*=\s*CASE\s+WHEN reviewed_at IS NULL THEN \?\s+ELSE reviewed_by\s+END/i,
    );
  });

  test('cleanup measures 20 days from ACK, independent of status or creation time', async () => {
    sql.mockResolvedValueOnce({ rowCount: 5 });

    await expect(FeedbackService.cleanupOldFeedback(20)).resolves.toBe(5);

    const template = sqlTemplate();
    const [, ...values] = sql.mock.calls[0];
    expect(template).toMatch(/DELETE FROM dynamics_feedback/i);
    expect(template).toMatch(/reviewed_at\s+IS\s+NOT\s+NULL/i);
    expect(template).toMatch(
      /reviewed_at\s*<\s*NOW\(\)\s*-\s*MAKE_INTERVAL\(days\s*=>\s*\?\)/i,
    );
    expect(template).not.toMatch(/created_at/i);
    expect(template).not.toMatch(/status\s*=/i);
    expect(values).toContain(20);
  });

  test('cleanup rethrows SQL failures so the cron cannot report false success', async () => {
    sql.mockRejectedValueOnce(new Error('connection terminated'));
    const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});

    await expect(FeedbackService.cleanupOldFeedback(20))
      .rejects.toThrow('connection terminated');

    errorSpy.mockRestore();
  });
});
