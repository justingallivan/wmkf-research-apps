/**
 * Probe sections 12–13 (scripts/probe-test-request-factory-production-readiness.js):
 * cast-readiness classifiers plus the Potential Reviewer slot update census.
 */
const fs = require('fs');
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
    for (const message of [4, 6, 7]) {
      expect(classifySlotUpdateFlow({ ...parameters, 'subscriptionRequest/message': message }).firesOn).toBe('a slot (wmkf_potentialreviewer1)');
    }
    expect(classifySlotUpdateFlow({ ...parameters, 'subscriptionRequest/message': '3' }).message).toBe('update');
    expect(classifySlotUpdateFlow({ ...parameters, 'subscriptionRequest/message': 99 })).toBeNull();
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
  function clientFor({ workflows = [], entitySteps = [], globalSteps = [], flows = [], unreadableSlot = null } = {}) {
    return { get: jest.fn(async (path) => {
      if (path.includes('/Attributes(LogicalName=')) {
        const slot = path.match(/Attributes\(LogicalName='([^']+)'\)/)?.[1];
        return { ok: true, body: { IsAuditEnabled: { Value: slot === unreadableSlot ? null : false } } };
      }
      if (path.startsWith('/EntityDefinitions')) return { ok: true, body: { IsAuditEnabled: { Value: true } } };
      if (path.startsWith('/workflows?$select=name,category')) return { ok: true, body: { value: workflows } };
      if (path.startsWith('/sdkmessageprocessingsteps?') && path.includes('primaryobjecttypecode')) {
        return { ok: true, body: { value: entitySteps } };
      }
      if (path.startsWith('/sdkmessageprocessingsteps?')) return { ok: true, body: { value: globalSteps } };
      if (path.startsWith('/workflows?$select=name,clientdata')) return { ok: true, body: { value: flows } };
      throw new Error(`unexpected metadata path: ${path}`);
    }) };
  }

  test('records ambiguous automation and audit metadata as incomplete, including the saved receipt', async () => {
    const inputId = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
    const client = clientFor({
      unreadableSlot: 'wmkf_potentialreviewer2',
      workflows: [
        { name: 'Slot workflow', workflowid: inputId, category: 0, mode: 1, triggeronupdateattributelist: 'WMKF_PotentialReviewer1', xaml: 'wmkf_potentialreviewer1' },
        { name: 'Unreadable slot workflow', category: 0, mode: 0, triggeronupdateattributelist: 'wmkf_potentialreviewer2', xaml: null },
        { name: 'Slot business rule', category: 2, mode: 0, xaml: 'wmkf_potentialreviewer3' },
      ],
      entitySteps: [{ name: 'Any-column step', stage: 40, mode: 1, ishidden: { Value: false }, sdkmessageid: { name: 'Update' }, filteringattributes: '' }],
      globalSteps: [
        { name: 'Hidden vendor step', stage: 40, mode: 0, ishidden: { Value: true }, sdkmessageid: { name: 'Update' }, plugintypeid: { typename: 'AkoyaGo.Custom' }, sdkmessageprocessingstepid: inputId },
        { name: 'Hidden platform step', stage: 40, mode: 0, ishidden: { Value: true }, sdkmessageid: { name: 'Update' }, plugintypeid: { typename: 'Microsoft.Platform' } },
      ],
      flows: [
        { name: 'Slot flow', workflowid: inputId, clientdata: flow({ triggers: { trigger: { inputs: { parameters: { 'subscriptionRequest/entityname': 'akoya_request', 'subscriptionRequest/message': 3, 'subscriptionRequest/filteringattributes': 'wmkf_potentialreviewer1' } } } } }) },
        { name: 'Unknown message', clientdata: flow({ triggers: { trigger: { inputs: { parameters: { 'subscriptionRequest/entityname': 'akoya_request', 'subscriptionRequest/message': 99 } } } } }) },
        { name: 'Alternate trigger', clientdata: flow({ triggers: { trigger: { inputs: { parameters: { entityName: 'akoya_request' } } } } }) },
        { name: 'Action mention', clientdata: flow({ triggers: { trigger: { type: 'Recurrence' } }, actions: { update: { inputs: { parameters: { entityName: 'akoya_requests' } } } } }) },
        { name: 'Unreadable flow', clientdata: '{"bad":"akoya_request"' },
      ],
    });
    const log = jest.spyOn(console, 'log').mockImplementation(() => {});
    const mkdir = jest.spyOn(fs, 'mkdirSync').mockImplementation(() => {});
    const write = jest.spyOn(fs, 'writeFileSync').mockImplementation(() => {});
    try {
      const receipt = await printReviewerSlotReadiness(client, '/tmp/b4-probe-receipt-test');
      expect(receipt.complete).toBe(false);
      expect(receipt.auditing.wmkf_potentialreviewer1).toBe(false);
      expect(receipt.incompleteReasons).toContain('wmkf_potentialreviewer2 auditing unreadable');
      expect(receipt.incompleteReasons).toContain('workflow definition unreadable: Unreadable slot workflow');
      expect(receipt.incompleteReasons).toContain('Request flow trigger message unrecognized: Unknown message / trigger');
      expect(receipt.incompleteReasons).toContain('Request flow trigger shape unclassified: Alternate trigger / trigger');
      expect(receipt.incompleteReasons).toContain('flow mentions Request or slot without a classified Request trigger: Action mention');
      expect(receipt.workflows).toEqual(expect.arrayContaining([
        expect.objectContaining({ name: 'Slot workflow', triggered: true, mode: 'real-time', readable: true }),
        expect.objectContaining({ name: 'Unreadable slot workflow', triggered: true, readable: false }),
        expect.objectContaining({ name: 'Slot business rule', kind: 'business rule', mentions: ['wmkf_potentialreviewer3'] }),
      ]));
      expect(receipt.steps).toEqual(expect.arrayContaining([
        expect.objectContaining({ name: 'Any-column step', hidden: false, firesOn: 'ANY column' }),
        expect.objectContaining({ name: 'Hidden vendor step', hidden: true, firesOn: 'ANY entity/column' }),
      ]));
      expect(receipt.steps).not.toEqual(expect.arrayContaining([expect.objectContaining({ name: 'Hidden platform step' })]));
      expect(receipt.flows).toEqual([expect.objectContaining({ name: 'Slot flow', firesOn: 'a slot (wmkf_potentialreviewer1)' })]);
      expect(receipt.incompleteReasons).toContain('1 cloud-flow definitions unreadable');
      expect(receipt.counts).toEqual(expect.objectContaining({ activatedWorkflowsAndRules: 3, updateTriggeredWorkflows: 2, unreadableWorkflowsAndRules: 1, entityUpdateSteps: 1, hiddenMicrosoftPlatformUpdateSteps: 1, flowsMentioningRequestOrSlot: 5, unclassifiedFlowTriggers: 3 }));
      expect(receipt.flowMentions).toEqual(expect.arrayContaining([expect.objectContaining({ name: 'Unreadable flow', readable: false })]));
      expect(receipt.section).toBe(13);
      expect(receipt.target).toBe('https://wmkf.crm.dynamics.com');
      expect(write).toHaveBeenCalledWith(expect.stringContaining('reviewer-slot-readiness-receipt-'), expect.any(String), { flag: 'wx' });
      const saved = write.mock.calls[0][1];
      expect(saved).not.toContain(inputId);
      expect(JSON.parse(saved).counts).toEqual(expect.objectContaining({ unclassifiedFlowTriggers: 3 }));
    } finally {
      write.mockRestore();
      mkdir.mockRestore();
      log.mockRestore();
    }
  });

  test('reports complete when audited metadata and known trigger shapes are readable', async () => {
    const client = clientFor({ flows: [{ name: 'Request create flow', clientdata: flow({ triggers: { trigger: { inputs: { parameters: { 'subscriptionRequest/entityname': 'akoya_request', 'subscriptionRequest/message': 1 } } } } }) }] });
    const log = jest.spyOn(console, 'log').mockImplementation(() => {});
    try {
      const receipt = await printReviewerSlotReadiness(client);
      expect(receipt.complete).toBe(true);
      expect(receipt.counts.requestUpdateTriggers).toBe(0);
      expect(receipt.counts.requestNonUpdateTriggers).toBe(1);
      expect(receipt.flowMentions).toEqual([expect.objectContaining({ name: 'Request create flow', recognizedRequestTriggers: 1 })]);
    } finally {
      log.mockRestore();
    }
  });

  test.each([
    ['unknown message', flow({ triggers: { trigger: { inputs: { parameters: { 'subscriptionRequest/entityname': 'akoya_request', 'subscriptionRequest/message': 99 } } } } })],
    ['alternate trigger', flow({ triggers: { trigger: { inputs: { parameters: { entityName: 'akoya_request' } } } } })],
    ['action-only mention', flow({ triggers: { trigger: { type: 'Recurrence' } }, actions: { update: { inputs: { parameters: { entityName: 'akoya_requests' } } } } })],
  ])('fails closed on a %s flow without another incomplete reason', async (_label, clientdata) => {
    const client = clientFor({ flows: [{ name: 'Unclassified flow', clientdata }] });
    const log = jest.spyOn(console, 'log').mockImplementation(() => {});
    try {
      const receipt = await printReviewerSlotReadiness(client);
      expect(receipt.complete).toBe(false);
      expect(receipt.counts.unclassifiedFlowTriggers).toBe(1);
      expect(receipt.incompleteReasons).toHaveLength(1);
    } finally {
      log.mockRestore();
    }
  });
});
