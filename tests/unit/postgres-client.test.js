'use strict';

/**
 * Unit tests for the Postgres driver seam (lib/postgres/client.js), plan
 * §4 item 1 / Stage 2 (docs/plans/POSTGRES_ACCESS_LAYER_MIGRATION_PLAN_2026-09-23.md).
 *
 * Mocked driver — allowed here because these tests exercise control flow
 * (release-on-error, rollback-does-not-mask, singleton lazy pool), never
 * SQL against a real planner. The real-planner contract lives in
 * tests/pg-contract/postgres-client.test.js.
 *
 * Every test that touches the module-level `getPool()` singleton runs
 * inside `jest.isolateModules` with its own `require('@vercel/postgres')`
 * / `require('pg')` mocks so the singleton and the mock call counts never
 * leak across tests.
 */

function mockVercelPostgres() {
  const client = { query: jest.fn(), release: jest.fn() };
  const db = { connect: jest.fn().mockResolvedValue(client) };
  const sql = jest.fn();
  jest.doMock('@vercel/postgres', () => ({ sql, db }));
  return { client, db, sql };
}

function mockPg() {
  const poolInstances = [];
  const Pool = jest.fn().mockImplementation((options) => {
    const instance = {
      options,
      connect: jest.fn(),
      query: jest.fn(),
      end: jest.fn(),
    };
    poolInstances.push(instance);
    return instance;
  });
  jest.doMock('pg', () => ({ Pool }));
  return { Pool, poolInstances };
}

