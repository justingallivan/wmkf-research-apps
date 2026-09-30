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
  classifySlotWriteStep,
  printReviewerSlotReadiness: printReviewerSlotReadinessImpl,
} = require('../../scripts/probe-test-request-factory-production-readiness.js');

const flow = (definition) => JSON.stringify({ properties: { definition } });
const cleanSource = { commit: 'a'.repeat(40), probeDirty: false, clientDirty: false, branch: 'codex/test' };
const printReviewerSlotReadiness = (client, exportDir) => printReviewerSlotReadinessImpl(client, exportDir, cleanSource);

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
    expect(classifySlotUpdateFlow({ ...parameters, 'subscriptionRequest/message': true })).toBeNull();
    expect(classifySlotUpdateFlow({ ...parameters, 'subscriptionRequest/message': [3] })).toBeNull();
    expect(classifySlotUpdateFlow({ ...parameters, 'subscriptionRequest/filteringattributes': "@parameters('Cols')" }).firesOn).toBe('dynamic-or-unknown filter');
    expect(classifySlotUpdateFlow({ ...parameters, 'subscriptionRequest/filteringattributes': { expression: '@{cols}' } }).firesOn).toBe('dynamic-or-unknown filter');
  });

  test('an enabled Update step with the slot present is classified, including unfiltered steps', () => {
    const step = { sdkmessageid: { name: 'Update' }, filteringattributes: 'akoya_title,wmkf_potentialreviewer5' };
    expect(classifySlotWriteStep(step)).toBe('a slot (wmkf_potentialreviewer5)');
    expect(classifySlotWriteStep({ ...step, filteringattributes: '' })).toBe('ANY column');
    expect(classifySlotWriteStep({ ...step, filteringattributes: 'akoya_title' })).toBeNull();
    expect(classifySlotWriteStep({ ...step, sdkmessageid: { name: 'Create' } })).toBeNull();
    expect(classifySlotWriteStep({ sdkmessageid: { name: 'UpdateMultiple' }, filteringattributes: 'wmkf_potentialreviewer2' })).toBe('a slot (wmkf_potentialreviewer2)');
    expect(classifySlotWriteStep({ sdkmessageid: { name: 'UpdateMultiple' }, filteringattributes: '' })).toBe('ANY column');
    expect(classifySlotWriteStep({ sdkmessageid: { name: 'Upsert' }, filteringattributes: 'wmkf_potentialreviewer1' })).toBe('a slot (wmkf_potentialreviewer1)');
    expect(classifySlotWriteStep({ sdkmessageid: { name: 'UpsertMultiple' }, filteringattributes: '' })).toBe('ANY column');
    expect(classifySlotWriteStep({ ...step, filteringattributes: "@parameters('Cols')" })).toBe('dynamic-or-unknown filter');
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
      if (path.startsWith('/sdkmessageprocessingsteps?')) return { ok: true, body: { value: [...entitySteps, ...globalSteps] } };
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
      entitySteps: [
        { name: 'Any-column step', stage: 40, mode: 1, ishidden: { Value: false }, sdkmessageid: { name: 'Update' }, sdkmessagefilterid: { primaryobjecttypecode: 'akoya_request' }, filteringattributes: '' },
        { name: 'Request UpdateMultiple slot step', stage: 20, mode: 0, ishidden: { Value: false }, sdkmessageid: { name: 'UpdateMultiple' }, sdkmessagefilterid: { primaryobjecttypecode: 'akoya_request' }, filteringattributes: 'wmkf_potentialreviewer1', plugintypeid: { typename: 'AkoyaGo.RequestMulti' } },
        { name: 'Request Upsert slot step', stage: 20, mode: 0, ishidden: { Value: false }, sdkmessageid: { name: 'Upsert' }, sdkmessagefilterid: { primaryobjecttypecode: 'akoya_request' }, filteringattributes: 'wmkf_potentialreviewer1', plugintypeid: { typename: 'AkoyaGo.RequestUpsert' } },
        { name: 'Contact any-column step', stage: 40, mode: 0, ishidden: { Value: false }, sdkmessageid: { name: 'Update' }, sdkmessagefilterid: { primaryobjecttypecode: 'contact' }, filteringattributes: '', plugintypeid: { typename: 'AkoyaGo.ContactOnly' } },
      ],
      globalSteps: [
        { name: 'Hidden vendor step', stage: 40, mode: 0, ishidden: { Value: true }, sdkmessageid: { name: 'Update' }, sdkmessagefilterid: null, plugintypeid: { typename: 'AkoyaGo.Custom' }, sdkmessageprocessingstepid: inputId },
        { name: 'None-filter vendor step', stage: 40, mode: 0, ishidden: { Value: true }, sdkmessageid: { name: 'Update' }, sdkmessagefilterid: { primaryobjecttypecode: 'none' }, plugintypeid: { typename: 'AkoyaGo.NoneFilter' } },
        { name: 'Empty-filter vendor step', stage: 40, mode: 0, ishidden: { Value: false }, sdkmessageid: { name: 'Update' }, sdkmessagefilterid: { primaryobjecttypecode: '' }, plugintypeid: { typename: 'AkoyaGo.EmptyFilter' } },
        { name: 'Global UpdateMultiple vendor step', stage: 40, mode: 0, ishidden: { Value: false }, sdkmessageid: { name: 'UpdateMultiple' }, sdkmessagefilterid: { primaryobjecttypecode: 'none' }, plugintypeid: { typename: 'AkoyaGo.GlobalMulti' } },
        { name: 'Global UpsertMultiple vendor step', stage: 40, mode: 0, ishidden: { Value: false }, sdkmessageid: { name: 'UpsertMultiple' }, sdkmessagefilterid: { primaryobjecttypecode: 'none' }, plugintypeid: { typename: 'AkoyaGo.GlobalUpsertMulti' } },
        { name: 'Hidden platform step', stage: 40, mode: 0, ishidden: { Value: true }, sdkmessageid: { name: 'Update' }, sdkmessagefilterid: null, plugintypeid: { typename: 'Microsoft.Platform' } },
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
      expect(receipt.dispositionRequired).toContain('flow mentions Request or slot without a classified Request trigger: Action mention / trigger');
      expect(receipt.workflows).toEqual(expect.arrayContaining([
        expect.objectContaining({ name: 'Slot workflow', triggered: true, mode: 'real-time', readable: true }),
        expect.objectContaining({ name: 'Unreadable slot workflow', triggered: true, readable: false }),
        expect.objectContaining({ name: 'Slot business rule', kind: 'business rule', mentions: ['wmkf_potentialreviewer3'] }),
      ]));
      expect(receipt.steps).toEqual(expect.arrayContaining([
        expect.objectContaining({ name: 'Any-column step', hidden: false, firesOn: 'ANY column' }),
        expect.objectContaining({ name: 'Hidden vendor step', hidden: true, firesOn: 'ANY entity/column' }),
        expect.objectContaining({ name: 'None-filter vendor step', hidden: true, firesOn: 'ANY entity/column' }),
        expect.objectContaining({ name: 'Request UpdateMultiple slot step', message: 'UpdateMultiple', firesOn: 'a slot (wmkf_potentialreviewer1)' }),
        expect.objectContaining({ name: 'Request Upsert slot step', message: 'Upsert', firesOn: 'a slot (wmkf_potentialreviewer1)' }),
        expect.objectContaining({ name: 'Empty-filter vendor step', message: 'Update', firesOn: 'ANY entity/column' }),
        expect.objectContaining({ name: 'Global UpdateMultiple vendor step', message: 'UpdateMultiple', firesOn: 'ANY entity/column' }),
        expect.objectContaining({ name: 'Global UpsertMultiple vendor step', message: 'UpsertMultiple', firesOn: 'ANY entity/column' }),
      ]));
      expect(receipt.steps).not.toEqual(expect.arrayContaining([expect.objectContaining({ name: 'Hidden platform step' })]));
      expect(receipt.steps).not.toEqual(expect.arrayContaining([expect.objectContaining({ name: 'Contact any-column step' })]));
      expect(receipt.flows).toEqual([expect.objectContaining({ name: 'Slot flow', firesOn: 'a slot (wmkf_potentialreviewer1)' })]);
      expect(receipt.incompleteReasons).toContain('1 cloud-flow definitions unreadable');
      expect(receipt.counts).toEqual(expect.objectContaining({ activatedWorkflowsAndRules: 3, updateTriggeredWorkflows: 2, unreadableWorkflowsAndRules: 1, allEnabledSlotWriteSteps: 10, allEnabledUpdateMultipleSteps: 2, allEnabledUpsertSteps: 1, allEnabledUpsertMultipleSteps: 1, requestSlotWriteSteps: 3, globalSlotWriteSteps: 6, hiddenMicrosoftPlatformSlotWriteSteps: 1, flowsMentioningRequestOrSlot: 5, hardBlockedFlowTriggers: 2, actionOnlyTriggerDispositions: 1, triggerReviewEntries: 3 }));
      expect(receipt.flowMentions).toEqual(expect.arrayContaining([expect.objectContaining({ name: 'Unreadable flow', readable: false })]));
      expect(receipt.flowTriggerSummaries).toHaveLength(5);
      expect(receipt.flowTriggerSummaries).toContainEqual(expect.objectContaining({ name: 'Action mention', triggers: [expect.objectContaining({ name: 'trigger', type: 'Recurrence', classification: 'other trigger: owner disposition for Request/slot actions' })] }));
      expect(receipt.steps).toContainEqual(expect.objectContaining({ name: 'Hidden vendor step', entityFilter: 'absent lookup' }));
      expect(receipt.steps).toContainEqual(expect.objectContaining({ name: 'None-filter vendor step', entityFilter: 'none' }));
      expect(receipt.section).toBe(13);
      expect(receipt.target).toBe('https://wmkf.crm.dynamics.com');
      const stepQueries = client.get.mock.calls.map(([path]) => path).filter((path) => path.startsWith('/sdkmessageprocessingsteps?'));
      expect(stepQueries).toHaveLength(1);
      expect(stepQueries[0]).toContain("$filter=(sdkmessageid/name eq 'Update' or sdkmessageid/name eq 'UpdateMultiple' or sdkmessageid/name eq 'Upsert' or sdkmessageid/name eq 'UpsertMultiple') and statecode eq 0");
      expect(stepQueries[0]).not.toContain("primaryobjecttypecode eq 'akoya_request'");
      expect(write).toHaveBeenCalledWith(expect.stringContaining('reviewer-slot-readiness-receipt-'), expect.any(String), { flag: 'wx' });
      const saved = write.mock.calls[0][1];
      expect(saved).not.toContain(inputId);
      expect(JSON.parse(saved).counts).toEqual(expect.objectContaining({ hardBlockedFlowTriggers: 2, actionOnlyTriggerDispositions: 1 }));
      expect(JSON.parse(saved).source.commit).toMatch(/^[0-9a-f]{40}$/);
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
      expect(receipt.dispositionRequired).toEqual([]);
    } finally {
      log.mockRestore();
    }
  });

  test('a Request update flow that can fire on a slot requires disposition', async () => {
    const client = clientFor({ flows: [{ name: 'Slot update flow', clientdata: flow({ triggers: { changed: { inputs: { parameters: {
      'subscriptionRequest/entityname': 'akoya_request', 'subscriptionRequest/message': 3,
      'subscriptionRequest/filteringattributes': 'wmkf_potentialreviewer1',
    } } } } }) }] });
    const log = jest.spyOn(console, 'log').mockImplementation(() => {});
    try {
      const receipt = await printReviewerSlotReadiness(client);
      expect(receipt.complete).toBe(false);
      expect(receipt.dispositionRequired).toContain('Request flow can fire on reviewer-slot update: Slot update flow / changed');
      expect(receipt.counts.requestUpdateTriggers).toBe(1);
    } finally {
      log.mockRestore();
    }
  });

  test('a classic workflow triggered by the slot requires disposition', async () => {
    const client = clientFor({ workflows: [{ name: 'Slot workflow', category: 0, mode: 1, triggeronupdateattributelist: 'wmkf_potentialreviewer1', xaml: '<Workflow />' }] });
    const log = jest.spyOn(console, 'log').mockImplementation(() => {});
    try {
      const receipt = await printReviewerSlotReadiness(client);
      expect(receipt.complete).toBe(false);
      expect(receipt.dispositionRequired).toContain('Request workflow can fire on reviewer-slot update: Slot workflow');
      expect(receipt.workflows).toEqual([expect.objectContaining({ name: 'Slot workflow', updateAttributes: ['wmkf_potentialreviewer1'] })]);
    } finally {
      log.mockRestore();
    }
  });

  test('lists Request steps and workflows filtered to other columns for indirect-chain review', async () => {
    const client = clientFor({
      workflows: [{ name: 'Other-column workflow', category: 0, mode: 0, triggeronupdateattributelist: 'akoya_title', xaml: '<Workflow />' }],
      entitySteps: [{ name: 'Other-column step', stage: 20, mode: 0, filteringattributes: 'akoya_title', sdkmessageid: { name: 'Update' }, sdkmessagefilterid: { primaryobjecttypecode: 'akoya_request' } }],
      flows: [{ name: 'Create only', clientdata: flow({ triggers: { created: { inputs: { parameters: { 'subscriptionRequest/entityname': 'akoya_request', 'subscriptionRequest/message': 1 } } } } }) }],
    });
    const log = jest.spyOn(console, 'log').mockImplementation(() => {});
    try {
      const receipt = await printReviewerSlotReadiness(client);
      expect(receipt.workflows).toEqual([expect.objectContaining({ name: 'Other-column workflow', updateAttributes: ['akoya_title'] })]);
      expect(receipt.steps).toEqual([expect.objectContaining({ name: 'Other-column step', filteringColumns: ['akoya_title'], firesOn: 'other columns only' })]);
    } finally {
      log.mockRestore();
    }
  });

  test('dirty or missing probe provenance hard-blocks the receipt', async () => {
    const client = clientFor({ flows: [{ name: 'Create only', clientdata: flow({ triggers: { created: { inputs: { parameters: { 'subscriptionRequest/entityname': 'akoya_request', 'subscriptionRequest/message': 1 } } } } }) }] });
    const log = jest.spyOn(console, 'log').mockImplementation(() => {});
    try {
      for (const source of [{ ...cleanSource, probeDirty: true }, { ...cleanSource, clientDirty: true }, { ...cleanSource, commit: null }]) {
        const receipt = await printReviewerSlotReadinessImpl(client, undefined, source);
        expect(receipt.complete).toBe(false);
        expect(receipt.incompleteReasons).toContain('probe source not a committed clean tree');
      }
    } finally {
      log.mockRestore();
    }
  });

  test('manual API-connection Request mentions require disposition without an unknown-trigger hard block', async () => {
    const client = clientFor({ flows: [{ name: 'Manual Request action', clientdata: flow({
      triggers: { manual: { type: 'Request', kind: 'ApiConnection', inputs: { parameters: { dataset: 'org', table: 'akoya_requests' } } } },
      actions: { update: { inputs: { parameters: { entityName: 'akoya_requests' } } } },
    }) }] });
    const log = jest.spyOn(console, 'log').mockImplementation(() => {});
    try {
      const receipt = await printReviewerSlotReadiness(client);
      expect(receipt.complete).toBe(false);
      expect(receipt.incompleteReasons).toEqual([]);
      expect(receipt.dispositionRequired).toEqual(['manual API-connection trigger in Request/slot-mentioning flow requires owner classification: Manual Request action / manual']);
      expect(receipt.flowTriggerReviewEntries).toEqual([{ name: 'Manual Request action', trigger: 'manual', reason: 'manual API-connection trigger without Dataverse subscription' }]);
      expect(receipt.counts.manualApiConnectionTriggers).toBe(1);
      expect(receipt.counts.hardBlockedFlowTriggers).toBe(0);
      expect(receipt.counts.requestUpdateTriggers).toBe(0);
    } finally {
      log.mockRestore();
    }
  });

  test('a dynamic Dataverse subscription target hard-blocks even without a literal Request mention', async () => {
    const client = clientFor({ flows: [{ name: 'Dynamic table flow', clientdata: flow({
      triggers: { changed: { type: 'OpenApiConnectionWebhook', inputs: { parameters: { 'subscriptionRequest/entityname': "@parameters('Table (x_Table)')", 'subscriptionRequest/message': 3 } } } },
    }) }] });
    const log = jest.spyOn(console, 'log').mockImplementation(() => {});
    try {
      const receipt = await printReviewerSlotReadiness(client);
      expect(receipt.complete).toBe(false);
      expect(receipt.incompleteReasons).toContain('cloud-flow trigger table dynamic or unknown: Dynamic table flow / changed');
      expect(receipt.counts.hardBlockedFlowTriggers).toBe(1);
      expect(receipt.flowMentions).toEqual([]);
      expect(receipt.flowTriggerSummaries).toEqual([{ name: 'Dynamic table flow', readable: true, triggers: [expect.objectContaining({ name: 'changed', subscriptionTarget: 'dynamic-or-unknown', entity: null, message: 3 })] }]);
    } finally {
      log.mockRestore();
    }
  });

  test.each([
    ['parameter entityName', { parameters: { entityName: "@parameters('T')" } }],
    ['path', { path: '/tables/@{parameters(\'T\')}/onchanged' }],
  ])('a dynamic trigger %s hard-blocks without a Request literal', async (_label, inputs) => {
    const client = clientFor({ flows: [{ name: 'Expression trigger', clientdata: flow({ triggers: { changed: { type: 'OpenApiConnectionWebhook', inputs } } }) }] });
    const log = jest.spyOn(console, 'log').mockImplementation(() => {});
    try {
      const receipt = await printReviewerSlotReadiness(client);
      expect(receipt.complete).toBe(false);
      expect(receipt.incompleteReasons).toContain('cloud-flow trigger table dynamic or unknown: Expression trigger / changed');
      expect(JSON.stringify(receipt)).not.toContain("parameters('T')");
    } finally {
      log.mockRestore();
    }
  });

  test('a dynamic Request update filter hard-blocks without exposing its expression', async () => {
    const client = clientFor({ flows: [{ name: 'Dynamic filter', clientdata: flow({ triggers: { changed: { inputs: { parameters: {
      'subscriptionRequest/entityname': 'akoya_request', 'subscriptionRequest/message': 3,
      'subscriptionRequest/filteringattributes': "@parameters('Cols')",
    } } } } }) }] });
    const log = jest.spyOn(console, 'log').mockImplementation(() => {});
    try {
      const receipt = await printReviewerSlotReadiness(client);
      expect(receipt.complete).toBe(false);
      expect(receipt.incompleteReasons).toContain('Request update filter dynamic or unknown: Dynamic filter / changed');
      expect(receipt.flows).toEqual([{ name: 'Dynamic filter', trigger: 'changed', message: 'update', firesOn: 'dynamic-or-unknown filter' }]);
      expect(JSON.stringify(receipt)).not.toContain("@parameters('Cols')");
    } finally {
      log.mockRestore();
    }
  });

  test('a dynamic connector table hard-blocks without a Request literal', async () => {
    const client = clientFor({ flows: [{ name: 'Dynamic connector table', clientdata: flow({
      triggers: { manual: { type: 'Request', kind: 'ApiConnection', inputs: { parameters: { dataset: 'org', table: "@parameters('Table')" } } } },
    }) }] });
    const log = jest.spyOn(console, 'log').mockImplementation(() => {});
    try {
      const receipt = await printReviewerSlotReadiness(client);
      expect(receipt.complete).toBe(false);
      expect(receipt.incompleteReasons).toContain('cloud-flow trigger table dynamic or unknown: Dynamic connector table / manual');
      expect(receipt.flowTriggerSummaries[0].triggers[0]).toEqual(expect.objectContaining({ tableTarget: 'dynamic-or-unknown', table: null }));
    } finally {
      log.mockRestore();
    }
  });

  test('observed connection and authentication expressions do not masquerade as table expressions', async () => {
    const client = clientFor({ flows: [
      { name: 'Manual Request action', clientdata: flow({
        triggers: { manual: { type: 'Request', kind: 'ApiConnection', inputs: { host: { connection: { name: "@parameters('$connections')" } }, parameters: { dataset: 'org', table: 'akoya_requests' } } } },
      }) },
      { name: 'Other entity Request action', clientdata: flow({
        triggers: { changed: { type: 'OpenApiConnectionWebhook', inputs: { authentication: "@parameters('$authentication')", parameters: { 'subscriptionRequest/entityname': 'akoya_goapplystatustracking', 'subscriptionRequest/message': 1 } } } },
        actions: { read: { inputs: { parameters: { entityName: 'akoya_requests' } } } },
      }) },
    ] });
    const log = jest.spyOn(console, 'log').mockImplementation(() => {});
    try {
      const receipt = await printReviewerSlotReadiness(client);
      expect(receipt.incompleteReasons).toEqual([]);
      expect(receipt.counts.manualApiConnectionTriggers).toBe(1);
      expect(receipt.counts.actionOnlyTriggerDispositions).toBe(1);
      expect(receipt.dispositionRequired).toHaveLength(2);
      expect(receipt.flowTriggerSummaries).toHaveLength(2);
    } finally {
      log.mockRestore();
    }
  });

  test('reports every trigger in a mixed Request flow, including the unrelated second trigger', async () => {
    const client = clientFor({ flows: [{ name: 'Mixed flow', clientdata: flow({
      triggers: {
        requestCreated: { inputs: { parameters: { 'subscriptionRequest/entityname': 'akoya_request', 'subscriptionRequest/message': 1 } } },
        scheduled: { type: 'Recurrence' },
      },
    }) }] });
    const log = jest.spyOn(console, 'log').mockImplementation(() => {});
    try {
      const receipt = await printReviewerSlotReadiness(client);
      expect(receipt.complete).toBe(false);
      expect(receipt.dispositionRequired).toContain('flow mentions Request or slot without a classified Request trigger: Mixed flow / scheduled');
      expect(receipt.flowTriggerSummaries[0].triggers).toHaveLength(2);
      expect(receipt.counts.requestNonUpdateTriggers).toBe(1);
      expect(receipt.counts.actionOnlyTriggerDispositions).toBe(1);
    } finally {
      log.mockRestore();
    }
  });

  test('reports the second trigger beside a manual Request action without duplicating the manual disposition', async () => {
    const client = clientFor({ flows: [{ name: 'Mixed manual flow', clientdata: flow({
      triggers: {
        manual: { type: 'Request', kind: 'ApiConnection', inputs: { parameters: { dataset: 'org', table: 'akoya_requests' } } },
        scheduled: { type: 'Recurrence' },
      },
      actions: { update: { inputs: { parameters: { entityName: 'akoya_requests' } } } },
    }) }] });
    const log = jest.spyOn(console, 'log').mockImplementation(() => {});
    try {
      const receipt = await printReviewerSlotReadiness(client);
      expect(receipt.dispositionRequired).toEqual([
        'manual API-connection trigger in Request/slot-mentioning flow requires owner classification: Mixed manual flow / manual',
        'flow mentions Request or slot without a classified Request trigger: Mixed manual flow / scheduled',
      ]);
      expect(receipt.counts.manualApiConnectionTriggers).toBe(1);
      expect(receipt.counts.actionOnlyTriggerDispositions).toBe(1);
    } finally {
      log.mockRestore();
    }
  });

  test('a manual-shaped trigger without a Request mention is summarized but needs no Request disposition', async () => {
    const client = clientFor({ flows: [{ name: 'Unrelated manual flow', clientdata: flow({
      triggers: { manual: { type: 'Request', kind: 'ApiConnection', inputs: { parameters: { dataset: 'org', table: 'contacts' } } } },
    }) }] });
    const log = jest.spyOn(console, 'log').mockImplementation(() => {});
    try {
      const receipt = await printReviewerSlotReadiness(client);
      expect(receipt.complete).toBe(true);
      expect(receipt.flowTriggerSummaries).toEqual([{ name: 'Unrelated manual flow', readable: true, triggers: [expect.objectContaining({ name: 'manual', classification: 'no Request/slot mention' })] }]);
      expect(receipt.dispositionRequired).toEqual([]);
    } finally {
      log.mockRestore();
    }
  });

  test('a flow with no usable trigger list cannot produce a complete receipt', async () => {
    const client = clientFor({ flows: [{ name: 'No triggers', clientdata: flow({ actions: {} }) }] });
    const log = jest.spyOn(console, 'log').mockImplementation(() => {});
    try {
      const receipt = await printReviewerSlotReadiness(client);
      expect(receipt.complete).toBe(false);
      expect(receipt.incompleteReasons).toContain('cloud-flow triggers missing or unreadable: No triggers');
      expect(receipt.flowTriggerSummaries).toEqual([{ name: 'No triggers', readable: false, triggers: [] }]);
    } finally {
      log.mockRestore();
    }
  });

  test('reports incomplete when no activated cloud flows are visible', async () => {
    const client = clientFor();
    const log = jest.spyOn(console, 'log').mockImplementation(() => {});
    try {
      const receipt = await printReviewerSlotReadiness(client);
      expect(receipt.complete).toBe(false);
      expect(receipt.counts.flowsRead).toBe(0);
      expect(receipt.dispositionRequired).toContain('no activated cloud flows visible to the probe identity; confirm zero against an admin inventory');
      expect(receipt.incompleteReasons).toEqual([]);
    } finally {
      log.mockRestore();
    }
  });

  test.each([
    ['unknown message', flow({ triggers: { trigger: { inputs: { parameters: { 'subscriptionRequest/entityname': 'akoya_request', 'subscriptionRequest/message': 99 } } } } })],
    ['alternate trigger', flow({ triggers: { trigger: { inputs: { parameters: { entityName: 'akoya_request' } } } } })],
    ['manual lookalike with extra parameter', flow({ triggers: { manual: { type: 'Request', kind: 'ApiConnection', inputs: { parameters: { dataset: 'org', table: 'akoya_requests', 'subscriptionRequest/message': 3 } } } } })],
    ['manual lookalike with HTTP kind', flow({ triggers: { manual: { type: 'Request', kind: 'Http', inputs: { parameters: { dataset: 'org', table: 'akoya_requests' } } } } })],
    ['manual lookalike with wrong type', flow({ triggers: { manual: { type: 'ApiConnection', kind: 'ApiConnection', inputs: { parameters: { dataset: 'org', table: 'akoya_requests' } } } } })],
    ['manual lookalike with wrong trigger name', flow({ triggers: { onChange: { type: 'Request', kind: 'ApiConnection', inputs: { parameters: { dataset: 'org', table: 'akoya_requests' } } } } })],
    ['manual lookalike without table', flow({ triggers: { manual: { type: 'Request', kind: 'ApiConnection', inputs: { parameters: { dataset: 'org', other: 'akoya_requests' } } } } })],
    ['action-only mention', flow({ triggers: { trigger: { type: 'Recurrence' } }, actions: { update: { inputs: { parameters: { entityName: 'akoya_requests' } } } } })],
  ])('fails closed on a %s flow without another incomplete reason', async (_label, clientdata) => {
    const client = clientFor({ flows: [{ name: 'Unclassified flow', clientdata }] });
    const log = jest.spyOn(console, 'log').mockImplementation(() => {});
    try {
      const receipt = await printReviewerSlotReadiness(client);
      expect(receipt.complete).toBe(false);
      expect(receipt.counts.triggerReviewEntries).toBe(1);
      if (_label === 'action-only mention') {
        expect(receipt.incompleteReasons).toEqual([]);
        expect(receipt.dispositionRequired).toHaveLength(1);
        expect(receipt.counts.actionOnlyTriggerDispositions).toBe(1);
      } else {
        expect(receipt.incompleteReasons).toHaveLength(1);
        expect(receipt.dispositionRequired).toEqual([]);
        expect(receipt.counts.hardBlockedFlowTriggers).toBe(1);
      }
    } finally {
      log.mockRestore();
    }
  });
});
