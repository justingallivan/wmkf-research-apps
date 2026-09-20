import { compileTestRequestDraft, TEST_REQUEST_FIXED_FIELDS } from '../../lib/services/test-requests/policy';

const ids = {
  requestId: '11111111-1111-4111-8111-111111111111',
  runId: '22222222-2222-4222-8222-222222222222',
  testOrganizationId: '33333333-3333-4333-8333-333333333333',
};

const bodyFields = [
  'akoya_requestid',
  'akoya_applicantid@odata.bind',
  'akoya_title',
  'akoya_purpose',
  'akoya_request',
  'akoya_fiscalyear',
  'wmkf_meetingdate',
  TEST_REQUEST_FIXED_FIELDS.marker,
  TEST_REQUEST_FIXED_FIELDS.runId,
  TEST_REQUEST_FIXED_FIELDS.responseReminder,
  TEST_REQUEST_FIXED_FIELDS.reviewReminder,
];

function metadata(overrides = {}) {
  const fields = Object.fromEntries(bodyFields.map((field) => [field, {
    createable: true,
    requiredLevel: 'None',
    type: field === 'akoya_request' ? 'Money'
      : field === 'akoya_purpose' ? 'Memo'
        : field === 'akoya_requestid' ? 'Uniqueidentifier'
          : field.includes('reminder') || field === TEST_REQUEST_FIXED_FIELDS.marker ? 'Boolean'
            : field === TEST_REQUEST_FIXED_FIELDS.runId ? 'Uniqueidentifier'
              : field === 'wmkf_meetingdate' ? 'DateOnly' : 'String',
    ...(field === 'akoya_request' ? { minValue: 0, maxValue: 1000000000 } : {}),
    ...(field === 'akoya_title' ? { maxLength: 120 } : {}),
    ...(field === 'akoya_purpose' ? { maxLength: 100000 } : {}),
    ...(field === 'akoya_fiscalyear' ? { maxLength: 80 } : {}),
  }]));
  delete fields['akoya_applicantid@odata.bind'];
  fields.akoya_applicantid = { createable: true, requiredLevel: 'None', type: 'Lookup', lookupTarget: 'accounts' };
  return { entity: 'akoya_request', fields: { ...fields, ...overrides } };
}

function input(overrides = {}) {
  return {
    recipe: 'basic',
    sourceRequest: {
      akoya_requestid: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      akoya_title: 'Source title must not win',
      akoya_purpose: 'Synthetic purpose',
      akoya_request: 1250,
    },
    testLabel: 'Fixture one',
    fiscalYear: 'December 2026',
    meetingDate: '2026-12-01',
    metadata: metadata(),
    ...ids,
    ...overrides,
  };
}

