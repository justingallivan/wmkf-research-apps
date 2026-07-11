/**
 * Stage 1 (docs/DATAVERSE_TARGET_WRITE_INTERLOCK_PLAN.md) — table-driven
 * tests for the pure policy module `lib/dataverse/core/interlock.js`. No
 * hook wiring exists yet (Stage 2); this suite only exercises the exported
 * policy functions directly. Follows the style of
 * tests/unit/dal-enforcement.test.js (save/restore env in beforeEach/afterEach).
 *
 * @jest-environment node
 */

import { jest } from '@jest/globals';
import {
  classifyDeployment,
  classifyTarget,
  resolveInterlockMode,
  shouldInspectDataverseUrl,
  assertDataverseOperationAllowed,
  _resetInterlockStateForTests,
} from '../../lib/dataverse/core/interlock.js';
import { PRODUCTION_HOSTS, SANDBOX_HOSTS } from '../../lib/dataverse/core/target-registry.js';

const PROD_URL = `https://${PRODUCTION_HOSTS[0]}/api/data/v9.2/contacts`;
const PROD_RECORD_URL = `https://${PRODUCTION_HOSTS[0]}/api/data/v9.2/contacts(11111111-1111-1111-1111-111111111111)`;
const PROD_BATCH_URL = `https://${PRODUCTION_HOSTS[0]}/api/data/v9.2/$batch`;
const PROD_BOUND_ACTION_URL = `https://${PRODUCTION_HOSTS[0]}/api/data/v9.2/emails(11111111-1111-1111-1111-111111111111)/Microsoft.Dynamics.CRM.SendEmail`;
const PROD_REF_URL = `https://${PRODUCTION_HOSTS[0]}/api/data/v9.2/akoya_requests(11111111-1111-1111-1111-111111111111)/some_navigation_property/$ref`;
const PROD_MALFORMED_URL = `https://${PRODUCTION_HOSTS[0]}/not-an-odata-path`;
const PROD_COLLECTION_BOUND_ACTION_URL = `https://${PRODUCTION_HOSTS[0]}/api/data/v9.2/contacts/Microsoft.Dynamics.CRM.SomeAction`;
const PROD_ALT_KEY_URL = `https://${PRODUCTION_HOSTS[0]}/api/data/v9.2/wmkf_reviewquestions(wmkf_questionkey='q1')`;
const PROD_COMPOSITE_ALT_KEY_URL = `https://${PRODUCTION_HOSTS[0]}/api/data/v9.2/wmkf_answers(_wmkf_appreviewersuggestion_value=11111111-1111-1111-1111-111111111111,wmkf_questionkey='q1')`;
const PROD_UPPERCASE_GUID_URL = `https://${PRODUCTION_HOSTS[0]}/api/data/v9.2/contacts(11111111-1111-1111-1111-111111111111)`.replace(
  '11111111-1111-1111-1111-111111111111',
  '11111111-1111-1111-1111-111111111111'.toUpperCase(),
);
const SANDBOX_URL = `https://${SANDBOX_HOSTS[0]}/api/data/v9.2/contacts`;
const UNKNOWN_URL = 'https://someorg.crm.dynamics.com/api/data/v9.2/contacts';

const ENV_KEYS = [
  'VERCEL_ENV',
  'NODE_ENV',
  'DATAVERSE_TARGET_INTERLOCK',
  'DATAVERSE_ALLOW_PROD_READS',
  'DATAVERSE_PROD_WRITE_ACK',
  'DATAVERSE_REHEARSAL_GRANT',
  'DYNAMICS_URL',
  'DYNAMICS_SANDBOX_URL',
];

let savedEnv;

beforeEach(() => {
  savedEnv = {};
  for (const key of ENV_KEYS) savedEnv[key] = process.env[key];
  // Tests set NODE_ENV/VERCEL_ENV explicitly per case; clear the jest-set
  // NODE_ENV=test default so classifyDeployment() cases are unambiguous.
  delete process.env.VERCEL_ENV;
  // The prod-write-ack log gate is once-per-process by design; reset it so
  // one test's ack-allowed call doesn't silence the next test's assertion.
  _resetInterlockStateForTests();
});

afterEach(() => {
  jest.restoreAllMocks();
  for (const key of ENV_KEYS) {
    if (savedEnv[key] === undefined) delete process.env[key];
    else process.env[key] = savedEnv[key];
  }
});

