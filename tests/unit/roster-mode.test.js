/** @jest-environment node */
import { rosterMode, usesDataverseRoster, rosterTarget } from '../../lib/services/expertise-finder/roster-mode.js';
import { PRODUCTION_HOSTS } from '../../lib/dataverse/core/target-registry.js';
import marker from '../../lib/services/expertise-finder/roster-cutover-marker.cjs';

const PROD = 'https://wmkf.crm.dynamics.com';
const SANDBOX = 'https://orgd9e66399.crm.dynamics.com';

describe('rosterMode', () => {
  test.each([[undefined], [''], ['postgres']])('legacy when EXPERTISE_ROSTER_BACKEND=%p', (value) => {
    const env = value === undefined ? {} : { EXPERTISE_ROSTER_BACKEND: value };
    expect(rosterMode(env)).toBe('legacy');
    expect(usesDataverseRoster(env)).toBe(false);
  });

  test('dataverse when set to dataverse', () => {
    expect(rosterMode({ EXPERTISE_ROSTER_BACKEND: 'dataverse' })).toBe('dataverse');
    expect(usesDataverseRoster({ EXPERTISE_ROSTER_BACKEND: 'dataverse' })).toBe(true);
  });

  test.each([['Dataverse'], ['on'], ['true'], ['dataverse ']])('misconfigured value %p is a roster 503, not a silent fallback', (value) => {
    expect(() => rosterMode({ EXPERTISE_ROSTER_BACKEND: value })).toThrow(expect.objectContaining({ httpStatus: 503, code: 'roster_backend_misconfigured' }));
  });

  test('rehearsal wins over the backend setting', () => {
    expect(rosterMode({ EXPERTISE_ROSTER_REHEARSAL: 'on', EXPERTISE_ROSTER_BACKEND: 'postgres' })).toBe('rehearsal');
  });
});

describe('rosterTarget in dataverse mode', () => {
  const env = (url) => ({ EXPERTISE_ROSTER_BACKEND: 'dataverse', DYNAMICS_URL: url });

  test('uses the deployment Production host', () => {
    expect(rosterTarget(env(PROD))).toEqual({ host: 'wmkf.crm.dynamics.com' });
    expect(rosterTarget(env(`${PROD}/`))).toEqual({ host: 'wmkf.crm.dynamics.com' });
  });

  test('uses the registered sandbox host', () => {
    expect(rosterTarget(env(SANDBOX))).toEqual({ host: 'orgd9e66399.crm.dynamics.com' });
  });

  test.each([
    ['unregistered host', 'https://other.crm.dynamics.com'],
    ['http', 'http://wmkf.crm.dynamics.com'],
    ['path', `${PROD}/api/data`],
    ['missing', undefined],
    ['garbage', 'not a url'],
  ])('refuses %s', (_label, url) => {
    expect(() => rosterTarget(env(url))).toThrow(expect.objectContaining({ code: 'roster_backend_misconfigured' }));
  });

  test('refuses in legacy mode', () => {
    expect(() => rosterTarget({ DYNAMICS_URL: PROD })).toThrow(expect.objectContaining({ code: 'roster_backend_misconfigured' }));
  });
});

test('cutover marker host matches the tracked Production host registry', () => {
  expect(PRODUCTION_HOSTS).toContain(marker.PRODUCTION_ROSTER_HOST);
});