describe('compileTestRequestDraft', () => {
  test('compiles the bounded basic body but never claims execution readiness', () => {
    const result = compileTestRequestDraft(input());
    expect(result.blockers).toEqual([]);
    expect(result.executionReady).toBe(false);
    expect(result.createBody).toEqual(expect.objectContaining({
      akoya_requestid: ids.requestId,
      'akoya_applicantid@odata.bind': `/accounts(${ids.testOrganizationId})`,
      akoya_title: 'TEST: Fixture one',
      akoya_purpose: 'Synthetic purpose',
      akoya_request: 1250,
      akoya_fiscalyear: 'December 2026',
      wmkf_meetingdate: '2026-12-01',
      [TEST_REQUEST_FIXED_FIELDS.marker]: true,
      [TEST_REQUEST_FIXED_FIELDS.runId]: ids.runId,
      [TEST_REQUEST_FIXED_FIELDS.responseReminder]: false,
      [TEST_REQUEST_FIXED_FIELDS.reviewReminder]: false,
    }));
    expect(result.createBody).not.toHaveProperty('akoya_requestnum');
  });

  test('rejects unsupported recipes and arbitrary client payloads', () => {
    const result = compileTestRequestDraft(input({ recipe: 'initial-assessment-ready', requestedAttributes: { evil: 'x' } }));
    expect(result.createBody).toBeNull();
    expect(result.blockers.map((item) => item.code)).toEqual(expect.arrayContaining(['RECIPE_UNSUPPORTED', 'INPUT_NOT_ALLOWED']));
  });

  test('projects malicious source identity, contacts, paid state, and annotations out', () => {
    const result = compileTestRequestDraft(input({
      sourceRequest: {
        ...input().sourceRequest,
        akoya_requestnum: '1000001',
        akoya_primarycontactid: 'contact-id',
        akoya_paid: 1,
        '@odata.etag': 'W/"secret"',
      },
    }));
    expect(result.blockers).toEqual([]);
    expect(result.createBody).not.toHaveProperty('akoya_requestnum');
    expect(result.createBody).not.toHaveProperty('akoya_primarycontactid');
    expect(result.createBody).not.toHaveProperty('akoya_paid');
    expect(result.createBody).not.toHaveProperty('@odata.etag');
  });

  test.each([
    ['requestId', { requestId: 'bad' }],
    ['runId', { runId: 'bad' }],
    ['testOrganizationId', { testOrganizationId: 'bad' }],
    ['meetingDate', { meetingDate: '2026-99-99' }],
    ['amount', { sourceRequest: { ...input().sourceRequest, akoya_request: -1 } }],
  ])('rejects invalid %s', (_label, overrides) => {
    const result = compileTestRequestDraft(input(overrides));
    expect(result.createBody).toBeNull();
    expect(result.blockers.some((item) => item.code === 'INPUT_INVALID')).toBe(true);
  });

  test('rejects source ID reuse and unknown lookup target', () => {
    const sameId = compileTestRequestDraft(input({ sourceRequest: { ...input().sourceRequest, akoya_requestid: ids.requestId } }));
    expect(sameId.blockers.some((item) => item.code === 'SOURCE_ID_REUSED')).toBe(true);

    const badLookup = compileTestRequestDraft(input({
      metadata: metadata({ akoya_applicantid: { createable: true, requiredLevel: 'None', type: 'Lookup', lookupTarget: 'contacts' } }),
    }));
    expect(badLookup.createBody).toBeNull();
    expect(badLookup.blockers.some((item) => item.code === 'LOOKUP_TARGET_UNKNOWN')).toBe(true);
  });

  test('rejects unknown, non-createable, and required metadata', () => {
    const unknown = compileTestRequestDraft(input({ metadata: { entity: 'akoya_request', fields: {} } }));
    expect(unknown.createBody).toBeNull();
    expect(unknown.blockers.some((item) => item.code === 'METADATA_UNKNOWN')).toBe(true);

    const nonCreateable = compileTestRequestDraft(input({
      metadata: metadata({ akoya_title: { createable: false, requiredLevel: 'None' } }),
    }));
    expect(nonCreateable.blockers.some((item) => item.code === 'FIELD_NOT_CREATEABLE')).toBe(true);

    const requiredUnknown = compileTestRequestDraft(input({
      metadata: metadata({ wmkf_vendor_required: { createable: true, requiredLevel: 'SystemRequired' } }),
    }));
    expect(requiredUnknown.blockers.some((item) => item.code === 'SYSTEM_REQUIRED_UNRESOLVED')).toBe(true);
  });

  test('missing or false createable marker/reminder metadata blocks the draft', () => {
    const missing = compileTestRequestDraft(input({
      metadata: metadata({ [TEST_REQUEST_FIXED_FIELDS.marker]: undefined }),
    }));
    expect(missing.createBody).toBeNull();
    expect(missing.blockers.some((item) => item.field === TEST_REQUEST_FIXED_FIELDS.marker)).toBe(true);

    const falseCreateable = compileTestRequestDraft(input({
      metadata: metadata({ [TEST_REQUEST_FIXED_FIELDS.responseReminder]: { createable: false, requiredLevel: 'None', type: 'Boolean' } }),
    }));
    expect(falseCreateable.createBody).toBeNull();
    expect(falseCreateable.blockers.some((item) => item.field === TEST_REQUEST_FIXED_FIELDS.responseReminder)).toBe(true);
  });
});


