/**
 * DAL-universal guard (`assertDataverseAccess` / `resolveDalUniversalMode`,
 * lib/services/dynamics-context.js). A SEPARATE, wider-surface rollout from
 * the existing `DATAVERSE_DAL_ENFORCEMENT` entity-CRUD enforcement: this
 * guard covers the previously-unguarded `lib/dataverse/client.js` write
 * boundary (POST/PATCH/DELETE), starting in WARN-MODE (observability, no
 * throws) so it can be proven safe before ever gated `on`.
 *
 * A census this session confirmed every current entry point of the two first
 * call sites (dataverse-prefs-service.js, dataverse-app-access-service.js)
 * runs with NO trusted context — so `DATAVERSE_DAL_UNIVERSAL` unset MUST be a
 * verified no-op (default `off`), or this change would break new-user
 * sign-in and prefs/app-access routes today.
 *
 * @jest-environment node
 */

import { jest } from '@jest/globals';
import {
  assertDataverseAccess,
  resolveDalUniversalMode,
} from '../../lib/services/dynamics-context.js';
import { withDalContext } from '../../lib/dataverse/core/context.js';

const FLAG = 'DATAVERSE_DAL_UNIVERSAL';
let savedFlag;

beforeEach(() => {
  savedFlag = process.env[FLAG];
  delete process.env[FLAG];
});

afterEach(() => {
  jest.restoreAllMocks();
  if (savedFlag === undefined) {
    delete process.env[FLAG];
  } else {
    process.env[FLAG] = savedFlag;
  }
});

describe('resolveDalUniversalMode', () => {
  test('defaults to off when unset', () => {
    expect(resolveDalUniversalMode()).toBe('off');
  });

  test('invalid value falls back to off with a console.warn', () => {
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
    process.env[FLAG] = 'bogus';
    expect(resolveDalUniversalMode()).toBe('off');
    expect(warnSpy).toHaveBeenCalledTimes(1);
    expect(warnSpy.mock.calls[0][0]).toMatch(/invalid/i);
  });
});

describe('assertDataverseAccess — unset flag is a no-op', () => {
  test('no throw, no warn, with no trusted context', () => {
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
    expect(() => assertDataverseAccess('test-caller')).not.toThrow();
    expect(warnSpy).not.toHaveBeenCalled();
  });

  test('no throw, no warn, with a trusted context present', async () => {
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
    await withDalContext('test-entry-point', () => {
      expect(() => assertDataverseAccess('test-caller')).not.toThrow();
    });
    expect(warnSpy).not.toHaveBeenCalled();
  });
});

describe('assertDataverseAccess — warn mode', () => {
  test('no trusted context: warns once, never throws', () => {
    process.env[FLAG] = 'warn';
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
    expect(() => assertDataverseAccess('test-caller')).not.toThrow();
    expect(warnSpy).toHaveBeenCalledTimes(1);
    expect(warnSpy.mock.calls[0][0]).toBe(
      '[dal-universal] test-caller executed without trusted Dataverse context'
    );
  });

  test('trusted context present: no warn, no throw', async () => {
    process.env[FLAG] = 'warn';
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
    await withDalContext('test-entry-point', () => {
      expect(() => assertDataverseAccess('test-caller')).not.toThrow();
    });
    expect(warnSpy).not.toHaveBeenCalled();
  });
});

describe('assertDataverseAccess — on mode', () => {
  test('no trusted context: throws', () => {
    process.env[FLAG] = 'on';
    expect(() => assertDataverseAccess('test-caller')).toThrow(
      /no trusted Dataverse context/
    );
    expect(() => assertDataverseAccess('test-caller')).toThrow(Error);
  });

  test('trusted context present: no throw', async () => {
    process.env[FLAG] = 'on';
    await withDalContext('test-entry-point', () => {
      expect(() => assertDataverseAccess('test-caller')).not.toThrow();
    });
  });
});
