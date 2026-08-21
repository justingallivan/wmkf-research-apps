const {
  ACTIONS,
  REMEDIATION_CONTRACT,
  remediationFor,
} = require('../../lib/utils/reviewer-remediation');

test('every configured reviewer remediation action has a user-facing label', () => {
  for (const [code, actions] of Object.entries(REMEDIATION_CONTRACT)) {
    expect(actions.length).toBeGreaterThan(0);
    for (const action of actions) {
      expect(ACTIONS[action]).toEqual(expect.any(String));
      expect(ACTIONS[action].trim()).not.toBe('');
    }
    expect(remediationFor(code).remediation.length).toBeGreaterThan(0);
  }
});

test('unknown reviewer errors fail closed with retry and durable repair remedies', () => {
  expect(remediationFor('new_server_code')).toMatchObject({
    code: 'new_server_code',
    unknown: true,
    remediation: [
      { action: 'retry_check', label: 'Retry check' },
      { action: 'create_repair_request', label: 'Create repair request' },
    ],
  });
});

test.each([
  'person_inactive',
  'email_conflict',
  'ambiguous_email_owner',
  'inactive_email_owner',
  'contact_linked_elsewhere',
])('%s routes to retry without an Admin repair detour', (code) => {
  const actions = remediationFor(code).remediation.map((item) => item.action);
  expect(actions).toContain('retry_record_check');
  expect(actions).not.toContain('create_repair_request');
});
