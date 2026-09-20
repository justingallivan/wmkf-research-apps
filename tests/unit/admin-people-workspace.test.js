/**
 * @jest-environment jsdom
 *
 * T3 (Stage 3) per-call-site contract matrix for the inline admin sections
 * reachable through `PeopleWorkspace` (pages/admin.js): RoleManagementSection
 * (:1583 D1 fix, :1602 D1 fix, :1619, :1642, view="roles"),
 * AppAccessSection (:1788, :1888, :1896, :1953, view="app-access" — extends
 * tests/unit/app-access-admin-partial-refresh.test.js with the axes it does
 * not cover: initial 401/403, network rejection, malformed body), and
 * DynamicsIdentitySection (:2349, :2365, view="identity"). Run against the
 * unmigrated code first (must pass), then unchanged after each migration
 * commit.
 */
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { PeopleWorkspace } from '../../pages/admin';

const jsonResponse = (status, body) => ({
  ok: status >= 200 && status < 300,
  status,
  json: async () => body,
});

const malformedResponse = (status) => ({
  ok: status >= 200 && status < 300,
  status,
  json: async () => { throw new SyntaxError('Unexpected end of JSON input'); },
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe('RoleManagementSection (view="roles") — D1 fix on :1583/:1602', () => {
  test('(a) 2xx renders the roles table for a superuser', async () => {
    global.fetch = jest.fn((url) => {
      if (url === '/api/dynamics-explorer/roles') return Promise.resolve(jsonResponse(200, { callerRole: 'superuser', roles: [{ id: 1, user_profile_id: 9, user_name: 'Ann', role: 'read_write' }] }));
      return Promise.resolve(jsonResponse(200, { profiles: [] }));
    });
    render(<PeopleWorkspace view="roles" />);
    expect(await screen.findByText('Ann')).toBeInTheDocument();
  });

  test('(b) status 401/403 sets denied and renders nothing beyond the wrapper', async () => {
    global.fetch = jest.fn((url) => {
      if (url === '/api/dynamics-explorer/roles') return Promise.resolve(jsonResponse(403, { callerRole: 'superuser', roles: [] }));
      return Promise.resolve(jsonResponse(200, { profiles: [] }));
    });
    render(<PeopleWorkspace view="roles" />);
    await waitFor(() => expect(global.fetch).toHaveBeenCalled());
    expect(screen.queryByText('Assign')).not.toBeInTheDocument();
  });

  test('(D1 fix) a non-2xx, non-401/403 {error} status now surfaces the server error message instead of being read as data', async () => {
    global.fetch = jest.fn((url) => {
      if (url === '/api/dynamics-explorer/roles') return Promise.resolve(jsonResponse(500, { error: 'Roles table unavailable' }));
      return Promise.resolve(jsonResponse(200, { profiles: [] }));
    });
    render(<PeopleWorkspace view="roles" />);
    expect(await screen.findByText('Roles table unavailable')).toBeInTheDocument();
    expect(screen.queryByText('Ann')).not.toBeInTheDocument();
  });

  test('(D1 fix) a non-2xx, non-401/403 unparseable body surfaces the fallback message', async () => {
    global.fetch = jest.fn((url) => (url === '/api/dynamics-explorer/roles' ? Promise.resolve(malformedResponse(502)) : Promise.resolve(jsonResponse(200, { profiles: [] }))));
    render(<PeopleWorkspace view="roles" />);
    expect(await screen.findByText('Request failed (502)')).toBeInTheDocument();
  });

  test('(c) network rejection sets denied', async () => {
    global.fetch = jest.fn(() => Promise.reject(new Error('down')));
    render(<PeopleWorkspace view="roles" />);
    await waitFor(() => expect(global.fetch).toHaveBeenCalled());
    expect(screen.queryByText('Assign')).not.toBeInTheDocument();
  });


  test('(d) malformed 2xx also lands in denied (strict-on-success)', async () => {
    global.fetch = jest.fn((url) => (url === '/api/dynamics-explorer/roles' ? Promise.resolve(malformedResponse(200)) : Promise.resolve(jsonResponse(200, { profiles: [] }))));
    render(<PeopleWorkspace view="roles" />);
    await waitFor(() => expect(global.fetch).toHaveBeenCalled());
    expect(screen.queryByText('Assign')).not.toBeInTheDocument();
  });

  test('(:1602) user-profiles populates the assign dropdown on 2xx; a malformed 2xx body is silently ignored (unchanged), matching the existing catch{}', async () => {
    global.fetch = jest.fn((url) => {
      if (url === '/api/dynamics-explorer/roles') return Promise.resolve(jsonResponse(200, { callerRole: 'superuser', roles: [] }));
      return Promise.resolve(malformedResponse(200));
    });
    render(<PeopleWorkspace view="roles" />);
    await screen.findByText('No roles assigned yet.');
    expect(screen.getByText('Select user...')).toBeInTheDocument();
    expect(screen.queryByRole('option', { name: /@/ })).not.toBeInTheDocument();
  });

  test('(:1602 D1 fix) user-profiles non-2xx {error} now surfaces the server error message instead of being read as data', async () => {
    global.fetch = jest.fn((url) => {
      if (url === '/api/dynamics-explorer/roles') return Promise.resolve(jsonResponse(200, { callerRole: 'superuser', roles: [] }));
      return Promise.resolve(jsonResponse(500, { error: 'Profiles table unavailable' }));
    });
    render(<PeopleWorkspace view="roles" />);
    expect(await screen.findByText('Profiles table unavailable')).toBeInTheDocument();
  });

  test('(:1602 D1 fix) user-profiles non-2xx unparseable body surfaces the fallback message', async () => {
    global.fetch = jest.fn((url) => {
      if (url === '/api/dynamics-explorer/roles') return Promise.resolve(jsonResponse(200, { callerRole: 'superuser', roles: [] }));
      return Promise.resolve(malformedResponse(502));
    });
    render(<PeopleWorkspace view="roles" />);
    expect(await screen.findByText('Request failed (502)')).toBeInTheDocument();
  });

  test('(POST assign) sends exact body/method/headers; non-2xx bare .json() with fallback shows body.error', async () => {
    let postCall = null;
    global.fetch = jest.fn((url, init) => {
      if (url === '/api/dynamics-explorer/roles' && init?.method === 'POST') { postCall = init; return Promise.resolve(jsonResponse(400, { error: 'Bad role' })); }
      if (url === '/api/dynamics-explorer/roles') return Promise.resolve(jsonResponse(200, { callerRole: 'superuser', roles: [] }));
      return Promise.resolve(jsonResponse(200, { profiles: [{ id: 9, name: 'Ann', isActive: true }] }));
    });
    render(<PeopleWorkspace view="roles" />);
    await screen.findByText('Ann', { selector: 'option' });
    fireEvent.change(screen.getByDisplayValue('Select user...'), { target: { value: '9' } });
    fireEvent.click(screen.getByText('Assign'));
    await waitFor(() => expect(postCall).not.toBeNull());
    expect(postCall.method).toBe('POST');
    expect(postCall.headers['Content-Type']).toBe('application/json');
    expect(postCall.body).toBe(JSON.stringify({ userProfileId: 9, role: 'read_only' }));
    expect(await screen.findByText('Bad role')).toBeInTheDocument();
  });

  test('(POST assign) non-2xx with no body.error falls back to "Failed to assign role"', async () => {
    global.fetch = jest.fn((url, init) => {
      if (url === '/api/dynamics-explorer/roles' && init?.method === 'POST') return Promise.resolve(jsonResponse(500, {}));
      if (url === '/api/dynamics-explorer/roles') return Promise.resolve(jsonResponse(200, { callerRole: 'superuser', roles: [] }));
      return Promise.resolve(jsonResponse(200, { profiles: [{ id: 9, name: 'Ann', isActive: true }] }));
    });
    render(<PeopleWorkspace view="roles" />);
    await screen.findByText('Ann', { selector: 'option' });
    fireEvent.change(screen.getByDisplayValue('Select user...'), { target: { value: '9' } });
    fireEvent.click(screen.getByText('Assign'));
    expect(await screen.findByText('Failed to assign role')).toBeInTheDocument();
  });

  // D3 (owner-accepted 2026-09-20): fallback text replaces the raw parse error on a non-2xx unparseable body.
  test('(POST assign) a non-2xx unparseable body (502) shows the fallback "Failed to assign role", not the raw parse error', async () => {
    global.fetch = jest.fn((url, init) => {
      if (url === '/api/dynamics-explorer/roles' && init?.method === 'POST') return Promise.resolve(malformedResponse(502));
      if (url === '/api/dynamics-explorer/roles') return Promise.resolve(jsonResponse(200, { callerRole: 'superuser', roles: [] }));
      return Promise.resolve(jsonResponse(200, { profiles: [{ id: 9, name: 'Ann', isActive: true }] }));
    });
    render(<PeopleWorkspace view="roles" />);
    await screen.findByText('Ann', { selector: 'option' });
    fireEvent.change(screen.getByDisplayValue('Select user...'), { target: { value: '9' } });
    fireEvent.click(screen.getByText('Assign'));
    expect(await screen.findByText('Failed to assign role')).toBeInTheDocument();
    expect(screen.queryByText('Unexpected end of JSON input')).not.toBeInTheDocument();
  });

  test('(POST assign) 2xx success (body ignored) refetches roles', async () => {
    let rolesCallCount = 0;
    global.fetch = jest.fn((url, init) => {
      if (url === '/api/dynamics-explorer/roles' && init?.method === 'POST') return Promise.resolve(jsonResponse(200, {}));
      if (url === '/api/dynamics-explorer/roles') { rolesCallCount += 1; return Promise.resolve(jsonResponse(200, { callerRole: 'superuser', roles: [] })); }
      return Promise.resolve(jsonResponse(200, { profiles: [{ id: 9, name: 'Ann', isActive: true }] }));
    });
    render(<PeopleWorkspace view="roles" />);
    await screen.findByText('Ann', { selector: 'option' });
    fireEvent.change(screen.getByDisplayValue('Select user...'), { target: { value: '9' } });
    fireEvent.click(screen.getByText('Assign'));
    await waitFor(() => expect(rolesCallCount).toBe(2));
    expect(await screen.findByText('Role assigned')).toBeInTheDocument();
  });

  test('(DELETE remove) sends exact body/method/headers; non-2xx bare .json() with fallback shows body.error', async () => {
    window.confirm = jest.fn(() => true);
    let deleteCall = null;
    global.fetch = jest.fn((url, init) => {
      if (url === '/api/dynamics-explorer/roles' && init?.method === 'DELETE') { deleteCall = init; return Promise.resolve(jsonResponse(400, { error: 'Bad removal' })); }
      if (url === '/api/dynamics-explorer/roles') return Promise.resolve(jsonResponse(200, { callerRole: 'superuser', roles: [{ id: 1, user_profile_id: 9, user_name: 'Ann', role: 'read_write' }] }));
      return Promise.resolve(jsonResponse(200, { profiles: [] }));
    });
    render(<PeopleWorkspace view="roles" />);
    await screen.findByText('Ann');
    fireEvent.click(screen.getByText('Remove'));
    await waitFor(() => expect(deleteCall).not.toBeNull());
    expect(deleteCall.method).toBe('DELETE');
    expect(deleteCall.headers['Content-Type']).toBe('application/json');
    expect(deleteCall.body).toBe(JSON.stringify({ userProfileId: 9 }));
    expect(await screen.findByText('Bad removal')).toBeInTheDocument();
  });

  test('(DELETE remove) unparseable non-2xx surfaces the native parse error (bare .json() only in the !ok branch, but still not swallowed silently)', async () => {
    window.confirm = jest.fn(() => true);
    global.fetch = jest.fn((url, init) => {
      if (url === '/api/dynamics-explorer/roles' && init?.method === 'DELETE') return Promise.resolve(malformedResponse(502));
      if (url === '/api/dynamics-explorer/roles') return Promise.resolve(jsonResponse(200, { callerRole: 'superuser', roles: [{ id: 1, user_profile_id: 9, user_name: 'Ann', role: 'read_write' }] }));
      return Promise.resolve(jsonResponse(200, { profiles: [] }));
    });
    render(<PeopleWorkspace view="roles" />);
    await screen.findByText('Ann');
    fireEvent.click(screen.getByText('Remove'));
    expect(await screen.findByText('Unexpected end of JSON input')).toBeInTheDocument();
  });
});

describe('AppAccessSection (view="app-access") — extends app-access-admin-partial-refresh.test.js', () => {
  test('(:1788) initial load status 401/403 shows the read-only unauthorized state (no data.error read)', async () => {
    global.fetch = jest.fn(() => Promise.resolve(jsonResponse(403, { error: 'ignored on 401/403' })));
    render(<PeopleWorkspace view="app-access" />);
    await waitFor(() => expect(global.fetch).toHaveBeenCalled());
    expect(screen.queryByText('ignored on 401/403')).not.toBeInTheDocument();
    expect(screen.queryByRole('checkbox')).not.toBeInTheDocument();
  });

  test('(:1788) initial load network rejection shows err.message', async () => {
    global.fetch = jest.fn(() => Promise.reject(new Error('offline')));
    render(<PeopleWorkspace view="app-access" />);
    expect(await screen.findByText('offline')).toBeInTheDocument();
  });

  test('(:1788) initial load malformed 2xx surfaces the native parse error (strict-on-success)', async () => {
    global.fetch = jest.fn(() => Promise.resolve(malformedResponse(200)));
    render(<PeopleWorkspace view="app-access" />);
    expect(await screen.findByText('Unexpected end of JSON input')).toBeInTheDocument();
  });

  // D3 (owner-accepted 2026-09-20): fallback text replaces the raw parse error on a non-2xx unparseable body.
  test('(:1895 grant) a non-2xx unparseable body (502) shows the fallback "Grant failed", not the raw parse error', async () => {
    let getCount = 0;
    global.fetch = jest.fn((url, init) => {
      if (url.startsWith('/api/app-access') && init?.method === 'POST') return Promise.resolve(malformedResponse(502));
      getCount += 1;
      return Promise.resolve(jsonResponse(200, { grants: [{ user_profile_id: 8, user_name: 'Test User', apps: [] }], allApps: ['x'] }));
    });
    render(<PeopleWorkspace view="app-access" />);
    await screen.findByText('Test User');
    fireEvent.click(screen.getAllByRole('checkbox')[0]);
    fireEvent.click(screen.getByRole('button', { name: 'Save Changes' }));
    expect(await screen.findByText('Grant failed. Current grants were reloaded.')).toBeInTheDocument();
    expect(screen.queryByText(/Unexpected end of JSON input/)).not.toBeInTheDocument();
    expect(getCount).toBeGreaterThanOrEqual(2);
  });

  // D3 (owner-accepted 2026-09-20): fallback text replaces the raw parse error on a non-2xx unparseable body.
  test('(:1903 revoke) a non-2xx unparseable body (502) shows the fallback "Revoke failed", not the raw parse error', async () => {
    let getCount = 0;
    global.fetch = jest.fn((url, init) => {
      if (url.startsWith('/api/app-access') && init?.method === 'DELETE') return Promise.resolve(malformedResponse(502));
      getCount += 1;
      return Promise.resolve(jsonResponse(200, { grants: [{ user_profile_id: 8, user_name: 'Test User', apps: ['x'] }], allApps: ['x'] }));
    });
    render(<PeopleWorkspace view="app-access" />);
    await screen.findByText('Test User');
    fireEvent.click(screen.getAllByRole('checkbox')[0]);
    fireEvent.click(screen.getByRole('button', { name: 'Save Changes' }));
    expect(await screen.findByText('Revoke failed. Current grants were reloaded.')).toBeInTheDocument();
    expect(screen.queryByText(/Unexpected end of JSON input/)).not.toBeInTheDocument();
    expect(getCount).toBeGreaterThanOrEqual(2);
  });

  test('(:1953 DELETE remove-user) network rejection shows err.message', async () => {
    window.confirm = jest.fn(() => true);
    global.fetch = jest.fn((url, init) => {
      if (url.startsWith('/api/admin/users')) return Promise.reject(new Error('remove offline'));
      return Promise.resolve(jsonResponse(200, { grants: [{ user_profile_id: 8, user_name: 'Test User', apps: [] }], allApps: ['x'] }));
    });
    render(<PeopleWorkspace view="app-access" />);
    await screen.findByText('Test User');
    fireEvent.click(screen.getByRole('button', { name: 'Remove' }));
    expect(await screen.findByText('remove offline')).toBeInTheDocument();
  });
});

describe('DynamicsIdentitySection (view="identity")', () => {
  test('(a) 2xx renders the linked-users summary', async () => {
    global.fetch = jest.fn((url) => (url === '/api/user-profiles?all=true'
      ? Promise.resolve(jsonResponse(200, { profiles: [{ id: 1, isActive: true, displayName: 'Ann', dynamicsSystemuserId: 'x' }] }))
      : Promise.resolve(jsonResponse(200, {}))));
    render(<PeopleWorkspace view="identity" />);
    expect(await screen.findByText('1 of 1 active users linked to a Dynamics systemuser.')).toBeInTheDocument();
  });

  test('(b) non-2xx renders no summary (body never read, same as ok=false -> null)', async () => {
    global.fetch = jest.fn(() => Promise.resolve(jsonResponse(500, { profiles: [{ id: 1, isActive: true }] })));
    render(<PeopleWorkspace view="identity" />);
    await waitFor(() => expect(screen.queryByText('Loading...')).not.toBeInTheDocument());
    expect(screen.queryByText(/active users linked/)).not.toBeInTheDocument();
  });

  test('(c) network rejection renders no summary', async () => {
    global.fetch = jest.fn(() => Promise.reject(new Error('down')));
    render(<PeopleWorkspace view="identity" />);
    await waitFor(() => expect(screen.queryByText('Loading...')).not.toBeInTheDocument());
    expect(screen.queryByText(/active users linked/)).not.toBeInTheDocument();
  });

  test('(d) malformed 2xx renders no summary (strict parse rejects, caught)', async () => {
    global.fetch = jest.fn(() => Promise.resolve(malformedResponse(200)));
    render(<PeopleWorkspace view="identity" />);
    await waitFor(() => expect(screen.queryByText('Loading...')).not.toBeInTheDocument());
    expect(screen.queryByText(/active users linked/)).not.toBeInTheDocument();
  });

  test('(POST reconcile) sends exact body/method/headers; matches data.error || data.message || fallback', async () => {
    let postCall = null;
    global.fetch = jest.fn((url, init) => {
      if (url === '/api/admin/reconcile-identities') { postCall = init; return Promise.resolve(jsonResponse(400, { message: 'From message field' })); }
      return Promise.resolve(jsonResponse(200, { profiles: [{ id: 1, isActive: true, displayName: 'Ann' }] }));
    });
    render(<PeopleWorkspace view="identity" />);
    await screen.findByText('0 of 1 active users linked to a Dynamics systemuser.');
    fireEvent.click(screen.getByText('Reconcile stale'));
    await waitFor(() => expect(postCall).not.toBeNull());
    expect(postCall.method).toBe('POST');
    expect(postCall.headers['Content-Type']).toBe('application/json');
    expect(postCall.body).toBe(JSON.stringify({ all: false }));
    expect(await screen.findByText('From message field')).toBeInTheDocument();
  });

  test('(POST reconcile) unparseable non-2xx surfaces the native parse error too (bare .json() runs before the ok check), never silent', async () => {
    global.fetch = jest.fn((url) => {
      if (url === '/api/admin/reconcile-identities') return Promise.resolve(malformedResponse(502));
      return Promise.resolve(jsonResponse(200, { profiles: [{ id: 1, isActive: true, displayName: 'Ann' }] }));
    });
    render(<PeopleWorkspace view="identity" />);
    await screen.findByText('0 of 1 active users linked to a Dynamics systemuser.');
    fireEvent.click(screen.getByText('Reconcile stale'));
    expect(await screen.findByText('Unexpected end of JSON input')).toBeInTheDocument();
  });

  test('(POST reconcile) 2xx success renders the scanned summary', async () => {
    global.fetch = jest.fn((url, init) => {
      if (url === '/api/admin/reconcile-identities') return Promise.resolve(jsonResponse(200, { totalScanned: 3, summary: { linked: 1, unchanged: 2 } }));
      return Promise.resolve(jsonResponse(200, { profiles: [{ id: 1, isActive: true, displayName: 'Ann' }] }));
    });
    render(<PeopleWorkspace view="identity" />);
    await screen.findByText('0 of 1 active users linked to a Dynamics systemuser.');
    fireEvent.click(screen.getByText('Reconcile stale'));
    expect(await screen.findByText('Scanned 3: 1 linked, 2 unchanged')).toBeInTheDocument();
  });
});
