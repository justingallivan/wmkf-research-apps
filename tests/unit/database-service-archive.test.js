/**
 * archiveUserProfile must not report a successful revocation when a
 * concurrent identity transfer removed the selected row before UPDATE.
 */

jest.mock('@vercel/postgres', () => ({ sql: jest.fn() }));

const { sql } = require('@vercel/postgres');
const { DatabaseService } = require('../../lib/services/database-service');

describe('DatabaseService.archiveUserProfile', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('returns true only when Postgres deactivates a row', async () => {
    sql.mockResolvedValueOnce({ rows: [], rowCount: 1 });
    await expect(DatabaseService.archiveUserProfile(7)).resolves.toBe(true);
  });

  it('returns false when a concurrent transfer leaves no row to deactivate', async () => {
    sql.mockResolvedValueOnce({ rows: [], rowCount: 0 });
    await expect(DatabaseService.archiveUserProfile(7)).resolves.toBe(false);
  });
});
