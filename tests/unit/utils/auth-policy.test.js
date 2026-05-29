/**
 * Auth policy — pin the contract that proxy.js (Node.js runtime) and lib/utils/auth.js
 * now share. Before this consolidation, middleware used a one-liner
 *
 *     if (process.env.AUTH_REQUIRED !== 'true') return true;
 *
 * which fails OPEN on a misconfigured prod deploy, while the API path
 * `isAuthRequired()` already failed CLOSED. The two layers disagreed in the
 * worst direction. These tests pin the unified behavior so any regression to
 * the middleware-style fail-open is caught.
 */

import { isAuthRequired, _resetWarningsForTests } from '../../../lib/utils/auth-policy';

const ENV_KEYS = [
  'AUTH_REQUIRED',
  'AZURE_AD_CLIENT_ID',
  'AZURE_AD_CLIENT_SECRET',
  'AZURE_AD_TENANT_ID',
  'EMERGENCY_AUTH_BYPASS',
  'NODE_ENV',
];

let savedEnv = {};

beforeEach(() => {
  savedEnv = {};
  for (const k of ENV_KEYS) {
    savedEnv[k] = process.env[k];
    delete process.env[k];
  }
  _resetWarningsForTests();
  jest.spyOn(console, 'error').mockImplementation(() => {});
  jest.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(() => {
  for (const k of ENV_KEYS) {
    if (savedEnv[k] === undefined) delete process.env[k];
    else process.env[k] = savedEnv[k];
  }
  jest.restoreAllMocks();
});

describe('auth-policy.isAuthRequired', () => {
  describe('production', () => {
    beforeEach(() => { process.env.NODE_ENV = 'production'; });

    test('fails closed when AUTH_REQUIRED is missing (the bug middleware used to have)', () => {
      // No AUTH_REQUIRED, no credentials, no bypass — must enforce auth.
      expect(isAuthRequired()).toBe(true);
    });

    test('fails closed when AUTH_REQUIRED is set but credentials are missing', () => {
      process.env.AUTH_REQUIRED = 'true';
      // No Azure creds.
      expect(isAuthRequired()).toBe(true);
    });

    test('fails closed when AUTH_REQUIRED is some non-"true" string', () => {
      process.env.AUTH_REQUIRED = '1'; // truthy string, but not 'true'
      expect(isAuthRequired()).toBe(true);
    });

    test('only disables auth when EMERGENCY_AUTH_BYPASS is explicitly true', () => {
      process.env.EMERGENCY_AUTH_BYPASS = 'true';
      expect(isAuthRequired()).toBe(false);
    });

    test('returns true when properly configured (AUTH_REQUIRED + creds)', () => {
      process.env.AUTH_REQUIRED = 'true';
      process.env.AZURE_AD_CLIENT_ID = 'id';
      process.env.AZURE_AD_CLIENT_SECRET = 'secret';
      process.env.AZURE_AD_TENANT_ID = 'tenant';
      expect(isAuthRequired()).toBe(true);
    });
  });

  describe('non-production (dev/test)', () => {
    beforeEach(() => { process.env.NODE_ENV = 'development'; });

    test('returns false when AUTH_REQUIRED is not "true"', () => {
      process.env.AZURE_AD_CLIENT_ID = 'id';
      process.env.AZURE_AD_CLIENT_SECRET = 'secret';
      process.env.AZURE_AD_TENANT_ID = 'tenant';
      // AUTH_REQUIRED missing
      expect(isAuthRequired()).toBe(false);
    });

    test('returns false when Azure credentials are missing', () => {
      process.env.AUTH_REQUIRED = 'true';
      // No creds
      expect(isAuthRequired()).toBe(false);
    });

    test('returns true when both AUTH_REQUIRED=true and creds present', () => {
      process.env.AUTH_REQUIRED = 'true';
      process.env.AZURE_AD_CLIENT_ID = 'id';
      process.env.AZURE_AD_CLIENT_SECRET = 'secret';
      process.env.AZURE_AD_TENANT_ID = 'tenant';
      expect(isAuthRequired()).toBe(true);
    });
  });

  describe('warning behavior', () => {
    test('logs the bypass warning at most once per process', () => {
      process.env.NODE_ENV = 'production';
      process.env.EMERGENCY_AUTH_BYPASS = 'true';
      isAuthRequired();
      isAuthRequired();
      isAuthRequired();
      expect(console.warn).toHaveBeenCalledTimes(1);
    });

    test('logs the misconfig errors at most once per process even across many calls', () => {
      process.env.NODE_ENV = 'production';
      // No AUTH_REQUIRED, no creds — both error paths fire.
      for (let i = 0; i < 5; i++) isAuthRequired();
      // Two distinct error reasons (AUTH_REQUIRED + creds) → two messages, no repeats.
      expect(console.error).toHaveBeenCalledTimes(2);
    });
  });
});
