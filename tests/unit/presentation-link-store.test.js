/** @jest-environment node */
jest.mock('@vercel/postgres', () => ({
  db: { connect: jest.fn() },
  sql: jest.fn(),
}));

import { db } from '@vercel/postgres';
import {
  presentationLinkSupersededError,
  replaceLiveLink,
} from '../../lib/services/post-presentation-materials/presentation-link-store.js';

const REQUEST_ID = '11111111-1111-4111-8111-111111111111';
const OLD_ID = '22222222-2222-4222-8222-222222222222';
const NEW_ID = '33333333-3333-4333-8333-333333333333';
const ACTOR_ID = '44444444-4444-4444-8444-444444444444';

function replacement() {
  return {
    id: NEW_ID,
    jti: 'jti-new',
    tokenDigest: 'digest-new',
    tokenCiphertext: 'ciphertext-new',
    expiresAt: new Date('2026-11-24T12:00:00.000Z'),
    createdBy: ACTOR_ID,
  };
}

function clientWith(query) {
  const client = { query: jest.fn(query), release: jest.fn() };
  db.connect.mockResolvedValue(client);
  return client;
}

beforeEach(() => jest.clearAllMocks());

test('compare-and-swap locks the live row and commits one replacement transaction', async () => {
  const inserted = { id: NEW_ID };
  const client = clientWith(async (text) => {
    if (text === 'BEGIN' || text === 'COMMIT') return { rows: [] };
    if (text.includes('SELECT id') && text.includes('FOR UPDATE')) return { rows: [{ id: OLD_ID }] };
    if (text.includes('UPDATE presentation_material_links')) return { rows: [] };
    if (text.includes('INSERT INTO presentation_material_links')) return { rows: [inserted] };
    throw new Error(`Unexpected SQL: ${text}`);
  });

  await expect(replaceLiveLink(REQUEST_ID, replacement(), {
    revokedBy: ACTOR_ID,
    expectedLiveId: OLD_ID,
  })).resolves.toBe(inserted);

  const calls = client.query.mock.calls;
  expect(calls[0][0]).toBe('BEGIN');
  expect(calls[1][0]).toContain('FOR UPDATE');
  expect(calls[1][1]).toEqual([REQUEST_ID]);
  expect(calls[2][0]).toContain('UPDATE presentation_material_links');
  expect(calls[2][1]).toEqual([REQUEST_ID, ACTOR_ID, NEW_ID]);
  expect(calls[3][0]).toContain('INSERT INTO presentation_material_links');
  expect(calls[3][1]).toEqual([
    NEW_ID,
    REQUEST_ID,
    'jti-new',
    'digest-new',
    'ciphertext-new',
    '2026-11-24T12:00:00.000Z',
    ACTOR_ID,
  ]);
  expect(calls[4][0]).toBe('COMMIT');
  expect(client.release).toHaveBeenCalledTimes(1);
});

test('compare-and-swap rolls back without update or insert when the inspected row changed', async () => {
  const client = clientWith(async (text) => {
    if (text === 'BEGIN' || text === 'ROLLBACK') return { rows: [] };
    if (text.includes('SELECT id') && text.includes('FOR UPDATE')) {
      return { rows: [{ id: '55555555-5555-4555-8555-555555555555' }] };
    }
    throw new Error(`Unexpected SQL: ${text}`);
  });

  await expect(replaceLiveLink(REQUEST_ID, replacement(), {
    revokedBy: ACTOR_ID,
    expectedLiveId: OLD_ID,
  })).rejects.toMatchObject({ code: 'presentation_link_superseded', httpStatus: 409 });
  expect(client.query.mock.calls.some(([text]) => text.includes('UPDATE presentation_material_links'))).toBe(false);
  expect(client.query.mock.calls.some(([text]) => text.includes('INSERT INTO presentation_material_links'))).toBe(false);
  expect(client.release).toHaveBeenCalledTimes(1);
});

test('superseded error exposes the stable route contract', () => {
  expect(presentationLinkSupersededError()).toMatchObject({
    code: 'presentation_link_superseded',
    httpStatus: 409,
    body: { code: 'presentation_link_superseded' },
  });
});
