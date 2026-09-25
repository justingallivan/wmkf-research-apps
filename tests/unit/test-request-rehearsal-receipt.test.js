import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { reserveRehearsalReceipt, updateRehearsalReceipt } from '../../lib/services/test-requests/rehearsal-receipt.js';

describe('sandbox rehearsal receipt durability', () => {
  let directory;
  let receiptPath;

  beforeEach(() => {
    directory = fs.mkdtempSync(path.join(os.tmpdir(), 'sandbox-rehearsal-receipt-'));
    receiptPath = path.join(directory, 'receipt.json');
  });

  afterEach(() => fs.rmSync(directory, { recursive: true, force: true }));

  test('reserves a private file and atomically replaces complete JSON milestones', () => {
    reserveRehearsalReceipt(receiptPath, { stage: 'reserved', requestId: 'request-guid' });
    expect(fs.statSync(receiptPath).mode & 0o777).toBe(0o600);

    updateRehearsalReceipt(receiptPath, {
      stage: 'create-attempted', requestId: 'request-guid', locationId: 'location-guid',
    });

    expect(JSON.parse(fs.readFileSync(receiptPath, 'utf8'))).toEqual({
      stage: 'create-attempted', requestId: 'request-guid', locationId: 'location-guid',
    });
    expect(fs.readdirSync(directory)).toEqual(['receipt.json']);
  });

  test('a failed serialization leaves the previous complete receipt intact', () => {
    reserveRehearsalReceipt(receiptPath, { stage: 'reserved' });
    expect(() => updateRehearsalReceipt(receiptPath, { stage: 1n })).toThrow();
    expect(JSON.parse(fs.readFileSync(receiptPath, 'utf8'))).toEqual({ stage: 'reserved' });
    expect(fs.readdirSync(directory)).toEqual(['receipt.json']);
  });
});
