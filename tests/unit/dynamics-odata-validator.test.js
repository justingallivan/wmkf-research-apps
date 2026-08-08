import { extractODataFieldTokens, validateODataCall } from '../../lib/services/dynamics-odata-validator';

const tableAnnotations = {
  akoya_request: { entitySet: 'akoya_requests' },
  account: { entitySet: 'accounts' },
};

// FIXTURE SHAPE — [ASSUMED], not captured from a live response.
//
// `getEntityAttributes` (lib/services/dynamics/schema.js) selects
// `LogicalName,DisplayName,AttributeType,...` off `EntityDefinitions/Attributes`
// and maps them 1:1, so every `logicalName` here is the BARE column logical
// name exactly as AttributeMetadata reports it. Dataverse never returns the
// `_<name>_value` computed alias as an AttributeMetadata row — that alias is a
// Web API computed property the validator must synthesize for
// Lookup / Customer / Owner columns.
//
// Basis: schema.js's $select + Microsoft's documented AttributeMetadata
// contract + the production 400 from request tq9j6-1786197256337-e64473f8bbd5
// (`akoya_applicantid eq '<guid>'` rejected by Dataverse). A live capture
// through a signed-in Preview `describe_table` is still outstanding; casing of
// AttributeType values is the one detail that would invalidate this fixture.
//
// The earlier fixture stored `_regardingobjectid_value` /
// `_wmkf_potentialreviewer1_value` as AttributeMetadata rows — a shape
// production never returns — which is why the lookup guards below passed for
// the wrong reason.
const attrs = [
  { logicalName: 'akoya_requestid', type: 'Uniqueidentifier' },
  { logicalName: 'akoya_requestnum', type: 'String' },
  { logicalName: 'akoya_title', type: 'String' },
  { logicalName: 'akoya_submitdate', type: 'DateTime' },
  { logicalName: 'akoya_fiscalyear', type: 'String' },
  { logicalName: 'createdon', type: 'DateTime' },
  { logicalName: 'statecode', type: 'State' },
  { logicalName: 'regardingobjectid', type: 'Lookup' },
  { logicalName: 'wmkf_potentialreviewer1', type: 'Lookup' },
  { logicalName: 'akoya_applicantid', type: 'Lookup' },
  { logicalName: 'customerid', type: 'Customer' },
  { logicalName: 'ownerid', type: 'Owner' },
  { logicalName: 'to', type: 'PartyList' },
  { logicalName: 'wmkf_abstract', type: 'Memo' },
  { logicalName: 'wmkf_programareaserved_research', type: 'MultiSelectPicklist' },
  { logicalName: 'wmkf_secret', type: 'String' },
  { logicalName: 'wmkf_hiddenlink', type: 'Lookup' },
];