function setDeployment(deployment) {
  if (deployment === 'production') {
    process.env.VERCEL_ENV = 'production';
    delete process.env.NODE_ENV;
  } else if (deployment === 'preview') {
    process.env.VERCEL_ENV = 'preview';
    delete process.env.NODE_ENV;
  } else if (deployment === 'test') {
    delete process.env.VERCEL_ENV;
    process.env.NODE_ENV = 'test';
  } else {
    // local
    delete process.env.VERCEL_ENV;
    process.env.NODE_ENV = 'development';
  }
}

describe('classifyDeployment', () => {
  test('VERCEL_ENV=production -> production', () => {
    setDeployment('production');
    expect(classifyDeployment()).toBe('production');
  });

  test('VERCEL_ENV=preview -> preview', () => {
    setDeployment('preview');
    expect(classifyDeployment()).toBe('preview');
  });

  test('NODE_ENV=test (no VERCEL_ENV) -> test', () => {
    setDeployment('test');
    expect(classifyDeployment()).toBe('test');
  });

  test('everything else -> local', () => {
    setDeployment('local');
    expect(classifyDeployment()).toBe('local');
  });
});

describe('classifyTarget', () => {
  test('production host -> production', () => {
    expect(classifyTarget(PROD_URL)).toBe('production');
  });

  test('sandbox host -> sandbox', () => {
    expect(classifyTarget(SANDBOX_URL)).toBe('sandbox');
  });

  test('unlisted *.crm.dynamics.com host -> unknown', () => {
    expect(classifyTarget(UNKNOWN_URL)).toBe('unknown');
  });

  test('non-Dataverse host -> unknown', () => {
    expect(classifyTarget('https://login.microsoftonline.com/token')).toBe('unknown');
  });

  test('malformed URL -> unknown', () => {
    expect(classifyTarget('not-a-url')).toBe('unknown');
  });
});

describe('resolveInterlockMode', () => {
  test('unset -> off', () => {
    delete process.env.DATAVERSE_TARGET_INTERLOCK;
    expect(resolveInterlockMode()).toBe('off');
  });

  test('empty string -> off', () => {
    process.env.DATAVERSE_TARGET_INTERLOCK = '';
    expect(resolveInterlockMode()).toBe('off');
  });

  test('off/warn/on pass through', () => {
    for (const mode of ['off', 'warn', 'on']) {
      process.env.DATAVERSE_TARGET_INTERLOCK = mode;
      expect(resolveInterlockMode()).toBe(mode);
    }
  });

  test('invalid value -> on, with one console.warn naming the value', () => {
    process.env.DATAVERSE_TARGET_INTERLOCK = 'bogus';
    const spy = jest.spyOn(console, 'warn').mockImplementation(() => {});
    expect(resolveInterlockMode()).toBe('on');
    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy.mock.calls[0][0]).toMatch(/\[dataverse-interlock\]/);
    expect(spy.mock.calls[0][0]).toContain(JSON.stringify('bogus'));
    expect(spy.mock.calls[0][0]).toMatch(/falling back to 'on'/);
  });
});

describe('shouldInspectDataverseUrl', () => {
  test('registry host -> true', () => {
    expect(shouldInspectDataverseUrl(PROD_URL)).toBe(true);
  });

  test('unlisted *.crm.dynamics.com host -> true', () => {
    expect(shouldInspectDataverseUrl(UNKNOWN_URL)).toBe(true);
  });

  test('login.microsoftonline.com -> false', () => {
    expect(shouldInspectDataverseUrl('https://login.microsoftonline.com/token')).toBe(false);
  });

  test('graph.microsoft.com -> false', () => {
    expect(shouldInspectDataverseUrl('https://graph.microsoft.com/v1.0/me')).toBe(false);
  });

  test('host matching DYNAMICS_URL env -> true even for a non-dynamics domain', () => {
    process.env.DYNAMICS_URL = 'https://custom.example.test/api/data/v9.2';
    expect(shouldInspectDataverseUrl('https://custom.example.test/anything')).toBe(true);
  });

  test('host matching DYNAMICS_SANDBOX_URL env -> true even for a non-dynamics domain', () => {
    process.env.DYNAMICS_SANDBOX_URL = 'https://sandbox.custom.example.test/api/data/v9.2';
    expect(shouldInspectDataverseUrl('https://sandbox.custom.example.test/anything')).toBe(true);
  });
});

