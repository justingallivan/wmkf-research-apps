import { extractODataFieldTokens, validateODataCall } from '../../lib/services/dynamics-odata-validator';

const tableAnnotations = {
  akoya_request: { entitySet: 'akoya_requests' },
  account: { entitySet: 'accounts' },
};

const attrs = [
  { logicalName: 'akoya_requestid', type: 'Uniqueidentifier' },
  { logicalName: 'akoya_requestnum', type: 'String' },
  { logicalName: 'akoya_title', type: 'String' },
  { logicalName: 'akoya_submitdate', type: 'DateTime' },
  { logicalName: 'akoya_fiscalyear', type: 'String' },
  { logicalName: 'createdon', type: 'DateTime' },
  { logicalName: 'statecode', type: 'State' },
  { logicalName: '_regardingobjectid_value', type: 'Lookup' },
  { logicalName: '_wmkf_potentialreviewer1_value', type: 'Lookup' },
  { logicalName: 'wmkf_abstract', type: 'Memo' },
  { logicalName: 'wmkf_programareaserved_research', type: 'MultiSelectPicklist' },
  { logicalName: 'wmkf_secret', type: 'String' },
];

const ctx = (overrides = {}) => ({
  tableAnnotations,
  getEntityAttributes: jest.fn(() => Promise.resolve(attrs)),
  restrictions: [],
  entityConfigs: {
    file: { entitySet: 'annotations', idField: 'annotationid' },
  },
  ...overrides,
});

describe('Dynamics Explorer OData pre-flight validator', () => {
  test('tokenizer ignores escaped-quote string literals', () => {
    expect(extractODataFieldTokens("contains(wmkf_abstract,'O''Connor mentions akoya_name')", 'filter'))
      .toEqual(['wmkf_abstract']);
  });

  test('tokenizer excludes select expand subtrees from base-table fields', () => {
    expect(extractODataFieldTokens('akoya_requestnum,primarycontactid($select=fullname,emailaddress1)', 'select'))
      .toEqual(['akoya_requestnum']);
  });

  test('tokenizer extracts ContainValues PropertyName without namespace false tokens', () => {
    expect(extractODataFieldTokens("Microsoft.Dynamics.CRM.ContainValues(PropertyName='wmkf_programareaserved_research',PropertyValues=['707510017'])", 'filter'))
      .toEqual(['wmkf_programareaserved_research']);
  });

  test('tokenizer ignores orderby suffixes', () => {
    expect(extractODataFieldTokens('createdon desc', 'orderby')).toEqual(['createdon']);
  });

  test('tokenizer skips lambda aliases and nested nav paths', () => {
    expect(extractODataFieldTokens("x/any(c:c/fullname eq 'X')", 'filter')).toEqual([]);
  });

  test('rejects unknown fields with closest visible suggestions', async () => {
    const result = await validateODataCall('query_records', {
      table_name: 'akoya_request',
      select: 'akoya_name',
      filter: 'statecode eq 0',
    }, ctx());

    expect(result.reject).toContain('Field "akoya_name" does not exist on akoya_request');
    expect(result.reject).toContain('akoya_title');
  });

  test('rejects unknown entity names with known entity list', async () => {
    const result = await validateODataCall('query_records', {
      table_name: 'akoya_proposal',
      select: 'akoya_requestnum',
    }, ctx());

    expect(result.reject).toContain('Unknown table_name "akoya_proposal"');
    expect(result.reject).toContain('akoya_request');
  });

  test('denies restricted fields in filters and does not suggest restricted names', async () => {
    const result = await validateODataCall('query_records', {
      table_name: 'akoya_request',
      filter: "wmkf_secret eq 'x'",
    }, ctx({
      restrictions: [{ table_name: 'akoya_request', field_name: 'wmkf_secret' }],
    }));

    expect(result.reject).toContain('DENIED');
    expect(result.reject).toContain('wmkf_secret');

    const typo = await validateODataCall('query_records', {
      table_name: 'akoya_request',
      select: 'wmkf_sekret',
    }, ctx({
      restrictions: [{ table_name: 'akoya_request', field_name: 'wmkf_secret' }],
    }));
    expect(typo.reject).not.toContain('wmkf_secret');
  });

  test('rejects request number compared to lookup GUID field', async () => {
    const result = await validateODataCall('query_records', {
      table_name: 'akoya_request',
      filter: "_regardingobjectid_value eq '1002051'",
    }, ctx());

    expect(result.reject).toContain('needs a GUID, not request number "1002051"');
  });

  test('rejects get_entity request number on GUID-only paths', async () => {
    const result = await validateODataCall('get_entity', {
      type: 'file',
      identifier: '1002508',
    }, ctx());

    expect(result.reject).toContain('looks like a request number');
  });

  test('rejects unsupported date functions, formatted filters, contains on lookup, and subqueries', async () => {
    await expect(validateODataCall('query_records', {
      table_name: 'akoya_request',
      filter: 'year(akoya_submitdate) eq 2026',
    }, ctx())).resolves.toMatchObject({ reject: expect.stringContaining('Use an explicit date range') });

    await expect(validateODataCall('query_records', {
      table_name: 'akoya_request',
      filter: "_regardingobjectid_value_formatted eq 'Request'",
    }, ctx())).resolves.toMatchObject({ reject: expect.stringContaining('Do not filter on formatted') });

    await expect(validateODataCall('query_records', {
      table_name: 'akoya_request',
      filter: "contains(_regardingobjectid_value,'abc')",
    }, ctx())).resolves.toMatchObject({ reject: expect.stringContaining('contains() cannot be used on lookup') });

    await expect(validateODataCall('query_records', {
      table_name: 'akoya_request',
      filter: 'akoya_requestid in (select id from x)',
    }, ctx())).resolves.toMatchObject({ reject: expect.stringContaining('subqueries') });
  });

  test('rejects bare lookup nav field in select with _value hint', async () => {
    const result = await validateODataCall('query_records', {
      table_name: 'akoya_request',
      select: 'wmkf_potentialreviewer1',
    }, ctx());

    expect(result.reject).toContain('_wmkf_potentialreviewer1_value');
  });

  test('validates count_records, export_csv, and aggregate model-supplied OData', async () => {
    await expect(validateODataCall('count_records', {
      table_name: 'akoya_request',
      filter: 'akoya_requestnumber eq 1002051',
    }, ctx())).resolves.toMatchObject({ reject: expect.stringContaining('akoya_requestnumber') });

    await expect(validateODataCall('export_csv', {
      table_name: 'akoya_request',
      select: 'akoya_requestnum',
      orderby: 'akoya_grant desc',
    }, ctx())).resolves.toMatchObject({ reject: expect.stringContaining('akoya_grant') });

    await expect(validateODataCall('aggregate', {
      table_name: 'akoya_request',
      field: 'akoya_grant',
      operation: 'sum',
      group_by: 'akoya_fiscalyear',
    }, ctx())).resolves.toMatchObject({ reject: expect.stringContaining('akoya_grant') });
  });
});