describe('lib/postgres/client', () => {
  const ORIGINAL_ENV = process.env;

  beforeEach(() => {
    jest.resetModules();
    process.env = { ...ORIGINAL_ENV };
    delete process.env.POSTGRES_URL;
    delete process.env.DATABASE_URL;
  });

  afterAll(() => {
    process.env = ORIGINAL_ENV;
  });

  test('public exports are exactly sql, withClient, withTransaction, getPool (db is internal-only)', () => {
    jest.isolateModules(() => {
      mockVercelPostgres();
      mockPg();
      const mod = require('../../lib/postgres/client');
      expect(Object.keys(mod).sort()).toEqual(
        ['getPool', 'sql', 'withClient', 'withTransaction'].sort()
      );
      expect(mod.db).toBeUndefined();
    });
  });

  test('sql is re-exported unchanged from @vercel/postgres', () => {
    jest.isolateModules(() => {
      const { sql } = mockVercelPostgres();
      mockPg();
      const mod = require('../../lib/postgres/client');
      expect(mod.sql).toBe(sql);
    });
  });

  describe('withClient', () => {
    test('returns fn value and releases with no argument on success', async () => {
      let result;
      await jest.isolateModulesAsync(async () => {
        const { client, db } = mockVercelPostgres();
        mockPg();
        const { withClient } = require('../../lib/postgres/client');
        result = await withClient(async (c) => {
          expect(c).toBe(client);
          await c.query('SELECT 1');
          return 'fn-result';
        });
        expect(client.query).toHaveBeenCalledWith('SELECT 1');
        expect(db.connect).toHaveBeenCalledTimes(1);
        expect(client.release).toHaveBeenCalledTimes(1);
        expect(client.release).toHaveBeenCalledWith();
      });
      expect(result).toBe('fn-result');
    });

    test('releases with the thrown error and rethrows on failure', async () => {
      await jest.isolateModulesAsync(async () => {
        const { client } = mockVercelPostgres();
        mockPg();
        const { withClient } = require('../../lib/postgres/client');
        const boom = new Error('boom');
        await expect(withClient(async () => {
          throw boom;
        })).rejects.toBe(boom);
        expect(client.release).toHaveBeenCalledTimes(1);
        expect(client.release).toHaveBeenCalledWith(boom);
      });
    });

    test('releases with true (not the falsy thrown value) when fn throws undefined', async () => {
      await jest.isolateModulesAsync(async () => {
        const { client } = mockVercelPostgres();
        mockPg();
        const { withClient } = require('../../lib/postgres/client');
        await expect(withClient(async () => {
          // eslint-disable-next-line no-throw-literal
          throw undefined;
        })).rejects.toBeUndefined();
        expect(client.release).toHaveBeenCalledTimes(1);
        expect(client.release).toHaveBeenCalledWith(true);
      });
    });
  });

  describe('withTransaction', () => {
    test('issues BEGIN then COMMIT and returns fn value on success', async () => {
      let result;
      await jest.isolateModulesAsync(async () => {
        const { client } = mockVercelPostgres();
        mockPg();
        const { withTransaction } = require('../../lib/postgres/client');
        result = await withTransaction(async (c) => {
          await c.query('INSERT INTO t VALUES (1)');
          return 'tx-result';
        });
        const calls = client.query.mock.calls.map((args) => args[0]);
        expect(calls).toEqual(['BEGIN', 'INSERT INTO t VALUES (1)', 'COMMIT']);
        expect(client.release).toHaveBeenCalledWith();
      });
      expect(result).toBe('tx-result');
    });

    test('issues ROLLBACK and rethrows the original error on failure', async () => {
      await jest.isolateModulesAsync(async () => {
        const { client } = mockVercelPostgres();
        mockPg();
        const { withTransaction } = require('../../lib/postgres/client');
        const original = new Error('original failure');
        await expect(withTransaction(async () => {
          throw original;
        })).rejects.toBe(original);
        const calls = client.query.mock.calls.map((args) => args[0]);
        expect(calls).toEqual(['BEGIN', 'ROLLBACK']);
        // withClient still sees the throw and releases destructively.
        expect(client.release).toHaveBeenCalledWith(original);
      });
    });

    test('rethrows the ORIGINAL error even when ROLLBACK itself throws', async () => {
      await jest.isolateModulesAsync(async () => {
        const { client } = mockVercelPostgres();
        mockPg();
        const { withTransaction } = require('../../lib/postgres/client');
        const original = new Error('original failure');
        const rollbackFailure = new Error('rollback failure');
        client.query.mockImplementation((text) => {
          if (text === 'ROLLBACK') return Promise.reject(rollbackFailure);
          return Promise.resolve({ rows: [] });
        });
        await expect(withTransaction(async () => {
          throw original;
        })).rejects.toBe(original);
      });
    });

    test('COMMIT rejecting rethrows commitErr with no ROLLBACK and destroys the connection', async () => {
      await jest.isolateModulesAsync(async () => {
        const { client } = mockVercelPostgres();
        mockPg();
        const { withTransaction } = require('../../lib/postgres/client');
        const commitErr = new Error('commit failure');
        client.query.mockImplementation((text) => {
          if (text === 'COMMIT') return Promise.reject(commitErr);
          return Promise.resolve({ rows: [] });
        });
        await expect(withTransaction(async (c) => {
          await c.query('INSERT INTO t VALUES (1)');
          return 'unused';
        })).rejects.toBe(commitErr);
        const calls = client.query.mock.calls.map((args) => args[0]);
        expect(calls).toEqual(['BEGIN', 'INSERT INTO t VALUES (1)', 'COMMIT']);
        expect(calls).not.toContain('ROLLBACK');
        expect(client.release).toHaveBeenCalledWith(commitErr);
      });
    });
  });

  describe('getPool', () => {
    test('is a lazy singleton not constructed at import time', () => {
      jest.isolateModules(() => {
        mockVercelPostgres();
        const { Pool } = mockPg();
        process.env.POSTGRES_URL = 'postgres://example/db';
        const { getPool } = require('../../lib/postgres/client');
        expect(Pool).not.toHaveBeenCalled();
        const first = getPool();
        expect(Pool).toHaveBeenCalledTimes(1);
        const second = getPool();
        expect(Pool).toHaveBeenCalledTimes(1);
        expect(second).toBe(first);
      });
    });

    test('resolves connectionString from POSTGRES_URL when set', () => {
      jest.isolateModules(() => {
        mockVercelPostgres();
        const { Pool } = mockPg();
        process.env.POSTGRES_URL = 'postgres://from-postgres-url/db';
        process.env.DATABASE_URL = 'postgres://from-database-url/db';
        const { getPool } = require('../../lib/postgres/client');
        getPool();
        expect(Pool).toHaveBeenCalledWith({ connectionString: 'postgres://from-postgres-url/db' });
      });
    });

    test('falls back to DATABASE_URL when POSTGRES_URL is absent', () => {
      jest.isolateModules(() => {
        mockVercelPostgres();
        const { Pool } = mockPg();
        process.env.DATABASE_URL = 'postgres://from-database-url/db';
        const { getPool } = require('../../lib/postgres/client');
        getPool();
        expect(Pool).toHaveBeenCalledWith({ connectionString: 'postgres://from-database-url/db' });
      });
    });

    test('throws a clear error naming both variables when neither is set', () => {
      jest.isolateModules(() => {
        mockVercelPostgres();
        mockPg();
        const { getPool } = require('../../lib/postgres/client');
        expect(() => getPool()).toThrow(/POSTGRES_URL/);
        expect(() => getPool()).toThrow(/DATABASE_URL/);
      });
    });
  });
});
