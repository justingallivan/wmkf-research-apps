/**
 * Stage 7 (DATA_ACCESS_LAYER_MIGRATION_PLAN.md) — fail-closed entity-CRUD
 * enforcement. Written FIRST per the plan's "Tests before" list, ahead of the
 * enforcement code in `dynamics-service.js` / `lib/dataverse/core/changeset.js`
 * / `lib/dataverse/core/context.js`.
 *
 * Covers:
 *   1. Raw entity CRUD (createRecord/updateRecord/deleteRecord/disassociate)
 *      on DynamicsService THROWS when called with no trusted context, under
 *      enforcement.
 *   2. Adapters (a representative one — contact.js) succeed when called
 *      under a trusted entry-point context (`withDalContext`).
 *   3. `core/changeset.js#runChangeset` throws without a trusted context,
 *      under enforcement — same as raw `executeChangeset`.
 *   4. Enforcement OFF (`DATAVERSE_DAL_ENFORCEMENT=off`) preserves prior
 *      behavior exactly: writes succeed with no context at all.
 *   5. `enterDynamicsBypassForScript` (the scripts' persistent-context
 *      mechanism) still counts as trusted — exempt/script paths keep working.
 *
 * @jest-environment node
 */

import { jest } from '@jest/globals';
import { DynamicsService } from '../../lib/services/dynamics-service.js';
import {
  getDynamicsContext,
  isDalEnforcementOn,
  assertTrustedDalContext,
  bypassDynamicsRestrictions,
  enterDynamicsBypassForScript,
  withDynamicsContext,
} from '../../lib/services/dynamics-context.js';
import { withDalContext, hasTrustedDalContext } from '../../lib/dataverse/core/context.js';
import { runChangeset } from '../../lib/dataverse/core/changeset.js';
import * as contact from '../../lib/dataverse/adapters/contact.js';

beforeAll(() => {
  process.env.DYNAMICS_URL = 'https://example.crm.dynamics.com';
  process.env.DYNAMICS_TENANT_ID = 't';
  process.env.DYNAMICS_CLIENT_ID = 'c';
  process.env.DYNAMICS_CLIENT_SECRET = 's';
});

beforeEach(() => {
  DynamicsService.clearCaches();
});

afterEach(() => {
  jest.restoreAllMocks();
  delete process.env.DATAVERSE_DAL_ENFORCEMENT;
});

describe('isDalEnforcementOn', () => {
  test('jest.setup.js turns enforcement on for the test env by default', () => {
    expect(isDalEnforcementOn()).toBe(true);
  });

  test('DATAVERSE_DAL_ENFORCEMENT=off is an explicit override', () => {
    process.env.DATAVERSE_DAL_ENFORCEMENT = 'off';
    expect(isDalEnforcementOn()).toBe(false);
  });

  test('DATAVERSE_DAL_ENFORCEMENT=on is an explicit override', () => {
    process.env.DATAVERSE_DAL_ENFORCEMENT = 'on';
    expect(isDalEnforcementOn()).toBe(true);
  });
});

describe('assertTrustedDalContext', () => {
  test('no-ops when enforcement is off', () => {
    process.env.DATAVERSE_DAL_ENFORCEMENT = 'off';
    expect(() => assertTrustedDalContext('test-caller')).not.toThrow();
  });

  test('throws outside any context when enforcement is on', () => {
    process.env.DATAVERSE_DAL_ENFORCEMENT = 'on';
    expect(() => assertTrustedDalContext('test-caller')).toThrow(/no trusted Dataverse context/);
  });

  test('no-ops inside a bypass context when enforcement is on', async () => {
    process.env.DATAVERSE_DAL_ENFORCEMENT = 'on';
    await bypassDynamicsRestrictions('test-scope', async () => {
      expect(() => assertTrustedDalContext('test-caller')).not.toThrow();
    });
  });
});

