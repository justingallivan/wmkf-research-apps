const nextConfig = require('../../next.config');

function toHeaderMap(headers) {
  return Object.fromEntries(headers.map(({ key, value }) => [key, value]));
}

describe('security headers', () => {
  it('sets the global browser security baseline', async () => {
    const rules = await nextConfig.headers();
    const globalRule = rules.find(rule => rule.source === '/:path*');
    const headers = toHeaderMap(globalRule.headers);

    expect(headers['Strict-Transport-Security']).toBe('max-age=63072000; includeSubDomains; preload');
    expect(headers['X-Content-Type-Options']).toBe('nosniff');
    expect(headers['X-Frame-Options']).toBe('DENY');
    expect(headers['Referrer-Policy']).toBe('strict-origin-when-cross-origin');
    expect(headers['Permissions-Policy']).toContain('camera=()');
    expect(headers['Permissions-Policy']).toContain('microphone=()');
    expect(headers['Cross-Origin-Opener-Policy']).toBe('same-origin');
    expect(headers['Cross-Origin-Resource-Policy']).toBe('same-origin');
    expect(headers['X-Permitted-Cross-Domain-Policies']).toBe('none');
    expect(headers['X-Robots-Tag']).toBe('noindex, nofollow, noarchive');
  });

  it('prevents API response caching by default', async () => {
    const rules = await nextConfig.headers();
    const apiRule = rules.find(rule => rule.source === '/api/:path*');
    const headers = toHeaderMap(apiRule.headers);

    expect(headers['Cache-Control']).toBe('no-store, max-age=0');
  });

  it('does not disclose presentation bearer paths through referrers or caches', async () => {
    const rules = await nextConfig.headers();
    for (const source of ['/external/presentation/:path*', '/api/external/presentation/:path*']) {
      const headers = toHeaderMap(rules.find(rule => rule.source === source).headers);
      expect(headers['Referrer-Policy']).toBe('no-referrer');
      expect(headers['Cache-Control']).toBe('private, no-store, max-age=0');
    }
  });

  it('allows only same-origin framing of the Cycle Dossier PDF preview', async () => {
    const rules = await nextConfig.headers();
    const rule = rules.find(r => r.source === '/api/cycle-dossier/download');
    expect(toHeaderMap(rule.headers)['X-Frame-Options']).toBe('SAMEORIGIN');
    // Ordering matters: the override must come after the global DENY rule.
    expect(rules.indexOf(rule)).toBeGreaterThan(rules.findIndex(r => r.source === '/:path*'));
  });
});
