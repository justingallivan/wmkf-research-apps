const { resolveDatabaseUrl } = require('../../scripts/lib/fresh-database-bootstrap');

const URLS = {
  explicitPostgres: 'postgres://explicit-user:fake-explicit-password@explicit.example.invalid/pilot',
  explicitDatabase: 'postgres://database-user:fake-database-password@database.example.invalid/pilot',
  dotenvPostgres: 'postgres://dotenv-user:fake-dotenv-password@dotenv-pg.example.invalid/pilot',
  dotenvDatabase: 'postgres://fallback-user:fake-fallback-password@fallback.example.invalid/pilot',
};

describe('resolveDatabaseUrl for fresh database bootstrap', () => {
  it('prefers explicit POSTGRES_URL over explicit DATABASE_URL and dotenv values', () => {
    const env = {
      POSTGRES_URL: URLS.explicitPostgres,
      DATABASE_URL: URLS.explicitDatabase,
    };

    expect(resolveDatabaseUrl({
      env,
      dotenvText: `POSTGRES_URL="${URLS.dotenvPostgres}"\nDATABASE_URL="${URLS.dotenvDatabase}"`,
    })).toBe(URLS.explicitPostgres);
  });

  it('prefers explicit DATABASE_URL over a dotenv POSTGRES_URL', () => {
    const env = { DATABASE_URL: URLS.explicitDatabase };

    expect(resolveDatabaseUrl({
      env,
      dotenvText: `POSTGRES_URL=${URLS.dotenvPostgres}`,
    })).toBe(URLS.explicitDatabase);
  });

  it('uses either explicit URL without dotenv text', () => {
    expect(resolveDatabaseUrl({ env: { POSTGRES_URL: URLS.explicitPostgres } }))
      .toBe(URLS.explicitPostgres);
    expect(resolveDatabaseUrl({ env: { DATABASE_URL: URLS.explicitDatabase } }))
      .toBe(URLS.explicitDatabase);
  });

  it('falls back to parsed dotenv values, including quoted values', () => {
    const env = {};
    const dotenvText = [
      `POSTGRES_URL='${URLS.dotenvPostgres}'`,
      `DATABASE_URL="${URLS.dotenvDatabase}"`,
    ].join('\n');

    expect(resolveDatabaseUrl({ env, dotenvText })).toBe(URLS.dotenvPostgres);
  });

  it('throws when neither explicit environment nor dotenv has a database URL', () => {
    expect(() => resolveDatabaseUrl({ env: {}, dotenvText: 'OTHER_SETTING=value' }))
      .toThrow();
  });

  it('does not mutate the supplied environment object', () => {
    const env = Object.freeze({ DATABASE_URL: URLS.explicitDatabase });

    expect(resolveDatabaseUrl({
      env,
      dotenvText: `POSTGRES_URL=${URLS.dotenvPostgres}`,
    })).toBe(URLS.explicitDatabase);
    expect(env).toEqual({ DATABASE_URL: URLS.explicitDatabase });
  });
});
