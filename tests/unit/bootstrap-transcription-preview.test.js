jest.mock('pg', () => ({ Client: jest.fn() }));

const {
  AUTH_TABLES,
  EXPECTED_TRANSCRIPTION_COLUMNS,
  EXPECTED_TRANSCRIPTION_CONSTRAINTS,
  EXPECTED_TRANSCRIPTION_INDEXES,
  runPreviewBootstrap,
  validateTarget,
} = require('../../scripts/bootstrap-transcription-preview');

const targetHost = 'ep-gentle-smoke-b77a6d90-pooler.us-east-2.aws.neon.tech';
const targetEnv = `POSTGRES_URL="postgres://preview:secret@${targetHost}:5432/neondb?sslmode=require"`;
const productionEnv = 'POSTGRES_URL=postgres://prod:secret@ep-production.us-east-2.aws.neon.tech:5432/neondb?sslmode=require';

const { readMigrationManifest, RETIRED_MIGRATIONS } = require('../../scripts/lib/fresh-database-bootstrap');
const manifestRows = readMigrationManifest().map((name) => ({
  name,
  applied_by: RETIRED_MIGRATIONS[name]
    ? 'setup-database.js (retired targets verified absent)'
    : 'setup-database.js (migration SQL executed)',
}));

function providerCatalogRows() {
  return [...AUTH_TABLES].map((relationname) => ({
    schemaname: 'neon_auth', relationname, relkind: 'r', relationowner: 'neon_auth',
  }));
}

function mockClient({ catalogRows = providerCatalogRows(), seedFailure = false, profileCollision = false } = {}) {
  const queries = [];
  return {
    queries,
    async query(sql, params = []) {
      const normalized = sql.replace(/\s+/g, ' ').trim();
      queries.push({ sql: normalized, params });
      if (normalized === 'SELECT current_database() AS database_name') return { rows: [{ database_name: 'neondb' }] };
      if (normalized === 'SHOW transaction_read_only') return { rows: [{ transaction_read_only: 'on' }] };
      if (normalized.includes('FROM pg_catalog.pg_class')) return { rows: catalogRows };
      if (normalized === 'SELECT name, applied_by FROM public.schema_migrations ORDER BY name') return { rows: manifestRows };
      if (normalized.startsWith('SELECT COUNT(*)::int AS count, BOOL_OR')) {
        return { rows: [{ count: profileCollision ? 1 : 0, identity_collision: profileCollision }] };
      }
      if (normalized === 'SELECT COUNT(*)::int AS count FROM public.dynamics_user_roles') return { rows: [{ count: 0 }] };
      if (normalized.startsWith('INSERT INTO public.user_profiles')) {
        if (seedFailure) throw new Error('seed database detail must not escape');
        return { rows: [{ id: 42 }] };
      }
      if (normalized.includes("to_regclass('public.user_profiles')")) {
        return { rows: [{ profiles: 'user_profiles', roles: 'dynamics_user_roles', transcription_jobs: 'transcription_jobs' }] };
      }
      if (normalized.includes('FROM information_schema.columns')) {
        return { rows: EXPECTED_TRANSCRIPTION_COLUMNS.map((column_name) => ({ column_name })) };
      }
      if (normalized.includes('FROM pg_catalog.pg_constraint')) {
        return { rows: EXPECTED_TRANSCRIPTION_CONSTRAINTS.map((conname) => ({ conname })) };
      }
      if (normalized.includes('FROM pg_catalog.pg_indexes')) {
        return { rows: EXPECTED_TRANSCRIPTION_INDEXES.map((indexname) => ({ indexname })) };
      }
      if (normalized.startsWith('SELECT p.id, p.azure_id')) {
        return { rows: [{ id: 42, azure_id: '893369cc-1925-40ec-bbc6-6f12b0684a31', azure_email: 'jgallivan@wmkeck.org', is_active: true, needs_linking: false, role: 'superuser' }] };
      }
      return { rows: [] };
    },
  };
}