describe('assertDataverseOperationAllowed — URL scoping', () => {
  test('parseable non-Dataverse URLs are skipped with no logging', () => {
    process.env.DATAVERSE_TARGET_INTERLOCK = 'on';
    setDeployment('preview');
    const spy = jest.spyOn(console, 'warn').mockImplementation(() => {});

    expect(() =>
      assertDataverseOperationAllowed({
        url: 'https://login.microsoftonline.com/token',
        method: 'POST',
        callerLabel: 'test',
      }),
    ).not.toThrow();
    expect(spy).not.toHaveBeenCalled();
  });

  test('malformed URLs are not skipped and still fail closed', () => {
    process.env.DATAVERSE_TARGET_INTERLOCK = 'on';
    setDeployment('preview');

    expect(() =>
      assertDataverseOperationAllowed({ url: 'not-a-url', method: 'POST', callerLabel: 'test' }),
    ).toThrow(/target=unknown/);
  });
});

describe('assertDataverseOperationAllowed — off mode is a strict no-op', () => {
  test('never evaluates policy, even for a would-be-denied call', () => {
    process.env.DATAVERSE_TARGET_INTERLOCK = 'off';
    setDeployment('production');
    const spy = jest.spyOn(console, 'warn').mockImplementation(() => {});
    expect(() =>
      assertDataverseOperationAllowed({ url: SANDBOX_URL, method: 'POST', callerLabel: 'test' }),
    ).not.toThrow();
    expect(spy).not.toHaveBeenCalled();
  });
});

// Full deployment x target x operation matrix (plan §3.2), run once per mode.
const MATRIX = [
  // deployment, target, method, allowed, label
  ['production', 'production', 'GET', true, 'prod app, prod target, read'],
  ['production', 'production', 'POST', true, 'prod app, prod target, write'],
  ['production', 'sandbox', 'GET', false, 'prod app, sandbox target, read'],
  ['production', 'sandbox', 'POST', false, 'prod app, sandbox target, write'],
  ['production', 'unknown', 'GET', false, 'prod app, unknown target, read'],
  ['production', 'unknown', 'POST', false, 'prod app, unknown target, write'],
  ['preview', 'production', 'GET', false, 'preview, prod target, read (no allow-prod-reads)'],
  ['preview', 'production', 'POST', false, 'preview, prod target, write'],
  ['local', 'production', 'GET', false, 'local, prod target, read (no allow-prod-reads)'],
  ['local', 'production', 'POST', false, 'local, prod target, write'],
  ['test', 'production', 'GET', false, 'test, prod target, read (no allow-prod-reads)'],
  ['test', 'production', 'POST', false, 'test, prod target, write'],
  ['preview', 'sandbox', 'GET', true, 'preview, sandbox target, read'],
  ['preview', 'sandbox', 'POST', true, 'preview, sandbox target, write'],
  ['local', 'sandbox', 'GET', true, 'local, sandbox target, read'],
  ['local', 'sandbox', 'POST', true, 'local, sandbox target, write'],
  ['test', 'sandbox', 'GET', true, 'test, sandbox target, read'],
  ['test', 'sandbox', 'POST', true, 'test, sandbox target, write'],
  ['preview', 'unknown', 'GET', false, 'preview, unknown target, read'],
  ['preview', 'unknown', 'POST', false, 'preview, unknown target, write'],
  ['local', 'unknown', 'GET', false, 'local, unknown target, read'],
  ['local', 'unknown', 'POST', false, 'local, unknown target, write'],
  ['test', 'unknown', 'GET', false, 'test, unknown target, read'],
  ['test', 'unknown', 'POST', false, 'test, unknown target, write'],
];

function urlFor(target) {
  if (target === 'production') return PROD_URL;
  if (target === 'sandbox') return SANDBOX_URL;
  return UNKNOWN_URL;
}

describe.each(MATRIX)(
  '%s deployment x %s target x %s — %s',
  (deployment, target, method, allowed, _label) => {
    test('warn mode: never throws; logs iff denied', () => {
      process.env.DATAVERSE_TARGET_INTERLOCK = 'warn';
      setDeployment(deployment);
      const spy = jest.spyOn(console, 'warn').mockImplementation(() => {});
      const url = urlFor(target);
      expect(() =>
        assertDataverseOperationAllowed({ url, method, callerLabel: 'test-caller' }),
      ).not.toThrow();
      if (allowed) {
        expect(spy).not.toHaveBeenCalled();
      } else {
        expect(spy).toHaveBeenCalledTimes(1);
        expect(spy.mock.calls[0][0]).toMatch(/^\[dataverse-interlock\] would deny:/);
      }
    });

    test('on mode: throws iff denied, error names class/target/method/caller/flag', () => {
      process.env.DATAVERSE_TARGET_INTERLOCK = 'on';
      setDeployment(deployment);
      const url = urlFor(target);
      if (allowed) {
        expect(() =>
          assertDataverseOperationAllowed({ url, method, callerLabel: 'test-caller' }),
        ).not.toThrow();
      } else {
        expect(() =>
          assertDataverseOperationAllowed({ url, method, callerLabel: 'test-caller' }),
        ).toThrow(
          new RegExp(
            `deployment=${deployment}.*target=${target}.*method=${method}.*caller=test-caller.*DATAVERSE_TARGET_INTERLOCK`,
          ),
        );
      }
    });
  },
);