describe('DynamicsService entity CRUD — fail-closed without a trusted context', () => {
  test('createRecord throws before any network call', async () => {
    const spy = jest.spyOn(global, 'fetch');
    await expect(
      DynamicsService.createRecord('wmkf_ai_runs', { foo: 'bar' }),
    ).rejects.toThrow(/no trusted Dataverse context/);
    expect(spy).not.toHaveBeenCalled();
  });

  test('updateRecord throws before any network call', async () => {
    const spy = jest.spyOn(global, 'fetch');
    await expect(
      DynamicsService.updateRecord('akoya_requests', 'guid', { x: 1 }),
    ).rejects.toThrow(/no trusted Dataverse context/);
    expect(spy).not.toHaveBeenCalled();
  });

  test('deleteRecord throws before any network call', async () => {
    const spy = jest.spyOn(global, 'fetch');
    await expect(
      DynamicsService.deleteRecord('wmkf_ai_runs', 'guid'),
    ).rejects.toThrow(/no trusted Dataverse context/);
    expect(spy).not.toHaveBeenCalled();
  });

  test('disassociate throws before any network call', async () => {
    const spy = jest.spyOn(global, 'fetch');
    await expect(
      DynamicsService.disassociate('akoya_requests', 'guid', 'wmkf_PotentialReviewer1'),
    ).rejects.toThrow(/no trusted Dataverse context/);
    expect(spy).not.toHaveBeenCalled();
  });

  test('executeChangeset throws before any network call', async () => {
    const spy = jest.spyOn(global, 'fetch');
    await expect(
      DynamicsService.executeChangeset([{ method: 'PATCH', url: 'akoya_requests(g)', body: { x: 1 } }]),
    ).rejects.toThrow(/no trusted Dataverse context/);
    expect(spy).not.toHaveBeenCalled();
  });

  test('succeeds when called under withDalContext', async () => {
    global.fetch = jest.fn((url) => {
      if (String(url).includes('login.microsoftonline.com')) {
        return Promise.resolve({ ok: true, json: () => Promise.resolve({ access_token: 't', expires_in: 3600 }) });
      }
      return Promise.resolve({ ok: true, json: () => Promise.resolve({ id: '1' }) });
    });
    const created = await withDalContext('test-entry-point', () =>
      DynamicsService.createRecord('wmkf_ai_runs', { foo: 'bar' }),
    );
    expect(created).toEqual({ id: '1' });
  });

  test('succeeds under withDynamicsContext({ restrictions: [], requestId }) — script-style trusted context', async () => {
    global.fetch = jest.fn((url) => {
      if (String(url).includes('login.microsoftonline.com')) {
        return Promise.resolve({ ok: true, json: () => Promise.resolve({ access_token: 't', expires_in: 3600 }) });
      }
      return Promise.resolve({ ok: true, json: () => Promise.resolve({ id: '1' }) });
    });
    const created = await withDynamicsContext({ restrictions: [], requestId: 'x' }, () =>
      DynamicsService.createRecord('wmkf_ai_runs', { foo: 'bar' }),
    );
    expect(created).toEqual({ id: '1' });
  });
});

describe('DynamicsService email writes — fail-closed without a trusted context', () => {
  test('createEmailActivity throws before any network call', async () => {
    const spy = jest.spyOn(global, 'fetch');
    await expect(
      DynamicsService.createEmailActivity({ subject: 's', body: 'b', from: 'a@example.com', to: 'b@example.com' }),
    ).rejects.toThrow(/no trusted Dataverse context/);
    expect(spy).not.toHaveBeenCalled();
  });

  test('addEmailAttachment throws before any network call', async () => {
    const spy = jest.spyOn(global, 'fetch');
    await expect(
      DynamicsService.addEmailAttachment('email-guid', { filename: 'f.txt', contentType: 'text/plain', content: 'x' }),
    ).rejects.toThrow(/no trusted Dataverse context/);
    expect(spy).not.toHaveBeenCalled();
  });

  test('sendEmail throws before any network call', async () => {
    const spy = jest.spyOn(global, 'fetch');
    await expect(
      DynamicsService.sendEmail('email-guid'),
    ).rejects.toThrow(/no trusted Dataverse context/);
    expect(spy).not.toHaveBeenCalled();
  });

  test('createEmailActivity succeeds when called under withDalContext', async () => {
    global.fetch = jest.fn((url) => {
      if (String(url).includes('login.microsoftonline.com')) {
        return Promise.resolve({ ok: true, json: () => Promise.resolve({ access_token: 't', expires_in: 3600 }) });
      }
      if (String(url).includes('systemusers')) {
        return Promise.resolve({ ok: true, json: () => Promise.resolve({ value: [{ systemuserid: 'su-1' }] }) });
      }
      return Promise.resolve({ ok: true, json: () => Promise.resolve({ activityid: 'email-1' }) });
    });
    const activityId = await withDalContext('test-entry-point', () =>
      DynamicsService.createEmailActivity({ subject: 's', body: 'b', from: 'a@example.com', to: 'b@example.com' }),
    );
    expect(activityId).toBe('email-1');
  });

  test('addEmailAttachment succeeds when called under withDalContext', async () => {
    global.fetch = jest.fn((url) => {
      if (String(url).includes('login.microsoftonline.com')) {
        return Promise.resolve({ ok: true, json: () => Promise.resolve({ access_token: 't', expires_in: 3600 }) });
      }
      return Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
    });
    await expect(
      withDalContext('test-entry-point', () =>
        DynamicsService.addEmailAttachment('email-guid', { filename: 'f.txt', contentType: 'text/plain', content: 'x' }),
      ),
    ).resolves.toBeUndefined();
  });

  test('sendEmail succeeds when called under withDalContext', async () => {
    global.fetch = jest.fn((url) => {
      if (String(url).includes('login.microsoftonline.com')) {
        return Promise.resolve({ ok: true, json: () => Promise.resolve({ access_token: 't', expires_in: 3600 }) });
      }
      return Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
    });
    await expect(
      withDalContext('test-entry-point', () => DynamicsService.sendEmail('email-guid')),
    ).resolves.toBeUndefined();
  });
});

