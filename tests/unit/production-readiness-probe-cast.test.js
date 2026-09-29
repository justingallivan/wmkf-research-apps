/**
 * Probe section 12 classifiers (scripts/probe-test-request-factory-production-readiness.js):
 * an unreadable flow definition must be reported, a structured entity match must
 * find triggers and nested record actions, and Create steps with no entity filter
 * must be listed (TEST_REQUEST_FACTORY_CAST_AND_STATUS_PLAN_2026-09-28.md, Order 2).
 */
const {
  classifyFlowDefinition,
  flowNamesEntity,
  unfilteredCreateSteps,
  isPlatformStep,
  customWorkflowActivities,
  classifySlotUpdateFlow,
  classifySlotUpdateStep,
  printReviewerSlotReadiness,
} = require('../../scripts/probe-test-request-factory-production-readiness.js');

const flow = (definition) => JSON.stringify({ properties: { definition } });

describe('classifyFlowDefinition', () => {
  test.each([
    [null, 'no clientdata'],
    ['', 'no clientdata'],
    ['   ', 'no clientdata'],
    ['{not json', 'clientdata did not parse'],
    ['{}', 'no definition'],
    [JSON.stringify({ properties: {} }), 'no definition'],
  ])('%p is unreadable (%s)', (clientdata, reason) => {
    expect(classifyFlowDefinition(clientdata)).toEqual({ readable: false, reason });
  });

  test('a definition object is readable', () => {
    const result = classifyFlowDefinition(flow({ triggers: {}, actions: {} }));
    expect(result.readable).toBe(true);
    expect(result.definition).toEqual({ triggers: {}, actions: {} });
  });
});

describe('flowNamesEntity', () => {
  const names = ['contact', 'contacts'];

  test('matches a Dataverse trigger on the logical name', () => {
    const def = { triggers: { t: { inputs: { parameters: { 'subscriptionRequest/entityname': 'contact' } } } } };
    expect(flowNamesEntity(def, names)).toBe(true);
  });

  test('matches a record action nested in a scope by entity set name', () => {
    const def = {
      triggers: { t: { recurrence: { interval: 1, frequency: 'Day' } } },
      actions: { Scope: { actions: { Create: { inputs: { host: { operationId: 'CreateRecord' }, parameters: { entityName: 'contacts' } } } } } },
    };
    expect(flowNamesEntity(def, names)).toBe(true);
  });

  test('does not match another entity whose name contains it', () => {
    const def = {
      triggers: { t: { inputs: { parameters: { 'subscriptionRequest/entityname': 'wmkf_contactlog' } } } },
      actions: { a: { inputs: { parameters: { entityName: 'accounts' } } } },
    };
    expect(flowNamesEntity(def, names)).toBe(false);
  });
});

describe('unfilteredCreateSteps', () => {
  const step = (message, filter) => ({ name: `${message}:${filter}`, sdkmessageid: { name: message }, sdkmessagefilterid: filter === undefined ? null : { primaryobjecttypecode: filter } });

  test('keeps Create steps with no filter or the "none" filter, drops entity-filtered and other messages', () => {
    const steps = [step('Create'), step('Create', 'none'), step('Create', null), step('Create', 'contact'), step('Update'), step('Update', 'none')];
    expect(unfilteredCreateSteps(steps).map((s) => s.name)).toEqual(['Create:undefined', 'Create:none', 'Create:null']);
  });
});

describe('isPlatformStep', () => {
  const step = (typename, ishidden) => ({ plugintypeid: { typename }, ishidden });

  test('only hidden Microsoft-namespace steps are platform steps', () => {
    expect(isPlatformStep(step('Microsoft.Crm.ObjectModel.X', { Value: true }))).toBe(true);
    expect(isPlatformStep(step('Microsoft.Crm.ObjectModel.X', true))).toBe(true);
    expect(isPlatformStep(step('Microsoft.Crm.ObjectModel.X', { Value: false }))).toBe(false);
    expect(isPlatformStep(step('AkoyaGo.Sync_BusinessCentral', { Value: true }))).toBe(false);
    expect(isPlatformStep(step(undefined, { Value: true }))).toBe(false);
  });
});

