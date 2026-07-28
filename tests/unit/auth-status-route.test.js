import handler from '../../pages/api/auth/status';
import { isAuthRequired, _resetWarningsForTests } from '../../lib/utils/auth-policy';

const ENV_KEYS = [
  'AUTH_REQUIRED',
  'AZURE_AD_CLIENT_ID',
  'AZURE_AD_CLIENT_SECRET',
  'AZURE_AD_TENANT_ID',
  'EMERGENCY_AUTH_BYPASS',
  'NODE_ENV',
];

let savedEnv;

function mockResponse() {
  return {
    statusCode: null,
    body: null,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(body) {
      this.body = body;
      return this;
    },
  };
}

function callStatus() {
  const res = mockResponse();
  handler({ method: 'GET' }, res);
  return res;
}

beforeEach(() => {
  savedEnv = {};
  for (const key of ENV_KEYS) {
    savedEnv[key] = process.env[key];
    delete process.env[key];
  }
  _resetWarningsForTests();
  jest.spyOn(console, 'error').mockImplementation(() => {});
  jest.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(() => {
  for (const key of ENV_KEYS) {
    if (savedEnv[key] === undefined) delete process.env[key];
    else process.env[key] = savedEnv[key];
  }
  jest.restoreAllMocks();
});

describe('/api/auth/status', () => {
  test('reports enforcement enabled when production configuration is incomplete', () => {
    process.env.NODE_ENV = 'production';

    const res = callStatus();

    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({ enabled: true });
  });

  test('reports disabled only for the explicit production emergency bypass', () => {
    process.env.NODE_ENV = 'production';
    process.env.AUTH_REQUIRED = 'false';
    process.env.AZURE_AD_CLIENT_ID = 'id';
    process.env.AZURE_AD_CLIENT_SECRET = 'secret';
    process.env.AZURE_AD_TENANT_ID = 'tenant';
    process.env.EMERGENCY_AUTH_BYPASS = 'true';

    expect(isAuthRequired()).toBe(false);
    expect(callStatus().body).toEqual({ enabled: false });
  });

  test('does not treat the emergency override alone as a request to disable auth', () => {
    process.env.NODE_ENV = 'production';
    process.env.AUTH_REQUIRED = 'true';
    process.env.AZURE_AD_CLIENT_ID = 'id';
    process.env.AZURE_AD_CLIENT_SECRET = 'secret';
    process.env.AZURE_AD_TENANT_ID = 'tenant';
    process.env.EMERGENCY_AUTH_BYPASS = 'true';

    expect(callStatus().body).toEqual({ enabled: true });
  });

  test('preserves the development opt-in contract', () => {
    process.env.NODE_ENV = 'development';
    process.env.AUTH_REQUIRED = 'true';
    process.env.AZURE_AD_CLIENT_ID = 'id';
    process.env.AZURE_AD_CLIENT_SECRET = 'secret';
    process.env.AZURE_AD_TENANT_ID = 'tenant';

    expect(callStatus().body).toEqual({ enabled: true });

    delete process.env.AZURE_AD_CLIENT_SECRET;
    expect(callStatus().body).toEqual({ enabled: false });
  });

  test('keeps the public response shape bounded to enabled', () => {
    process.env.NODE_ENV = 'production';

    expect(Object.keys(callStatus().body)).toEqual(['enabled']);
  });
});