describe('preview bootstrap target validation', () => {
  it('accepts only the dedicated endpoint, TLS URL, and a distinct local production host', () => {
    expect(validateTarget(targetEnv, productionEnv).hostname).toBe(targetHost);
  });

  it('rejects a missing target URL and a mismatched endpoint before connecting', () => {
    expect(() => validateTarget('OTHER=value', productionEnv)).toThrow('target_url_missing');
    expect(() => validateTarget(
      'POSTGRES_URL=postgres://x:y@ep-other.us-east-2.aws.neon.tech:5432/neondb?sslmode=require',
      productionEnv,
    )).toThrow('target_endpoint_mismatch');
  });

  it('rejects missing TLS and a normalized production-host collision', () => {
    expect(() => validateTarget(
      `POSTGRES_URL=postgres://x:y@${targetHost}:5432/neondb`, productionEnv,
    )).toThrow('target_url_tls_required');
    expect(() => validateTarget(
      targetEnv,
      `POSTGRES_URL=postgres://prod:secret@${targetHost.replace('-pooler', '')}:5432/neondb?sslmode=require`,
    )).toThrow('target_matches_local_production_host');
  });
});

describe('preview bootstrap operator stages', () => {
  it('preflights the provider fixture, bootstraps public, and commits exact admin identity separately', async () => {
    const client = mockClient();
    const bootstrap = jest.fn(async (db, groups) => {
      expect(db).toBe(client);
      expect(groups).toEqual({ baseGroups: [], supplementalGroups: [] });
    });
    await expect(runPreviewBootstrap({
      client,
      targetUrl: new URL(`postgres://preview:secret@${targetHost}:5432/neondb?sslmode=require`),
      groups: { baseGroups: [], supplementalGroups: [] },
      bootstrap,
    })).resolves.toEqual({ completed: true, schemaCommitted: true, adminCommitted: true });

    expect(bootstrap).toHaveBeenCalledTimes(1);
    expect(client.queries.filter(({ sql }) => sql === 'BEGIN READ ONLY')).toHaveLength(1);
    expect(client.queries.filter(({ sql }) => sql === 'BEGIN')).toHaveLength(1);
    expect(client.queries.filter(({ sql }) => sql === 'COMMIT')).toHaveLength(2);
    expect(client.queries.some(({ sql }) => /INSERT INTO neon_auth/i.test(sql))).toBe(false);
    expect(client.queries.some(({ sql }) => /INSERT INTO public\.user_profiles/i.test(sql))).toBe(true);
    expect(client.queries.some(({ sql }) => /INSERT INTO public\.dynamics_user_roles/i.test(sql))).toBe(true);
  });

  it('refuses any non-provider application relation before schema bootstrap', async () => {
    const client = mockClient({ catalogRows: [
      ...providerCatalogRows(),
      { schemaname: 'private_app', relationname: 'unexpected', relkind: 'r', relationowner: 'app' },
    ] });
    const bootstrap = jest.fn();
    await expect(runPreviewBootstrap({
      client,
      groups: { baseGroups: [], supplementalGroups: [] },
      bootstrap,
    })).rejects.toThrow('preview_bootstrap_failed:read_only_catalog_preflight:database_not_pristine_for_preview_bootstrap');
    expect(bootstrap).not.toHaveBeenCalled();
    expect(client.queries.some(({ sql }) => sql === 'ROLLBACK')).toBe(true);
  });

  it('rolls back a failed admin seed, reports that schema bootstrap already completed, and redacts details', async () => {
    const client = mockClient({ seedFailure: true });
    await expect(runPreviewBootstrap({
      client,
      groups: { baseGroups: [], supplementalGroups: [] },
      bootstrap: jest.fn().mockResolvedValue(undefined),
    })).rejects.toThrow('preview_bootstrap_failed:admin_seed:unexpected_error');
    expect(client.queries.filter(({ sql }) => sql === 'COMMIT')).toHaveLength(1);
    expect(client.queries.filter(({ sql }) => sql === 'ROLLBACK')).toHaveLength(1);
    expect(JSON.stringify(client.queries)).not.toContain('secret');
  });

  it('refuses an existing profile identity and rolls back without overwriting it', async () => {
    const client = mockClient({ profileCollision: true });
    await expect(runPreviewBootstrap({
      client,
      groups: { baseGroups: [], supplementalGroups: [] },
      bootstrap: jest.fn().mockResolvedValue(undefined),
    })).rejects.toThrow('preview_bootstrap_failed:admin_seed:profile_seed_guard_failed');
    expect(client.queries.some(({ sql }) => sql.startsWith('INSERT INTO public.user_profiles'))).toBe(false);
    expect(client.queries.filter(({ sql }) => sql === 'ROLLBACK')).toHaveLength(1);
  });
});