describe('DATAVERSE_ALLOW_PROD_READS exception', () => {
  test('preview + prod target + read is allowed when DATAVERSE_ALLOW_PROD_READS=yes', () => {
    process.env.DATAVERSE_TARGET_INTERLOCK = 'on';
    process.env.DATAVERSE_ALLOW_PROD_READS = 'yes';
    setDeployment('preview');
    expect(() =>
      assertDataverseOperationAllowed({ url: PROD_URL, method: 'GET', callerLabel: 'test' }),
    ).not.toThrow();
  });

  test('any other value is treated as no', () => {
    process.env.DATAVERSE_TARGET_INTERLOCK = 'on';
    process.env.DATAVERSE_ALLOW_PROD_READS = 'true';
    setDeployment('preview');
    expect(() =>
      assertDataverseOperationAllowed({ url: PROD_URL, method: 'GET', callerLabel: 'test' }),
    ).toThrow();
  });

  test('does not unlock writes', () => {
    process.env.DATAVERSE_TARGET_INTERLOCK = 'on';
    process.env.DATAVERSE_ALLOW_PROD_READS = 'yes';
    setDeployment('preview');
    expect(() =>
      assertDataverseOperationAllowed({ url: PROD_URL, method: 'POST', callerLabel: 'test' }),
    ).toThrow();
  });
});

describe('DATAVERSE_PROD_WRITE_ACK exception', () => {
  function todayUtc() {
    return new Date().toISOString().slice(0, 10);
  }
  function yesterdayUtc() {
    const d = new Date();
    d.setUTCDate(d.getUTCDate() - 1);
    return d.toISOString().slice(0, 10);
  }

  test('valid-today ack on local deployment allows a prod write', () => {
    process.env.DATAVERSE_TARGET_INTERLOCK = 'on';
    process.env.DATAVERSE_PROD_WRITE_ACK = `backfill grant records ${todayUtc()}`;
    setDeployment('local');
    expect(() =>
      assertDataverseOperationAllowed({ url: PROD_URL, method: 'POST', callerLabel: 'test' }),
    ).not.toThrow();
  });

  test('stale date is rejected', () => {
    process.env.DATAVERSE_TARGET_INTERLOCK = 'on';
    process.env.DATAVERSE_PROD_WRITE_ACK = `backfill grant records ${yesterdayUtc()}`;
    setDeployment('local');
    expect(() =>
      assertDataverseOperationAllowed({ url: PROD_URL, method: 'POST', callerLabel: 'test' }),
    ).toThrow();
  });

  test('is not honored outside the local deployment', () => {
    process.env.DATAVERSE_TARGET_INTERLOCK = 'on';
    process.env.DATAVERSE_PROD_WRITE_ACK = `backfill grant records ${todayUtc()}`;
    setDeployment('preview');
    expect(() =>
      assertDataverseOperationAllowed({ url: PROD_URL, method: 'POST', callerLabel: 'test' }),
    ).toThrow();
  });

  test('malformed value (no trailing date) is treated as absent', () => {
    process.env.DATAVERSE_TARGET_INTERLOCK = 'on';
    process.env.DATAVERSE_PROD_WRITE_ACK = 'backfill grant records';
    setDeployment('local');
    expect(() =>
      assertDataverseOperationAllowed({ url: PROD_URL, method: 'POST', callerLabel: 'test' }),
    ).toThrow();
  });
});