describe('customWorkflowActivities', () => {
  test('lists non-Microsoft code activities once, ignoring platform activities', () => {
    const xaml = [
      '<mxswa:ActivityReference AssemblyQualifiedName="Microsoft.Crm.Workflow.Activities.Composite, Microsoft.Crm.Workflow">',
      '<mxswa:ActivityReference AssemblyQualifiedName="System.Activities.Statements.Sequence, System.Activities">',
      '<mxswa:ActivityReference AssemblyQualifiedName="AkoyaGo.Workflows.UpdateMailingListMember, AkoyaGo.Workflows">',
      '<mxswa:ActivityReference AssemblyQualifiedName="AkoyaGo.Workflows.UpdateMailingListMember, AkoyaGo.Workflows">',
    ].join('');
    expect(customWorkflowActivities(xaml)).toEqual(['AkoyaGo.Workflows.UpdateMailingListMember']);
    expect(customWorkflowActivities('')).toEqual([]);
  });
});

describe('reviewer-slot update classifiers', () => {
  test('a Request update flow with a slot in its filter is included', () => {
    const parameters = {
      'subscriptionRequest/entityname': 'akoya_request',
      'subscriptionRequest/message': 3,
      'subscriptionRequest/filteringattributes': 'akoya_title,wmkf_potentialreviewer1',
    };
    expect(classifySlotUpdateFlow(parameters)).toEqual({
      message: 'update', firesOn: 'a slot (wmkf_potentialreviewer1)',
    });
    expect(classifySlotUpdateFlow({ ...parameters, 'subscriptionRequest/filteringattributes': '' }).firesOn).toBe('ANY column');
    expect(classifySlotUpdateFlow({ ...parameters, 'subscriptionRequest/filteringattributes': 'akoya_title' }).firesOn).toBe('other columns only (akoya_title)');
    expect(classifySlotUpdateFlow({ ...parameters, 'subscriptionRequest/entityname': 'contact' })).toBeNull();
    expect(classifySlotUpdateFlow({ ...parameters, 'subscriptionRequest/message': 1 })).toBeNull();
  });

  test('an enabled Update step with the slot present is classified, including unfiltered steps', () => {
    const step = { sdkmessageid: { name: 'Update' }, filteringattributes: 'akoya_title,wmkf_potentialreviewer5' };
    expect(classifySlotUpdateStep(step)).toBe('a slot (wmkf_potentialreviewer5)');
    expect(classifySlotUpdateStep({ ...step, filteringattributes: '' })).toBe('ANY column');
    expect(classifySlotUpdateStep({ ...step, filteringattributes: 'akoya_title' })).toBeNull();
    expect(classifySlotUpdateStep({ ...step, sdkmessageid: { name: 'Create' } })).toBeNull();
  });
});

describe('reviewer-slot metadata census', () => {
  test('keeps a slot-triggered flow and an any-column step, and marks an unreadable flow incomplete', async () => {
    const client = { get: jest.fn(async (path) => {
      if (path.includes('/Attributes(LogicalName=')) return { ok: true, body: { IsAuditEnabled: { Value: false } } };
      if (path.startsWith('/EntityDefinitions')) return { ok: true, body: { IsAuditEnabled: { Value: true } } };
      if (path.startsWith('/workflows?$select=name,category')) return { ok: true, body: { value: [] } };
      if (path.startsWith('/sdkmessageprocessingsteps?') && path.includes('primaryobjecttypecode')) {
        return { ok: true, body: { value: [{ name: 'Any-column step', stage: 40, mode: 1, ishidden: { Value: false }, sdkmessageid: { name: 'Update' }, filteringattributes: '' }] } };
      }
      if (path.startsWith('/sdkmessageprocessingsteps?')) return { ok: true, body: { value: [] } };
      if (path.startsWith('/workflows?$select=name,clientdata')) return { ok: true, body: { value: [
        { name: 'Slot flow', clientdata: flow({ triggers: { trigger: { inputs: { parameters: { 'subscriptionRequest/entityname': 'akoya_request', 'subscriptionRequest/message': 3, 'subscriptionRequest/filteringattributes': 'wmkf_potentialreviewer1' } } } } }) },
        { name: 'Unreadable flow', clientdata: null },
      ] } };
      throw new Error(`unexpected metadata path: ${path}`);
    }) };
    const log = jest.spyOn(console, 'log').mockImplementation(() => {});
    try {
      const receipt = await printReviewerSlotReadiness(client);
      expect(receipt.complete).toBe(false);
      expect(receipt.auditing.wmkf_potentialreviewer1).toBe(false);
      expect(receipt.steps).toEqual([expect.objectContaining({ name: 'Any-column step', hidden: false, firesOn: 'ANY column' })]);
      expect(receipt.flows).toEqual([expect.objectContaining({ name: 'Slot flow', firesOn: 'a slot (wmkf_potentialreviewer1)' })]);
      expect(receipt.incompleteReasons).toContain('1 cloud-flow definitions unreadable');
    } finally {
      log.mockRestore();
    }
  });
});