const GUID = '3f2504e0-4f89-11d3-9a0c-0305e82c330c';

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

  // ─── Lookup computed-alias catalog (S-lookup-validator) ───

  test('fixture carries only bare AttributeMetadata logical names, never precomputed aliases', () => {
    const precomputed = attrs
      .map(a => a.logicalName)
      .filter(n => n.startsWith('_') && n.endsWith('_value'));
    expect(attrs.length).toBeGreaterThan(0);
    expect(precomputed).toEqual([]);
  });

  test('synthesizes the queryable alias for Lookup, Customer and Owner columns', async () => {
    for (const alias of ['_akoya_applicantid_value', '_customerid_value', '_ownerid_value']) {
      await expect(validateODataCall('query_records', {
        table_name: 'akoya_request',
        select: `akoya_requestnum,${alias}`,
        filter: `${alias} eq ${GUID}`,
      }, ctx())).resolves.toEqual({ ok: true });
    }
  });

  test('never synthesizes an alias for PartyList or Uniqueidentifier columns', async () => {
    const party = await validateODataCall('query_records', {
      table_name: 'akoya_request',
      filter: `_to_value eq ${GUID}`,
    }, ctx());
    expect(party.reject).toContain('Field "_to_value" does not exist on akoya_request');

    const pk = await validateODataCall('query_records', {
      table_name: 'akoya_request',
      select: '_akoya_requestid_value',
    }, ctx());
    expect(pk.reject).toContain('Field "_akoya_requestid_value" does not exist on akoya_request');
  });

  test('accepts the alias compared to a quoted or unquoted GUID', async () => {
    await expect(validateODataCall('query_records', {
      table_name: 'akoya_request',
      filter: `_akoya_applicantid_value eq ${GUID}`,
    }, ctx())).resolves.toEqual({ ok: true });

    await expect(validateODataCall('query_records', {
      table_name: 'akoya_request',
      filter: `_akoya_applicantid_value eq '${GUID}'`,
    }, ctx())).resolves.toEqual({ ok: true });
  });

  test('rejects the bare lookup compared to a quoted or unquoted GUID, pointing at the alias', async () => {
    for (const filter of [
      `akoya_applicantid eq '${GUID}'`,
      `akoya_applicantid eq ${GUID}`,
    ]) {
      const result = await validateODataCall('query_records', {
        table_name: 'akoya_request',
        filter,
      }, ctx());
      expect(result.reject).toContain('_akoya_applicantid_value');
      expect(result.reject).not.toContain('does not exist');
    }
  });

  test('GUID masking preserves offsets so lambda and namespace suppression survive', () => {
    expect(extractODataFieldTokens(`_akoya_applicantid_value eq ${GUID}`, 'filter'))
      .toEqual(['_akoya_applicantid_value']);
    expect(extractODataFieldTokens(`x/any(c:c/ownerid eq ${GUID})`, 'filter')).toEqual([]);
    expect(extractODataFieldTokens(
      `contains(wmkf_abstract,'a') and _regardingobjectid_value eq ${GUID} and createdon gt 2026-01-05T00:00:00Z`,
      'filter',
    )).toEqual(['wmkf_abstract', '_regardingobjectid_value', 'createdon']);
  });

  test('rejects a malformed unquoted GUID with an explicit GUID message', async () => {
    const result = await validateODataCall('query_records', {
      table_name: 'akoya_request',
      filter: '_akoya_applicantid_value eq 3f2504e0-4f89-11d3-9a0c-0305e82c330',
    }, ctx());
    expect(result.reject).toMatch(/not a valid GUID/i);
    expect(result.reject).toContain('3f2504e0-4f89-11d3-9a0c-0305e82c330');
    expect(result.reject).not.toContain('does not exist');
  });

  test('does not hide malformed GUID-like identifiers or malformed field names', async () => {
    // A quoted malformed value is an ordinary string comparison — unchanged.
    await expect(validateODataCall('query_records', {
      table_name: 'akoya_request',
      filter: "_akoya_applicantid_value eq 'not-a-guid'",
    }, ctx())).resolves.toEqual({ ok: true });

    // A malformed field name is still reported as a malformed field, not eaten
    // by the GUID mask.
    const badField = await validateODataCall('query_records', {
      table_name: 'akoya_request',
      filter: `_akoya_applicant_value eq ${GUID}`,
    }, ctx());
    expect(badField.reject).toContain('Field "_akoya_applicant_value" does not exist');
  });

  test('request-number-vs-GUID guard fires for Lookup, Customer and Owner aliases', async () => {
    for (const alias of ['_regardingobjectid_value', '_customerid_value', '_ownerid_value']) {
      const result = await validateODataCall('query_records', {
        table_name: 'akoya_request',
        filter: `${alias} eq '1002051'`,
      }, ctx());
      expect(result.reject).toContain('needs a GUID, not request number "1002051"');
    }
  });

  test('classifies contains() on a bare lookup as contains-on-lookup in one round', async () => {
    for (const field of ['akoya_applicantid', '_akoya_applicantid_value', 'ownerid', 'customerid']) {
      const result = await validateODataCall('query_records', {
        table_name: 'akoya_request',
        filter: `contains(${field},'abc')`,
      }, ctx());
      expect(result.reject).toContain('contains() cannot be used on lookup');
      expect(result.reject).toContain(field);
    }
  });

  test('restrictions are bidirectional: a bare restriction denies the alias spelling', async () => {
    const restrictions = [{ table_name: 'akoya_request', field_name: 'wmkf_hiddenlink' }];
    for (const spelling of ['wmkf_hiddenlink', '_wmkf_hiddenlink_value']) {
      const filtered = await validateODataCall('query_records', {
        table_name: 'akoya_request',
        filter: `${spelling} eq ${GUID}`,
      }, ctx({ restrictions }));
      expect(filtered.reject).toContain('DENIED');
      expect(filtered.reject).toContain(spelling);

      const selected = await validateODataCall('query_records', {
        table_name: 'akoya_request',
        select: spelling,
      }, ctx({ restrictions }));
      expect(selected.reject).toContain('DENIED');
    }
  });

  test('restrictions are bidirectional: an alias restriction denies the bare spelling', async () => {
    const restrictions = [{ table_name: 'akoya_request', field_name: '_wmkf_hiddenlink_value' }];
    for (const spelling of ['wmkf_hiddenlink', '_wmkf_hiddenlink_value']) {
      const result = await validateODataCall('query_records', {
        table_name: 'akoya_request',
        filter: `${spelling} eq ${GUID}`,
      }, ctx({ restrictions }));
      expect(result.reject).toContain('DENIED');
      expect(result.reject).toContain(spelling);
    }

    // Neither spelling may be offered as a suggestion either.
    const typo = await validateODataCall('query_records', {
      table_name: 'akoya_request',
      select: 'wmkf_hiddenlinkp',
    }, ctx({ restrictions }));
    expect(typo.reject).not.toContain('wmkf_hiddenlink,');
    expect(typo.reject).not.toContain('_wmkf_hiddenlink_value');
  });

  test('$expand accepts the bare navigation property and rejects the alias with a reverse hint', async () => {
    await expect(validateODataCall('query_records', {
      table_name: 'akoya_request',
      select: 'akoya_requestnum',
      expand: 'akoya_applicantid($select=name)',
    }, ctx())).resolves.toEqual({ ok: true });

    const result = await validateODataCall('query_records', {
      table_name: 'akoya_request',
      select: 'akoya_requestnum',
      expand: '_akoya_applicantid_value',
    }, ctx());
    expect(result.reject).toContain('akoya_applicantid');
    expect(result.reject).toMatch(/\$expand/);
  });

  test('$expand denies a restricted lookup under either spelling', async () => {
    const restrictions = [{ table_name: 'akoya_request', field_name: 'wmkf_hiddenlink' }];
    const result = await validateODataCall('query_records', {
      table_name: 'akoya_request',
      expand: 'wmkf_hiddenlink($select=name)',
    }, ctx({ restrictions }));
    expect(result.reject).toContain('DENIED');
  });

  test('rejects the computed lookup alias in $orderby, fail-closed', async () => {
    const result = await validateODataCall('query_records', {
      table_name: 'akoya_request',
      orderby: '_akoya_applicantid_value desc',
    }, ctx());
    expect(result.reject).toContain('_akoya_applicantid_value');
    expect(result.reject).toMatch(/\$orderby/);
  });

  test('non-lookup behavior is unchanged by the alias catalog', async () => {
    await expect(validateODataCall('query_records', {
      table_name: 'akoya_request',
      select: 'akoya_requestnum,akoya_title',
      filter: "akoya_title eq 'x' and createdon gt 2026-01-01T00:00:00Z",
      orderby: 'createdon desc',
    }, ctx())).resolves.toEqual({ ok: true });

    const bogus = await validateODataCall('query_records', {
      table_name: 'akoya_request',
      filter: "_akoya_title_value eq 'x'",
    }, ctx());
    expect(bogus.reject).toContain('does not exist on akoya_request');
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