describe('draft compiler negative boundaries', () => {
  test.each([null, false, [], 'wrong'])('rejects non-object input %p', value => {
    expect(compileTestRequestDraft(value).createBody).toBeNull();
  });
  test('missing request GUID returns blockers rather than throwing', () => {
    expect(compileTestRequestDraft(input({requestId: undefined})).createBody).toBeNull();
  });
  test('case-only source identity reuse is rejected', () => {
    const requestId = input().sourceRequest.akoya_requestid.toUpperCase();
    expect(compileTestRequestDraft(input({requestId})).blockers).toEqual(expect.arrayContaining([expect.objectContaining({code:'SOURCE_ID_REUSED'})]));
  });
  test('normal metadata Recommended and required logical lookup are supported', () => {
    const m = metadata();
    m.fields.akoya_title.requiredLevel = 'Recommended';
    m.fields.akoya_applicantid.requiredLevel = 'ApplicationRequired';
    m.fields.createdbyname = {createable:false, requiredLevel:'SystemRequired', type:'String'};
    expect(compileTestRequestDraft(input({metadata:m})).blockers).toEqual([]);
  });
  test.each(['2026-02-29', '2026-04-31'])('rejects impossible calendar date %s', meetingDate => {
    expect(compileTestRequestDraft(input({meetingDate})).createBody).toBeNull();
  });
  test.each([
    ['akoya_title', {createable:true,requiredLevel:'None',type:'String',maxLength:4}],
    ['akoya_request', {createable:true,requiredLevel:'None',type:'Money',minValue:0,maxValue:1}],
    ['akoya_title', {createable:true,requiredLevel:'Mystery',type:'String',maxLength:200}],
    ['akoya_title', {createable:true,requiredLevel:'None',type:'Boolean'}],
    ['akoya_purpose', {createable:true,requiredLevel:'None',type:'Memo'}],
    ['required_extra', {createable:true,requiredLevel:'ApplicationRequired',type:'String',maxLength:20}],
  ])('rejects metadata mismatch or unsupplied required field %s', (field, spec) => {
    expect(compileTestRequestDraft(input({metadata:metadata({[field]:spec})})).createBody).toBeNull();
  });
  test('all injected source fields stay out without mutating source', () => {
    const sourceRequest = {...input().sourceRequest, akoya_requeststatus:'Closed', wmkf_istestrequest:false, wmkf_respondreminderenabled:true, arbitrary:'bad', 'akoya_applicantid@odata.bind':'/accounts(evil)'};
    const before = JSON.stringify(sourceRequest);
    const result = compileTestRequestDraft(input({sourceRequest}));
    expect(result.blockers).toEqual([]);
    expect(result.createBody).not.toHaveProperty('arbitrary');
    expect(result.createBody).not.toHaveProperty('akoya_requeststatus');
    expect(result.createBody.wmkf_istestrequest).toBe(true);
    expect(result.createBody.wmkf_respondreminderenabled).toBe(false);
    expect(result.createBody['akoya_applicantid@odata.bind']).toBe(`/accounts(${ids.testOrganizationId})`);
    expect(JSON.stringify(sourceRequest)).toBe(before);
  });
});


test.each([undefined, null, 'bad'])('source ID is required: %p', akoya_requestid => {
  const result = compileTestRequestDraft(input({sourceRequest:{...input().sourceRequest, akoya_requestid}}));
  expect(result.createBody).toBeNull();
  expect(result.blockers).toEqual(expect.arrayContaining([expect.objectContaining({code:'SOURCE_INVALID',field:'akoya_requestid'})]));
});
