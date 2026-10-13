const { withVerifyFullSslmode } = require('../../lib/db/pg-connection-string');

const BASE = 'postgresql://user:p%40ss@ep-example-pooler.us-east-1.aws.neon.tech/neondb';

describe('withVerifyFullSslmode', () => {
  test.each(['require', 'prefer', 'verify-ca', 'REQUIRE'])('rewrites sslmode=%s to verify-full', (mode) => {
    const out = new URL(withVerifyFullSslmode(`${BASE}?sslmode=${mode}&channel_binding=require`));
    expect(out.searchParams.get('sslmode')).toBe('verify-full');
    expect(out.searchParams.get('channel_binding')).toBe('require');
    expect(out.password).toBe('p%40ss');
    expect(out.hostname).toBe('ep-example-pooler.us-east-1.aws.neon.tech');
  });

  test.each([
    `${BASE}?sslmode=verify-full`,
    `${BASE}?sslmode=disable`,
    BASE,
    'not a url',
    '',
    undefined,
  ])('leaves %p unchanged', (input) => {
    expect(withVerifyFullSslmode(input)).toBe(input);
  });

  test('the rewritten string parses with full verification and no pg security warning', () => {
    jest.resetModules();
    const { parse } = require('pg-connection-string');
    const spy = jest.spyOn(process, 'emitWarning').mockImplementation(() => {});
    try {
      const config = parse(withVerifyFullSslmode(`${BASE}?sslmode=require`));
      expect(config.ssl).toBeTruthy();
      expect(config.ssl.rejectUnauthorized).not.toBe(false);
      expect(spy).not.toHaveBeenCalled();
      parse(`${BASE}?sslmode=require`);
      expect(spy).toHaveBeenCalledWith(expect.stringContaining('SECURITY WARNING'));
    } finally {
      spy.mockRestore();
    }
  });
});
