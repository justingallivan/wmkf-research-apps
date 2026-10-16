import {
  CYCLE,
  FACILITATOR_NAMES,
  PERSONA_NAMES,
  PROPOSAL_COUNT,
  RECEIPT_PATH,
  isExactSandboxUrl,
  operationBody,
  validateHarnessPreflight,
  validateReceipt,
} from '../../scripts/rehearse-proposal-ranking-d26-sandbox.mjs';

const safeEnv = {
  DYNAMICS_URL: 'https://orgd9e66399.crm.dynamics.com',
  DATAVERSE_TARGET_INTERLOCK: 'on',
  DATAVERSE_ALLOW_PROD_READS: 'no',
};

function receipt(overrides = {}) {
  return {
    version: 1,
    target: 'https://orgd9e66399.crm.dynamics.com',
    cycle: CYCLE,
    receiptPath: RECEIPT_PATH,
    synthetic: true,
    proposalCount: PROPOSAL_COUNT,
    roster: [
      { name: PERSONA_NAMES[0], systemUserId: '00000000-0000-4000-8000-000000000001' },
      { name: PERSONA_NAMES[1], systemUserId: '00000000-0000-4000-8000-000000000002' },
      { name: PERSONA_NAMES[2], systemUserId: '00000000-0000-4000-8000-000000000003' },
      { name: PERSONA_NAMES[3], systemUserId: '00000000-0000-4000-8000-000000000004' },
    ],
    facilitatorSystemUserIds: [
      '00000000-0000-4000-8000-000000000001',
      '00000000-0000-4000-8000-000000000002',
    ],
    ...overrides,
  };
}

test('the rehearsal recognizes only the exact registered sandbox origin', () => {
  expect(isExactSandboxUrl(safeEnv.DYNAMICS_URL)).toBe(true);
  for (const url of [
    'https://orgd9e66399.crm.dynamics.com.evil.example',
    'https://user@orgd9e66399.crm.dynamics.com',
    'https://orgd9e66399.crm.dynamics.com/path',
    'https://orgd9e66399.crm.dynamics.com?next=prod',
    'not a URL',
  ]) expect(isExactSandboxUrl(url)).toBe(false);
});

test('write preflight requires explicit sandbox/interlock gates and the one unused D96 identity', () => {
  expect(validateHarnessPreflight({ env: safeEnv })).toBe(true);
  for (const [key, value] of [
    ['DYNAMICS_URL', 'https://prod.crm.dynamics.com'],
    ['DYNAMICS_SANDBOX_URL', 'https://prod.crm.dynamics.com'],
    ['DATAVERSE_TARGET_INTERLOCK', ''],
    ['DATAVERSE_TARGET_INTERLOCK', 'warn'],
    ['DATAVERSE_ALLOW_PROD_READS', 'yes'],
  ]) expect(() => validateHarnessPreflight({ env: { ...safeEnv, [key]: value } })).toThrow();
  expect(() => validateHarnessPreflight({ env: safeEnv, cycle: 'D98' })).toThrow('fixed to D96');
  expect(() => validateHarnessPreflight({ env: safeEnv, receiptExists: true })).toThrow('never be replaced');
  expect(() => validateHarnessPreflight({ env: safeEnv, coordinatorExists: true })).toThrow('already has a coordinator');
  expect(() => validateHarnessPreflight({ env: safeEnv, activeRound: 'round-id' })).toThrow('already has an active round');
});

test('receipt validation pins this synthetic 23-proposal cycle and its four sandbox personas', () => {
  expect(validateReceipt(receipt()).cycle).toBe(CYCLE);
  expect(() => validateReceipt(receipt({ cycle: 'D98' }))).toThrow(/malformed|another rehearsal/);
  expect(() => validateReceipt(receipt({ proposalCount: 6 }))).toThrow(/malformed|another rehearsal/);
  expect(() => validateReceipt(receipt({ roster: receipt().roster.slice(0, 3) }))).toThrow(/malformed|another rehearsal/);
  expect(() => validateReceipt(receipt({ facilitatorSystemUserIds: ['00000000-0000-4000-8000-000000000099'] }))).toThrow(/malformed|another rehearsal/);
  expect(FACILITATOR_NAMES).toEqual(['Beth Pruitt', 'Justin Gallivan']);
});

test('saveAssessment action bodies retain the reducer fields', () => {
  const assessment = { order: ['proposal-a', 'proposal-b'], boundaries: [1, 2], confidence: { 'proposal-a': 'confident' } };
  const body = operationBody({
    roundId: 'round-id',
    round: { etag: 'W/"7"', policyRevision: 2 },
    workflow: { preparationVersion: 3, revealId: null },
    confirmations: {},
  }, 'saveAssessment', 'operation-id', { programKey: 'mr', listVersion: 4, assessment });
  expect(body).toMatchObject({ action: 'saveAssessment', programKey: 'mr', listVersion: 4, assessment });
});
