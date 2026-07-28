/**
 * @jest-environment node
 *
 * Unified email-signature resolver.
 */
jest.mock('../../lib/services/database-service', () => ({
  DatabaseService: { getUserPreferences: jest.fn() },
}));
jest.mock('../../lib/services/dynamics-service', () => ({
  DynamicsService: { getRecord: jest.fn() },
}));
jest.mock('../../lib/services/dataverse-identity-map', () => ({
  resolveSystemUserToProfile: jest.fn(),
}));

import {
  appendSignatureBlock,
  resolveSignatureForProfile,
  resolveSignatureForRequest,
} from '../../lib/services/email-signature';
import {
  PREFERENCE_KEYS,
  normalizeEmailSignatureValue,
  readEmailSignaturePreference,
} from '../../shared/config/reviewerFinderPreferences';
import { DatabaseService } from '../../lib/services/database-service';
import { DynamicsService } from '../../lib/services/dynamics-service';
import { resolveSystemUserToProfile } from '../../lib/services/dataverse-identity-map';

const REQUEST_ID = '11111111-1111-1111-1111-111111111111';

beforeEach(() => {
  DatabaseService.getUserPreferences.mockReset();
  DynamicsService.getRecord.mockReset();
  resolveSystemUserToProfile.mockReset();
});

test('tolerant reader prefers EMAIL_SIGNATURE and falls back to legacy SENDER_INFO', () => {
  expect(readEmailSignaturePreference({
    [PREFERENCE_KEYS.EMAIL_SIGNATURE]: JSON.stringify({ name: 'New', email: 'new@example.org', signature: 'New block' }),
    [PREFERENCE_KEYS.SENDER_INFO]: JSON.stringify({ name: 'Old', email: 'old@example.org', signature: 'Old block' }),
  })).toEqual({ name: 'New', email: 'new@example.org', signature: 'New block' });

  expect(readEmailSignaturePreference({
    [PREFERENCE_KEYS.SENDER_INFO]: { name: 'Old', email: 'old@example.org', signature: 'Old block' },
  })).toEqual({ name: 'Old', email: 'old@example.org', signature: 'Old block' });
});

test('tolerant reader treats an empty unified key as intentional and does not resurrect legacy', () => {
  expect(readEmailSignaturePreference({
    [PREFERENCE_KEYS.EMAIL_SIGNATURE]: '',
    [PREFERENCE_KEYS.SENDER_INFO]: JSON.stringify({ name: 'Old', email: 'old@example.org', signature: 'Old block' }),
  })).toEqual({ name: '', email: '', signature: '' });
});

test('normalizes malformed string values into a signature block', () => {
  expect(normalizeEmailSignatureValue('{not json')).toEqual({
    name: '',
    email: '',
    signature: '{not json',
  });
});

test('profile resolver always ends with the Foundation line', () => {
  expect(resolveSignatureForProfile({
    [PREFERENCE_KEYS.EMAIL_SIGNATURE]: JSON.stringify({ name: 'Avery Quinn', signature: 'Avery Quinn' }),
  })).toEqual({
    name: 'Avery Quinn',
    email: '',
    signature: 'Avery Quinn\nW. M. Keck Foundation',
    isCustomSignature: true,
  });
});

test('a saved block that already names the Foundation is used verbatim (no duplicate line)', () => {
  const sig = 'Sincerely,\nAvery Quinn\n--\nAvery Quinn\nSenior Program Director\nW.M. Keck Foundation\nLos Angeles';
  const out = resolveSignatureForProfile({
    [PREFERENCE_KEYS.EMAIL_SIGNATURE]: JSON.stringify({ name: 'Avery Quinn', signature: sig }),
  });
  expect(out.signature).toBe(sig);
  expect((out.signature.match(/Keck Foundation/g) || []).length).toBe(1);
});

test('request resolver reads the assigned PD profile preference', async () => {
  DynamicsService.getRecord.mockImplementation((entitySet) => {
    if (entitySet === 'akoya_requests') {
      return Promise.resolve({ akoya_requestid: REQUEST_ID, _wmkf_programdirector_value: 'sys-1' });
    }
    if (entitySet === 'systemusers') {
      return Promise.resolve({ systemuserid: 'sys-1', fullname: 'Fallback PD', internalemailaddress: 'pd@example.org' });
    }
    return Promise.reject(new Error('unexpected'));
  });
  resolveSystemUserToProfile.mockResolvedValue(7);
  DatabaseService.getUserPreferences.mockResolvedValue({
    [PREFERENCE_KEYS.EMAIL_SIGNATURE]: JSON.stringify({
      name: 'Saved PD',
      email: 'saved@example.org',
      signature: 'Saved PD\nCustom title\nW. M. Keck Foundation',
    }),
  });

  await expect(resolveSignatureForRequest(REQUEST_ID)).resolves.toEqual({
    name: 'Saved PD',
    email: 'saved@example.org',
    signature: 'Saved PD\nCustom title\nW. M. Keck Foundation',
    isCustomSignature: true,
  });
  expect(resolveSystemUserToProfile).toHaveBeenCalledWith('sys-1');
  expect(DatabaseService.getUserPreferences).toHaveBeenCalledWith(7, false);
});

test('request resolver falls back to systemuser fullname when no profile matches', async () => {
  DynamicsService.getRecord.mockImplementation((entitySet) => {
    if (entitySet === 'akoya_requests') {
      return Promise.resolve({ akoya_requestid: REQUEST_ID, _wmkf_programdirector_value: 'sys-2' });
    }
    if (entitySet === 'systemusers') {
      return Promise.resolve({ systemuserid: 'sys-2', fullname: 'Unmapped PD', internalemailaddress: 'unmapped@example.org' });
    }
    return Promise.reject(new Error('unexpected'));
  });
  resolveSystemUserToProfile.mockResolvedValue(null);

  await expect(resolveSignatureForRequest(REQUEST_ID)).resolves.toEqual({
    name: 'Unmapped PD',
    email: 'unmapped@example.org',
    signature: 'Unmapped PD\nW. M. Keck Foundation',
    isCustomSignature: false,
  });
  expect(DatabaseService.getUserPreferences).not.toHaveBeenCalled();
});

test('appendSignatureBlock appends the (already-finalized) block verbatim', () => {
  // The block is finalized by resolveSignatureForRequest before this; append does
  // NOT re-add the Foundation line (that double-appended it).
  expect(appendSignatureBlock('Thank you,', { signature: 'Assigned PD\nW. M. Keck Foundation' }))
    .toBe('Thank you,\n\nAssigned PD\nW. M. Keck Foundation');
});

test('appendSignatureBlock does not duplicate a Foundation line already in the saved block', () => {
  // Regression: a real saved block ending in a city, with its own org line above,
  // must not get a second "W. M. Keck Foundation" tacked on.
  const block = { signature: 'Sincerely,\nAvery Quinn\n--\nAvery Quinn\nSenior Program Director\nW.M. Keck Foundation\nLos Angeles' };
  const out = appendSignatureBlock('Thank you,', block);
  expect((out.match(/Keck Foundation/g) || []).length).toBe(1);
  expect(out.endsWith('Los Angeles')).toBe(true);
});
