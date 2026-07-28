/**
 * Regression coverage for the patched next-auth getToken() Bearer parser.
 *
 * @jest-environment node
 */

describe('sign-in server-side authentication', () => {
  const previousSecret = process.env.NEXTAUTH_SECRET;

  beforeAll(() => {
    process.env.NEXTAUTH_SECRET = 'test-only-nextauth-secret';
  });

  afterAll(() => {
    if (previousSecret === undefined) delete process.env.NEXTAUTH_SECRET;
    else process.env.NEXTAUTH_SECRET = previousSecret;
  });

  it('treats malformed percent-encoded Bearer input as unauthenticated', async () => {
    const { getServerSideProps } = require('../../pages/auth/signin');
    const result = await getServerSideProps({
      req: {
        headers: { authorization: 'Bearer %' },
        cookies: {},
      },
      query: {},
    });

    expect(result).toEqual({ props: {} });
  });
});
