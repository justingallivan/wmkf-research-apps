const {
  CANONICAL_HOST,
  LEGACY_HOST,
  shouldRedirectToCanonical,
} = require('../../lib/utils/legacy-host-redirect');
const nextConfig = require('../../next.config');
const { getPathMatch } = require('next/dist/shared/lib/router/utils/path-match');
const { prepareDestination } = require('next/dist/shared/lib/router/utils/prepare-destination');

async function getLegacyRedirectRule() {
  const redirects = await nextConfig.redirects();
  return redirects.find(rule => (
    rule.has?.some(condition => (
      condition.type === 'host'
      && condition.value === LEGACY_HOST
    ))
  ));
}

function resolveDestination(rule, pathname, query = {}) {
  const matcher = getPathMatch(rule.source, { removeUnnamedParams: true, strict: true });
  const params = matcher(pathname);
  const destination = params && prepareDestination({
    appendParamsToQuery: true,
    destination: rule.destination,
    params,
    query,
  }).parsedDestination;

  return { destination, params };
}

describe('legacy host redirect matching', () => {
  it('redirects the exact legacy production host', () => {
    expect(shouldRedirectToCanonical(LEGACY_HOST)).toBe(true);
  });

  it('does not redirect the canonical branded host', () => {
    expect(shouldRedirectToCanonical(CANONICAL_HOST)).toBe(false);
  });

  it('does not redirect the preview host', () => {
    expect(shouldRedirectToCanonical('wmkfresearchapps-preview.vercel.app')).toBe(false);
  });

  it('does not redirect branch aliases', () => {
    expect(shouldRedirectToCanonical('any-hash-git-main-justin-gallivans-projects.vercel.app')).toBe(false);
  });

  it('does not redirect other deployment-hash vercel.app hosts', () => {
    expect(shouldRedirectToCanonical('wmkfresearch-6wmbh9g83-justin-gallivans-projects.vercel.app')).toBe(false);
  });

  it('does not redirect empty or undefined hosts', () => {
    expect(shouldRedirectToCanonical('')).toBe(false);
    expect(shouldRedirectToCanonical(undefined)).toBe(false);
  });

  it('redirects legacy-host page paths to the canonical host with path preserved', async () => {
    const rule = await getLegacyRedirectRule();
    const { destination, params } = resolveDestination(rule, '/workbench/123');

    expect(rule.permanent).toBe(false);
    expect(params).toEqual({ path: 'workbench/123' });
    expect(destination.origin).toBe(`https://${CANONICAL_HOST}`);
    expect(destination.pathname).toBe('/workbench/123');
  });

  it('redirects the legacy-host root path to the canonical host root', async () => {
    const rule = await getLegacyRedirectRule();
    const { destination, params } = resolveDestination(rule, '/');

    expect(params).toEqual({ path: '' });
    expect(destination.origin).toBe(`https://${CANONICAL_HOST}`);
    expect(destination.pathname).toBe('/');
  });

  it('preserves trailing slashes when redirecting legacy-host page paths', async () => {
    const rule = await getLegacyRedirectRule();
    const { destination, params } = resolveDestination(rule, '/workbench/123/');

    expect(params).toEqual({ path: 'workbench/123/' });
    expect(destination.origin).toBe(`https://${CANONICAL_HOST}`);
    expect(destination.pathname).toBe('/workbench/123/');
  });

  it('matches legacy-host page paths when the request has a query string', async () => {
    const rule = await getLegacyRedirectRule();
    const { destination, params } = resolveDestination(rule, '/reviewer-finder', { tab: 'foo' });

    expect(params).toEqual({ path: 'reviewer-finder' });
    expect(destination.origin).toBe(`https://${CANONICAL_HOST}`);
    expect(destination.pathname).toBe('/reviewer-finder');
  });

  it('excludes API routes from the legacy-host redirect rule', async () => {
    const rule = await getLegacyRedirectRule();
    const matcher = getPathMatch(rule.source, { removeUnnamedParams: true, strict: true });

    expect(matcher('/api/auth/signin')).toBe(false);
    expect(matcher('/api/reviewer-finder/load-proposal')).toBe(false);
    expect(matcher('/api/health')).toBe(false);
    expect(matcher('/api/auth/callback')).toBe(false);
  });
});
