/** @jest-environment node */

const {
  aggregate,
  aggregateWhenComplete,
  anchorBucket,
  validateGetUrl,
} = require('../../scripts/probe-memory-historical-impact.cjs');

const API = 'https://wmkf.crm.dynamics.com/api/data/v9.2/';

test('population summaries expose only aggregate counts and include missing-project-leader linked cohorts', () => {
  const requests = [
    { akoya_requestid: 'request-active', statecode: 0, _wmkf_projectleader_value: null, _wmkf_researchleader_value: 'research-lead-a' },
    { akoya_requestid: 'request-closed', statecode: 1, _wmkf_projectleader_value: null, _wmkf_researchleader_value: 'research-lead-b' },
  ];
  const suggestions = [
    { _wmkf_request_value: 'request-active', _wmkf_potentialreviewer_value: 'person-a', wmkf_selected: true },
    { _wmkf_request_value: 'request-closed', _wmkf_potentialreviewer_value: 'person-b', wmkf_selected: false },
    { _wmkf_request_value: 'outside-cohort', _wmkf_potentialreviewer_value: 'person-a', wmkf_selected: false },
  ];
  const people = [
    {
      wmkf_potentialreviewersid: 'person-a',
      wmkf_identitystatus: 'confirmed',
      wmkf_identityverifiedanchorsjson: '[{"canonicalKey":"orcid:0000-0002-1825-0097"}]',
      wmkf_orcid: '0000-0002-1825-0097',
      wmkf_primaryaffiliation: 'Private University',
    },
    {
      wmkf_potentialreviewersid: 'person-b',
      wmkf_identitystatus: 'unresolved',
      wmkf_identityverifiedanchorsjson: '[]',
      wmkf_emailaddress: 'person-b@example.org',
    },
  ];

  const result = aggregate(requests, suggestions, people);
  const cohort = result.missingProjectLeaderWithResearchLeader;
  expect(cohort).toMatchObject({
    requests: 2,
    linkedSuggestions: 2,
    selectedLinkedSuggestions: 1,
    linkedRequests: 2,
    linkedPeople: {
      distinctLinkedPeople: 2,
      protectedPeople: 1,
      protectedAnchors: { person_key_syntax_only: 1 },
      sharedPeople: 1,
      protectedSharedPeople: 1,
    },
    activeRequestLinked: {
      activeRequests: 1,
      linkedRequests: 1,
      requestsWithLinkedPeople: 1,
      people: {
        distinctLinkedPeople: 1,
        protectedPeople: 1,
        protectedAnchors: { person_key_syntax_only: 1 },
        sharedPeople: 1,
        protectedSharedPeople: 1,
      },
    },
  });
  const serialized = JSON.stringify(result);
  for (const privateValue of ['person-a', 'person-b', 'example.org', 'Private University', '0000-0002-1825-0097']) {
    expect(serialized).not.toContain(privateValue);
  }
});

test.each(['requests', 'suggestions', 'people'])('suppresses the entire aggregate when %s is incomplete or failed', (key) => {
  const complete = {
    requests: { status: 200, complete: true, rows: [] },
    suggestions: { status: 200, complete: true, rows: [] },
    people: { status: 200, complete: true, rows: [] },
  };

  for (const failed of [
    { status: 200, complete: false, rows: [{ privateId: 'partial-row' }] },
    { status: 503, complete: false, rows: [{ privateId: 'failed-row' }] },
  ]) {
    const result = aggregateWhenComplete({ ...complete, [key]: failed });
    expect(result).toEqual({
      aggregate: null,
      state: 'unavailable',
      error: 'required_population_query_incomplete',
      incompleteQueries: [key],
    });
  }
});

test('validates only the five paged collections, the two audit collections, and three exact metadata entities', () => {
  for (const collection of [
    'akoya_requests',
    'wmkf_appreviewersuggestions',
    'wmkf_potentialreviewerses',
    'wmkf_appsystemsettings',
    'wmkf_ai_prompts',
    'organizations',
    'audits',
  ]) {
    expect(validateGetUrl(`${collection}?$top=1`).pathname).toBe(`/api/data/v9.2/${collection}`);
  }
  for (const entity of ['akoya_request', 'wmkf_potentialreviewers', 'wmkf_appreviewersuggestion']) {
    expect(validateGetUrl(`EntityDefinitions(LogicalName='${entity}')?$select=IsAuditEnabled`).pathname)
      .toBe(`/api/data/v9.2/EntityDefinitions(LogicalName='${entity}')`);
  }
});

test.each([
  [`${API}akoya_requests/organizations`, `${API}akoya_requests`],
  [`${API}wmkf_potentialreviewerses-extra`, `${API}wmkf_potentialreviewerses`],
  ['https://attacker.example/api/data/v9.2/akoya_requests', `${API}akoya_requests`],
  [`${API}EntityDefinitions(LogicalName='systemuser')`, null],
])('refuses an unsafe path or nextlink hop: %s', (input, expectedPath) => {
  expect(() => validateGetUrl(input, { expectedPath })).toThrow();
});

test('accepts a nextlink only when it stays on the initial collection path', () => {
  const initialPath = validateGetUrl('wmkf_ai_prompts?$select=wmkf_ai_promptname').pathname;
  expect(() => validateGetUrl(`${API}wmkf_ai_prompts?$skiptoken=page-two`, { expectedPath: initialPath })).not.toThrow();
  expect(() => validateGetUrl(`${API}audits?$skiptoken=page-two`, { expectedPath: initialPath })).toThrow('unsafe_next_link');
});

test('requires GET and labels anchor evidence as syntax only', () => {
  expect(() => validateGetUrl('akoya_requests', { method: 'POST' })).toThrow('unsafe_get_method');
  expect(anchorBucket('not-json')).toBe('malformed_json');
  expect(anchorBucket(JSON.stringify([{ canonicalKey: 'orcid:0000-0002-1825-0097' }]))).toBe('person_key_syntax_only');
});


test('a paged next link cannot drop selected fields or change the filter', () => {
  const initial = validateGetUrl("wmkf_potentialreviewerses?$select=wmkf_identitystatus&$filter=statecode eq 0");
  const options = { expectedPath: initial.pathname, expectedQuery: initial.searchParams };
  expect(() => validateGetUrl("wmkf_potentialreviewerses?$filter=statecode eq 0", options)).toThrow('unsafe_next_query');
  expect(() => validateGetUrl("wmkf_potentialreviewerses?$select=wmkf_identitystatus&$filter=statecode eq 1", options)).toThrow('unsafe_next_query');
  expect(() => validateGetUrl("wmkf_potentialreviewerses?$select=wmkf_identitystatus&$filter=statecode eq 0&$skiptoken=safe", options)).not.toThrow();
});

test('history GET permits only the bounded person-history shape', () => {
  const target = encodeURIComponent(JSON.stringify({ '@odata.id': 'wmkf_potentialreviewerses(22222222-2222-4222-8222-222222222222)' }));
  const query = count => `RetrieveRecordChangeHistory(Target=@target,PagingInfo=@paginginfo)?@target=${target}&@paginginfo=${encodeURIComponent(JSON.stringify({ Count: count, PageNumber: 1, ReturnTotalRecordCount: false }))}`;
  expect(() => validateGetUrl(query(10))).not.toThrow();
  expect(() => validateGetUrl(query(1000))).toThrow('unsafe_get_path');
  expect(() => validateGetUrl(query(10).replace('RetrieveRecordChangeHistory', 'DeleteAuditData'))).toThrow('unsafe_get_path');
});