describe('core/changeset.js#runChangeset — same fail-closed contract', () => {
  test('throws without a trusted context', () => {
    // runChangeset is a plain (non-async) function: assertTrustedDalContext
    // throws synchronously, before any promise is returned — so this is a
    // sync throw, not a rejection.
    const spy = jest.spyOn(global, 'fetch');
    expect(() =>
      runChangeset([{ method: 'PATCH', entitySet: 'contacts', key: 'g', body: { x: 1 } }]),
    ).toThrow(/no trusted Dataverse context/);
    expect(spy).not.toHaveBeenCalled();
  });

  test('reaches the transport when called under withDalContext', async () => {
    global.fetch = jest.fn((url) => {
      if (String(url).includes('login.microsoftonline.com')) {
        return Promise.resolve({ ok: true, json: () => Promise.resolve({ access_token: 't', expires_in: 3600 }) });
      }
      // Not asserting on the real multipart shape here — just proving the
      // call reaches the transport (any network attempt) rather than
      // throwing on the context guard.
      return Promise.resolve({
        ok: true,
        status: 200,
        headers: { get: () => 'multipart/mixed; boundary=batchresponse_x' },
        text: () => Promise.resolve('--batchresponse_x--'),
      });
    });
    await expect(
      withDalContext('test-entry-point', () =>
        runChangeset([{ method: 'PATCH', entitySet: 'contacts', key: 'g', body: { x: 1 } }]),
      ),
    ).rejects.not.toThrow(/no trusted Dataverse context/);
  });
});

describe('Adapters succeed only under a trusted entry-point context', () => {
  test('contact.findOrCreateByEmail writes fail-closed outside a context', async () => {
    global.fetch = jest.fn((url) => {
      if (String(url).includes('login.microsoftonline.com')) {
        return Promise.resolve({ ok: true, json: () => Promise.resolve({ access_token: 't', expires_in: 3600 }) });
      }
      // findByEmail's queryRecords read would itself throw first
      // ("Restrictions not initialized") since reads have always been
      // fail-closed — either way, no context means no successful write.
      return Promise.resolve({ ok: true, json: () => Promise.resolve({ value: [] }) });
    });
    await expect(
      contact.findOrCreateByEmail({ firstName: 'A', lastName: 'B', email: 'a@example.com' }),
    ).rejects.toThrow();
  });

  test('contact.findOrCreateByEmail creates a new contact under withDalContext', async () => {
    global.fetch = jest.fn((url) => {
      if (String(url).includes('login.microsoftonline.com')) {
        return Promise.resolve({ ok: true, json: () => Promise.resolve({ access_token: 't', expires_in: 3600 }) });
      }
      const method = arguments[1]?.method;
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve({ value: [] }), // findByEmail: no existing row
      });
    });
    // Second call (createRecord) needs its own response; simulate via a
    // sequential mock instead of branching on method (fetch args differ by
    // call site, not always inspectable the same way across environments).
    let call = 0;
    global.fetch = jest.fn((url) => {
      call += 1;
      if (String(url).includes('login.microsoftonline.com')) {
        return Promise.resolve({ ok: true, json: () => Promise.resolve({ access_token: 't', expires_in: 3600 }) });
      }
      if (call === 2) {
        // findByEmail queryRecords
        return Promise.resolve({ ok: true, json: () => Promise.resolve({ value: [] }) });
      }
      // createRecord
      return Promise.resolve({ ok: true, json: () => Promise.resolve({ contactid: 'new-contact-1' }) });
    });

    const result = await withDalContext('test-entry-point', () =>
      contact.findOrCreateByEmail({ firstName: 'A', lastName: 'B', email: 'a@example.com' }),
    );
    expect(result).toEqual({ id: 'new-contact-1', created: true });
  });
});

describe('Enforcement OFF preserves prior (unenforced) behavior exactly', () => {
  test('createRecord succeeds with no context at all when DATAVERSE_DAL_ENFORCEMENT=off', async () => {
    process.env.DATAVERSE_DAL_ENFORCEMENT = 'off';
    global.fetch = jest.fn((url) => {
      if (String(url).includes('login.microsoftonline.com')) {
        return Promise.resolve({ ok: true, json: () => Promise.resolve({ access_token: 't', expires_in: 3600 }) });
      }
      return Promise.resolve({ ok: true, json: () => Promise.resolve({ id: '1' }) });
    });
    const created = await DynamicsService.createRecord('wmkf_ai_runs', { foo: 'bar' });
    expect(created).toEqual({ id: '1' });
  });
});

describe('Exempt/script paths — enterDynamicsBypassForScript still counts as trusted', () => {
  test('hasTrustedDalContext is true once a script enters its persistent bypass', (done) => {
    // enterWith installs the store for the current execution context and its
    // descendants; run in a fresh async tick so it does not leak into other
    // tests via a shared root context.
    setImmediate(() => {
      expect(hasTrustedDalContext()).toBe(false);
      enterDynamicsBypassForScript('test-script');
      expect(hasTrustedDalContext()).toBe(true);
      expect(getDynamicsContext()).toEqual({ restrictions: [], requestId: 'test-script' });
      done();
    });
  });
});
