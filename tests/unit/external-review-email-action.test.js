/**
 * @jest-environment jsdom
 */

import {
  deriveEmailActionView,
  shouldShowAcceptedWithdrawal,
} from '../../pages/external/review/[token]';

describe('reviewer email action deep links', () => {
  test('fresh invitation accept opens the existing Stage 2a accept form', () => {
    expect(deriveEmailActionView({
      action: 'accept',
      serverView: 'stage2a',
    })).toBe('stage2a');
  });

  test('fresh invitation decline opens the existing suggestion/reason path', () => {
    expect(deriveEmailActionView({
      action: 'decline',
      serverView: 'stage2a',
    })).toBe('decline-form');
  });

  test('accepted reviewer withdrawal link opens the existing suggestion/reason path', () => {
    expect(deriveEmailActionView({
      action: 'decline',
      serverView: 'accepted-pre-materials',
    })).toBe('decline-form');
  });

  test.each([
    'declined',
    'stage2b',
    'submitted',
    'withdrawn-sufficient',
  ])('action query never overrides server state %s', (serverView) => {
    expect(deriveEmailActionView({ action: 'accept', serverView })).toBeNull();
    expect(deriveEmailActionView({ action: 'decline', serverView })).toBeNull();
  });

  test('unknown, repeated-array, or dismissed actions fall through safely', () => {
    expect(deriveEmailActionView({ action: 'other', serverView: 'stage2a' })).toBeNull();
    expect(deriveEmailActionView({ action: ['decline'], serverView: 'stage2a' })).toBeNull();
    expect(deriveEmailActionView({
      action: 'decline',
      serverView: 'stage2a',
      dismissed: true,
    })).toBeNull();
  });
});

describe('accepted reviewer withdrawal visibility', () => {
  test('hides withdrawal only for the token accepted during this mounted visit', () => {
    expect(shouldShowAcceptedWithdrawal({
      acceptedThisVisitToken: 'token-a',
      token: 'token-a',
    })).toBe(false);
  });

  test('shows withdrawal on initial load and when the page changes to another token', () => {
    expect(shouldShowAcceptedWithdrawal({
      acceptedThisVisitToken: null,
      token: 'token-a',
    })).toBe(true);
    expect(shouldShowAcceptedWithdrawal({
      acceptedThisVisitToken: 'token-a',
      token: 'token-b',
    })).toBe(true);
  });

  test('fails closed when no token is available', () => {
    expect(shouldShowAcceptedWithdrawal({
      acceptedThisVisitToken: null,
      token: null,
    })).toBe(false);
  });
});
