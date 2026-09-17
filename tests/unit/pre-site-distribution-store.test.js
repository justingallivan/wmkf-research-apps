/** @jest-environment node */

jest.mock('@vercel/postgres', () => ({ sql: jest.fn() }));

import { sql } from '@vercel/postgres';
import { recordDistributionSource, recordDistributionPrepared } from '../../lib/services/pre-site-visit/distribution-store.js';

const OPERATION_ID = '11111111-1111-4111-8111-111111111111';
const BASE_SOURCE = {
  driveId: 'drive-a',
  itemId: 'item-a',
  versionId: '1.0',
  contentHash: 'gdc1:governed-a',
  filename: 'Staff Brief.docx',
};

function queryText(callIndex) {
  return sql.mock.calls[callIndex][0].join('?').replace(/\s+/g, ' ').trim();
}

beforeEach(() => {
  jest.clearAllMocks();
});

test('recordDistributionSource refreshes served-byte metadata only for the same preparing source identity', async () => {
  const byteHashA = 'a'.repeat(64);
  const byteHashB = 'b'.repeat(64);
  const firstRow = { state: 'preparing', source_byte_hash: byteHashA };
  const retriedRow = { state: 'preparing', source_byte_hash: byteHashB };
  sql
    .mockResolvedValueOnce({ rows: [firstRow] })
    .mockResolvedValueOnce({ rows: [retriedRow] })
    .mockResolvedValueOnce({ rows: [] })
    .mockResolvedValueOnce({ rows: [] });

  await expect(recordDistributionSource(OPERATION_ID, { ...BASE_SOURCE, byteHash: byteHashA }))
    .resolves.toBe(firstRow);
  await expect(recordDistributionSource(OPERATION_ID, { ...BASE_SOURCE, byteHash: byteHashB }))
    .resolves.toBe(retriedRow);
  await expect(recordDistributionSource(OPERATION_ID, {
    ...BASE_SOURCE,
    contentHash: 'gdc1:different-content',
    byteHash: 'c'.repeat(64),
  })).resolves.toBeNull();
  await expect(recordDistributionSource(OPERATION_ID, {
    ...BASE_SOURCE,
    versionId: '2.0',
    byteHash: 'd'.repeat(64),
  })).resolves.toBeNull();

  const text = queryText(0);
  expect(text).toContain("state = 'preparing'");
  expect(text).toContain('source_drive_id IS NULL AND source_item_id IS NULL AND source_version_id IS NULL AND source_content_hash IS NULL');
  expect(text).toContain('source_drive_id = ? AND source_item_id = ? AND source_version_id = ? AND source_content_hash = ?');
  expect(text.split(' WHERE ')[1]).not.toContain('source_byte_hash');
  expect(sql.mock.calls[0].slice(1)).toEqual([
    BASE_SOURCE.driveId,
    BASE_SOURCE.itemId,
    BASE_SOURCE.versionId,
    BASE_SOURCE.contentHash,
    byteHashA,
    BASE_SOURCE.filename,
    OPERATION_ID,
    BASE_SOURCE.driveId,
    BASE_SOURCE.itemId,
    BASE_SOURCE.versionId,
    BASE_SOURCE.contentHash,
  ]);
  expect(sql.mock.calls[1].slice(1)).toEqual([
    BASE_SOURCE.driveId,
    BASE_SOURCE.itemId,
    BASE_SOURCE.versionId,
    BASE_SOURCE.contentHash,
    byteHashB,
    BASE_SOURCE.filename,
    OPERATION_ID,
    BASE_SOURCE.driveId,
    BASE_SOURCE.itemId,
    BASE_SOURCE.versionId,
    BASE_SOURCE.contentHash,
  ]);
  expect(sql.mock.calls[2].slice(1)).toContain('gdc1:different-content');
  expect(sql.mock.calls[3].slice(1)).toContain('2.0');
});

describe('recordDistributionPrepared fences finalization on the captured source identity', () => {
  const PREPARED = {
    source: { driveId: 'drive-a', itemId: 'item-a', versionId: '1.0', contentHash: 'gdc1:governed-a', byteHash: 'a'.repeat(64) },
    docx: { documentId: '22222222-2222-4222-8222-222222222222', driveId: 'd', itemId: 'i', versionId: '1.0', webUrl: null, filename: 'x.docx', contentType: 'application/x', byteHash: 'b'.repeat(64), size: 1 },
    pdf: null,
    reviewBundle: null,
    calendar: null,
    previewHash: 'c'.repeat(64),
  };

  test('the UPDATE requires drive, item, version, governed hash, and byte hash to still match the capture', async () => {
    sql.mockResolvedValueOnce({ rows: [{ state: 'prepared' }] }).mockResolvedValueOnce({ rows: [] });
    await expect(recordDistributionPrepared(OPERATION_ID, PREPARED)).resolves.toEqual({ state: 'prepared' });
    const text = queryText(0);
    const where = text.split(' WHERE ')[1];
    expect(where).toContain("state = 'preparing'");
    expect(where).toContain('source_drive_id = ? AND source_item_id = ? AND source_version_id = ? AND source_content_hash = ? AND source_byte_hash = ?');
    expect(sql.mock.calls[0].slice(-5)).toEqual(['drive-a', 'item-a', '1.0', 'gdc1:governed-a', 'a'.repeat(64)]);
    // A row whose recorded source moved on (another capture's bytes) matches nothing.
    await expect(recordDistributionPrepared(OPERATION_ID, PREPARED)).resolves.toBeNull();
  });

  test('refuses to finalize without a complete captured source identity', async () => {
    await expect(recordDistributionPrepared(OPERATION_ID, { ...PREPARED, source: { ...PREPARED.source, byteHash: null } }))
      .rejects.toThrow(/captured source identity/);
    expect(sql).not.toHaveBeenCalled();
  });
});