describe('DATAVERSE_REHEARSAL_GRANT exception', () => {
  function futureIso() {
    return new Date(Date.now() + 60 * 60 * 1000).toISOString();
  }
  function pastIso() {
    return new Date(Date.now() - 60 * 60 * 1000).toISOString();
  }

  test('matching op + entitySet allows a POST (create, no record id needed)', () => {
    process.env.DATAVERSE_TARGET_INTERLOCK = 'on';
    process.env.DATAVERSE_REHEARSAL_GRANT = JSON.stringify({
      purpose: 'rehearsal',
      ops: ['POST'],
      entitySets: ['contacts'],
      recordIds: [],
      expiresAt: futureIso(),
    });
    setDeployment('preview');
    expect(() =>
      assertDataverseOperationAllowed({ url: PROD_URL, method: 'POST', callerLabel: 'test' }),
    ).not.toThrow();
  });

  test('PATCH requires the record GUID to be in recordIds', () => {
    process.env.DATAVERSE_TARGET_INTERLOCK = 'on';
    process.env.DATAVERSE_REHEARSAL_GRANT = JSON.stringify({
      purpose: 'rehearsal',
      ops: ['PATCH'],
      entitySets: ['contacts'],
      recordIds: ['11111111-1111-1111-1111-111111111111'],
      expiresAt: futureIso(),
    });
    setDeployment('preview');
    expect(() =>
      assertDataverseOperationAllowed({ url: PROD_RECORD_URL, method: 'PATCH', callerLabel: 'test' }),
    ).not.toThrow();
  });

  test('PATCH to a record GUID not in recordIds is denied', () => {
    process.env.DATAVERSE_TARGET_INTERLOCK = 'on';
    process.env.DATAVERSE_REHEARSAL_GRANT = JSON.stringify({
      purpose: 'rehearsal',
      ops: ['PATCH'],
      entitySets: ['contacts'],
      recordIds: ['22222222-2222-2222-2222-222222222222'],
      expiresAt: futureIso(),
    });
    setDeployment('preview');
    expect(() =>
      assertDataverseOperationAllowed({ url: PROD_RECORD_URL, method: 'PATCH', callerLabel: 'test' }),
    ).toThrow();
  });

  test('op not in ops is denied', () => {
    process.env.DATAVERSE_TARGET_INTERLOCK = 'on';
    process.env.DATAVERSE_REHEARSAL_GRANT = JSON.stringify({
      purpose: 'rehearsal',
      ops: ['POST'],
      entitySets: ['contacts'],
      recordIds: [],
      expiresAt: futureIso(),
    });
    setDeployment('preview');
    expect(() =>
      assertDataverseOperationAllowed({ url: PROD_RECORD_URL, method: 'PATCH', callerLabel: 'test' }),
    ).toThrow();
  });

  test('entitySet not in entitySets is denied', () => {
    process.env.DATAVERSE_TARGET_INTERLOCK = 'on';
    process.env.DATAVERSE_REHEARSAL_GRANT = JSON.stringify({
      purpose: 'rehearsal',
      ops: ['POST'],
      entitySets: ['accounts'],
      recordIds: [],
      expiresAt: futureIso(),
    });
    setDeployment('preview');
    expect(() =>
      assertDataverseOperationAllowed({ url: PROD_URL, method: 'POST', callerLabel: 'test' }),
    ).toThrow();
  });

  test('expired grant is treated as absent', () => {
    process.env.DATAVERSE_TARGET_INTERLOCK = 'on';
    process.env.DATAVERSE_REHEARSAL_GRANT = JSON.stringify({
      purpose: 'rehearsal',
      ops: ['POST'],
      entitySets: ['contacts'],
      recordIds: [],
      expiresAt: pastIso(),
    });
    setDeployment('preview');
    expect(() =>
      assertDataverseOperationAllowed({ url: PROD_URL, method: 'POST', callerLabel: 'test' }),
    ).toThrow();
  });

  test('malformed JSON is treated as absent', () => {
    process.env.DATAVERSE_TARGET_INTERLOCK = 'on';
    process.env.DATAVERSE_REHEARSAL_GRANT = '{ not json';
    setDeployment('preview');
    expect(() =>
      assertDataverseOperationAllowed({ url: PROD_URL, method: 'POST', callerLabel: 'test' }),
    ).toThrow();
  });

  test('$batch write is denied even when POST is in ops (no "BATCH" escape hatch)', () => {
    process.env.DATAVERSE_TARGET_INTERLOCK = 'on';
    process.env.DATAVERSE_REHEARSAL_GRANT = JSON.stringify({
      purpose: 'rehearsal',
      ops: ['POST'],
      entitySets: ['contacts'],
      recordIds: [],
      expiresAt: futureIso(),
    });
    setDeployment('preview');
    expect(() =>
      assertDataverseOperationAllowed({ url: PROD_BATCH_URL, method: 'POST', callerLabel: 'test' }),
    ).toThrow();
  });

  test('$batch write is denied even when the grant lists "BATCH" in ops — batch is never grant-coverable in v1', () => {
    process.env.DATAVERSE_TARGET_INTERLOCK = 'on';
    process.env.DATAVERSE_REHEARSAL_GRANT = JSON.stringify({
      purpose: 'rehearsal',
      ops: ['POST', 'BATCH'],
      entitySets: ['contacts'],
      recordIds: [],
      expiresAt: futureIso(),
    });
    setDeployment('preview');
    expect(() =>
      assertDataverseOperationAllowed({ url: PROD_BATCH_URL, method: 'POST', callerLabel: 'test' }),
    ).toThrow();
  });

  test('bound-action POST (emails(guid)/SendEmail) matches the grant only when the base entitySet AND recordId are both covered', () => {
    process.env.DATAVERSE_TARGET_INTERLOCK = 'on';
    process.env.DATAVERSE_REHEARSAL_GRANT = JSON.stringify({
      purpose: 'rehearsal',
      ops: ['POST'],
      entitySets: ['emails'],
      recordIds: ['11111111-1111-1111-1111-111111111111'],
      expiresAt: futureIso(),
    });
    setDeployment('preview');
    expect(() =>
      assertDataverseOperationAllowed({ url: PROD_BOUND_ACTION_URL, method: 'POST', callerLabel: 'test' }),
    ).not.toThrow();
  });

  test('bound-action POST with a recordId NOT in the grant is denied', () => {
    process.env.DATAVERSE_TARGET_INTERLOCK = 'on';
    process.env.DATAVERSE_REHEARSAL_GRANT = JSON.stringify({
      purpose: 'rehearsal',
      ops: ['POST'],
      entitySets: ['emails'],
      recordIds: ['22222222-2222-2222-2222-222222222222'],
      expiresAt: futureIso(),
    });
    setDeployment('preview');
    expect(() =>
      assertDataverseOperationAllowed({ url: PROD_BOUND_ACTION_URL, method: 'POST', callerLabel: 'test' }),
    ).toThrow();
  });

  test('$ref DELETE (akoya_requests(guid)/nav/$ref) matches via the base entity set + GUID', () => {
    process.env.DATAVERSE_TARGET_INTERLOCK = 'on';
    process.env.DATAVERSE_REHEARSAL_GRANT = JSON.stringify({
      purpose: 'rehearsal',
      ops: ['DELETE'],
      entitySets: ['akoya_requests'],
      recordIds: ['11111111-1111-1111-1111-111111111111'],
      expiresAt: futureIso(),
    });
    setDeployment('preview');
    expect(() =>
      assertDataverseOperationAllowed({ url: PROD_REF_URL, method: 'DELETE', callerLabel: 'test' }),
    ).not.toThrow();
  });

  test('$ref DELETE with an unlisted GUID is denied', () => {
    process.env.DATAVERSE_TARGET_INTERLOCK = 'on';
    process.env.DATAVERSE_REHEARSAL_GRANT = JSON.stringify({
      purpose: 'rehearsal',
      ops: ['DELETE'],
      entitySets: ['akoya_requests'],
      recordIds: ['22222222-2222-2222-2222-222222222222'],
      expiresAt: futureIso(),
    });
    setDeployment('preview');
    expect(() =>
      assertDataverseOperationAllowed({ url: PROD_REF_URL, method: 'DELETE', callerLabel: 'test' }),
    ).toThrow();
  });

  test('a malformed / non-OData path fails grant matching (fail closed)', () => {
    process.env.DATAVERSE_TARGET_INTERLOCK = 'on';
    process.env.DATAVERSE_REHEARSAL_GRANT = JSON.stringify({
      purpose: 'rehearsal',
      ops: ['POST'],
      entitySets: ['contacts'],
      recordIds: [],
      expiresAt: futureIso(),
    });
    setDeployment('preview');
    expect(() =>
      assertDataverseOperationAllowed({ url: PROD_MALFORMED_URL, method: 'POST', callerLabel: 'test' }),
    ).toThrow();
  });

  test('collection-bound action (no recordId, trailing path) is denied even when ops+entitySets match', () => {
    process.env.DATAVERSE_TARGET_INTERLOCK = 'on';
    process.env.DATAVERSE_REHEARSAL_GRANT = JSON.stringify({
      purpose: 'rehearsal',
      ops: ['POST'],
      entitySets: ['contacts'],
      recordIds: [],
      expiresAt: futureIso(),
    });
    setDeployment('preview');
    expect(() =>
      assertDataverseOperationAllowed({
        url: PROD_COLLECTION_BOUND_ACTION_URL,
        method: 'POST',
        callerLabel: 'test',
      }),
    ).toThrow();
  });

  test('exact collection URL (no trailing path) is still allowed as a create', () => {
    process.env.DATAVERSE_TARGET_INTERLOCK = 'on';
    process.env.DATAVERSE_REHEARSAL_GRANT = JSON.stringify({
      purpose: 'rehearsal',
      ops: ['POST'],
      entitySets: ['contacts'],
      recordIds: [],
      expiresAt: futureIso(),
    });
    setDeployment('preview');
    expect(() =>
      assertDataverseOperationAllowed({ url: PROD_URL, method: 'POST', callerLabel: 'test' }),
    ).not.toThrow();
  });

  test('alternate-key predicate is denied even when that exact string is in recordIds', () => {
    process.env.DATAVERSE_TARGET_INTERLOCK = 'on';
    process.env.DATAVERSE_REHEARSAL_GRANT = JSON.stringify({
      purpose: 'rehearsal',
      ops: ['PATCH'],
      entitySets: ['wmkf_reviewquestions'],
      recordIds: ["wmkf_questionkey='q1'"],
      expiresAt: futureIso(),
    });
    setDeployment('preview');
    expect(() =>
      assertDataverseOperationAllowed({ url: PROD_ALT_KEY_URL, method: 'PATCH', callerLabel: 'test' }),
    ).toThrow();
  });

  test('composite alternate-key predicate is denied', () => {
    process.env.DATAVERSE_TARGET_INTERLOCK = 'on';
    process.env.DATAVERSE_REHEARSAL_GRANT = JSON.stringify({
      purpose: 'rehearsal',
      ops: ['PATCH'],
      entitySets: ['wmkf_answers'],
      recordIds: [
        '_wmkf_appreviewersuggestion_value=11111111-1111-1111-1111-111111111111,wmkf_questionkey=\'q1\'',
      ],
      expiresAt: futureIso(),
    });
    setDeployment('preview');
    expect(() =>
      assertDataverseOperationAllowed({
        url: PROD_COMPOSITE_ALT_KEY_URL,
        method: 'PATCH',
        callerLabel: 'test',
      }),
    ).toThrow();
  });

  test('uppercase-GUID URL matches a lowercase grant entry (case-insensitive compare)', () => {
    process.env.DATAVERSE_TARGET_INTERLOCK = 'on';
    process.env.DATAVERSE_REHEARSAL_GRANT = JSON.stringify({
      purpose: 'rehearsal',
      ops: ['PATCH'],
      entitySets: ['contacts'],
      recordIds: ['11111111-1111-1111-1111-111111111111'],
      expiresAt: futureIso(),
    });
    setDeployment('preview');
    expect(() =>
      assertDataverseOperationAllowed({
        url: PROD_UPPERCASE_GUID_URL,
        method: 'PATCH',
        callerLabel: 'test',
      }),
    ).not.toThrow();
  });

  test('non-GUID garbage in recordIds is ignored — only the valid GUID entry matches', () => {
    process.env.DATAVERSE_TARGET_INTERLOCK = 'on';
    process.env.DATAVERSE_REHEARSAL_GRANT = JSON.stringify({
      purpose: 'rehearsal',
      ops: ['PATCH'],
      entitySets: ['contacts'],
      recordIds: ["wmkf_questionkey='q1'", '11111111-1111-1111-1111-111111111111'],
      expiresAt: futureIso(),
    });
    setDeployment('preview');
    expect(() =>
      assertDataverseOperationAllowed({ url: PROD_RECORD_URL, method: 'PATCH', callerLabel: 'test' }),
    ).not.toThrow();
  });
});

describe('§3.3 exception audit logging (plan §3.3)', () => {
  function todayUtc() {
    return new Date().toISOString().slice(0, 10);
  }
  function futureIso() {
    return new Date(Date.now() + 60 * 60 * 1000).toISOString();
  }

  describe('prod write ack', () => {
    test('logs "PROD WRITE ACK active: <purpose>" once across two allowed calls', () => {
      process.env.DATAVERSE_TARGET_INTERLOCK = 'on';
      process.env.DATAVERSE_PROD_WRITE_ACK = `backfill grant records ${todayUtc()}`;
      setDeployment('local');
      const spy = jest.spyOn(console, 'warn').mockImplementation(() => {});

      assertDataverseOperationAllowed({ url: PROD_URL, method: 'POST', callerLabel: 'test' });
      assertDataverseOperationAllowed({ url: PROD_RECORD_URL, method: 'PATCH', callerLabel: 'test' });

      const ackLogs = spy.mock.calls.filter((call) =>
        /^\[dataverse-interlock\] PROD WRITE ACK active: backfill grant records$/.test(call[0]),
      );
      expect(ackLogs).toHaveLength(1);
    });

    test('does not log in warn mode when the write is denied (no ack present)', () => {
      process.env.DATAVERSE_TARGET_INTERLOCK = 'warn';
      setDeployment('preview');
      const spy = jest.spyOn(console, 'warn').mockImplementation(() => {});

      assertDataverseOperationAllowed({ url: PROD_URL, method: 'POST', callerLabel: 'test' });

      const ackLogs = spy.mock.calls.filter((call) => /PROD WRITE ACK active/.test(call[0]));
      expect(ackLogs).toHaveLength(0);
    });

    test('mode "off" never logs, even with a valid ack present', () => {
      process.env.DATAVERSE_TARGET_INTERLOCK = 'off';
      process.env.DATAVERSE_PROD_WRITE_ACK = `backfill grant records ${todayUtc()}`;
      setDeployment('local');
      const spy = jest.spyOn(console, 'warn').mockImplementation(() => {});

      assertDataverseOperationAllowed({ url: PROD_URL, method: 'POST', callerLabel: 'test' });

      expect(spy).not.toHaveBeenCalled();
    });
  });

  describe('rehearsal grant', () => {
    test('logs a structured line with purpose/method/entitySet for every allowed write', () => {
      process.env.DATAVERSE_TARGET_INTERLOCK = 'on';
      process.env.DATAVERSE_REHEARSAL_GRANT = JSON.stringify({
        purpose: 'rehearsal-audit',
        ops: ['POST', 'PATCH'],
        entitySets: ['contacts'],
        recordIds: ['11111111-1111-1111-1111-111111111111'],
        expiresAt: futureIso(),
      });
      setDeployment('preview');
      const spy = jest.spyOn(console, 'warn').mockImplementation(() => {});

      assertDataverseOperationAllowed({ url: PROD_URL, method: 'POST', callerLabel: 'test' });
      assertDataverseOperationAllowed({ url: PROD_RECORD_URL, method: 'PATCH', callerLabel: 'test' });

      const grantLogs = spy.mock.calls.filter((call) =>
        /^\[dataverse-interlock\] rehearsal grant write allowed:/.test(call[0]),
      );
      expect(grantLogs).toHaveLength(2);
      expect(grantLogs[0][0]).toMatch(/purpose="rehearsal-audit"/);
      expect(grantLogs[0][0]).toMatch(/method=POST/);
      expect(grantLogs[0][0]).toMatch(/entitySet=contacts/);
      expect(grantLogs[0][0]).not.toMatch(/recordId=/);
      expect(grantLogs[1][0]).toMatch(/purpose="rehearsal-audit"/);
      expect(grantLogs[1][0]).toMatch(/method=PATCH/);
      expect(grantLogs[1][0]).toMatch(/entitySet=contacts/);
      expect(grantLogs[1][0]).toMatch(/recordId=11111111-1111-1111-1111-111111111111/);
    });

    test('does not log when the grant does not cover the write (denied path unchanged)', () => {
      process.env.DATAVERSE_TARGET_INTERLOCK = 'on';
      process.env.DATAVERSE_REHEARSAL_GRANT = JSON.stringify({
        purpose: 'rehearsal-audit',
        ops: ['POST'],
        entitySets: ['accounts'],
        recordIds: [],
        expiresAt: futureIso(),
      });
      setDeployment('preview');
      const spy = jest.spyOn(console, 'warn').mockImplementation(() => {});

      expect(() =>
        assertDataverseOperationAllowed({ url: PROD_URL, method: 'POST', callerLabel: 'test' }),
      ).toThrow();

      const grantLogs = spy.mock.calls.filter((call) => /rehearsal grant write allowed/.test(call[0]));
      expect(grantLogs).toHaveLength(0);
    });

    test('mode "off" never logs, even with a covering grant present', () => {
      process.env.DATAVERSE_TARGET_INTERLOCK = 'off';
      process.env.DATAVERSE_REHEARSAL_GRANT = JSON.stringify({
        purpose: 'rehearsal-audit',
        ops: ['POST'],
        entitySets: ['contacts'],
        recordIds: [],
        expiresAt: futureIso(),
      });
      setDeployment('preview');
      const spy = jest.spyOn(console, 'warn').mockImplementation(() => {});

      assertDataverseOperationAllowed({ url: PROD_URL, method: 'POST', callerLabel: 'test' });

      expect(spy).not.toHaveBeenCalled();
    });
  });
});
