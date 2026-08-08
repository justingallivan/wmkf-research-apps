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
  // A SECOND Guid-typed column of each shape, so a same-type comparison
  // (Guid column vs Guid column) can be distinguished from a Guid column
  // compared to a literal or to a column of another type.
  { logicalName: 'wmkf_secondaryuniqueid', type: 'Uniqueidentifier' },
  { logicalName: 'wmkf_secondlookup', type: 'Lookup' },
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

  // The alias is an Edm.Guid computed property. OData compares Edm.Guid to an
  // UNQUOTED literal; a quoted GUID is an Edm.String operand and does not match
  // the property's type.
  test('accepts the alias compared to an unquoted GUID and rejects the quoted form', async () => {
    await expect(validateODataCall('query_records', {
      table_name: 'akoya_request',
      filter: `_akoya_applicantid_value eq ${GUID}`,
    }, ctx())).resolves.toEqual({ ok: true });

    const quoted = await validateODataCall('query_records', {
      table_name: 'akoya_request',
      filter: `_akoya_applicantid_value eq '${GUID}'`,
    }, ctx());
    expect(quoted.reject).toMatch(/UNQUOTED GUID/);
    expect(quoted.reject).toContain('_akoya_applicantid_value');
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
    // A quoted junk value is not a valid Edm.Guid operand either.
    const quotedJunk = await validateODataCall('query_records', {
      table_name: 'akoya_request',
      filter: "_akoya_applicantid_value eq 'not-a-guid'",
    }, ctx());
    expect(quotedJunk.reject).toMatch(/UNQUOTED GUID/);

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

  test('a digit-leading GUID is not mistaken for a request number', async () => {
    // `\d{5,7}` would otherwise swallow the first 7 digits of
    // 12345678-aaaa-... and reject a perfectly valid filter. The guard was dead
    // in production before aliases entered attrNames, so this false positive
    // only becomes reachable with this change.
    await expect(validateODataCall('query_records', {
      table_name: 'akoya_request',
      filter: '_akoya_applicantid_value eq 12345678-aaaa-bbbb-cccc-121212121212',
    }, ctx())).resolves.toEqual({ ok: true });

    // An 8-digit integer is not a 7-digit request number — so the request-number
    // hint must not fire — but it is not an Edm.Guid literal either.
    const integer = await validateODataCall('query_records', {
      table_name: 'akoya_request',
      filter: '_akoya_applicantid_value eq 12345678',
    }, ctx());
    expect(integer.reject).toMatch(/UNQUOTED GUID/);
    expect(integer.reject).not.toMatch(/request number/i);
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
    expect(result.reject).toContain('_akoya_applicantid_value');
    expect(result.reject).toMatch(/\$expand/);
    // The navigation property name comes from relationship metadata, which this
    // validator does not fetch — the message must not prescribe the bare name.
    expect(result.reject).not.toMatch(/use\s+"?akoya_applicantid"?\s+in\s+\$expand/i);
    expect(result.reject).toMatch(/do not guess/i);
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

  // ─── Finding 1: restriction checking across navigation paths and nested
  // $expand options. The general tokenizer drops any token containing "/", so a
  // restriction on the bare lookup was bypassed by filtering its navigation
  // path. Restriction checking needs its own walk that keeps the BASE segment.
  describe('restriction walk over navigation paths and nested $expand', () => {
    const hidden = [{ table_name: 'akoya_request', field_name: 'wmkf_hiddenlink' }];
    const hiddenAlias = [{ table_name: 'akoya_request', field_name: '_wmkf_hiddenlink_value' }];

    test('denies a restricted lookup used as a navigation path base in $filter', async () => {
      for (const restrictions of [hidden, hiddenAlias]) {
        const result = await validateODataCall('query_records', {
          table_name: 'akoya_request',
          select: 'akoya_requestnum',
          filter: "wmkf_hiddenlink/name eq 'Secret Org'",
        }, ctx({ restrictions }));
        expect(result.reject).toContain('DENIED');
        expect(result.reject).toContain('wmkf_hiddenlink');
      }
    });

    test('denies a restricted lookup path base in $orderby, $select and aggregate group_by', async () => {
      const cases = [
        ['query_records', { table_name: 'akoya_request', orderby: 'wmkf_hiddenlink/name asc' }],
        ['query_records', { table_name: 'akoya_request', select: 'akoya_requestnum,wmkf_hiddenlink/name' }],
        ['aggregate', {
          table_name: 'akoya_request',
          field: 'akoya_requestnum',
          operation: 'countdistinct',
          group_by: 'wmkf_hiddenlink/name',
        }],
      ];
      for (const [tool, input] of cases) {
        const result = await validateODataCall(tool, input, ctx({ restrictions: hidden }));
        expect(result.reject).toContain('DENIED');
      }
    });

    test('an unrestricted navigation path is still accepted', async () => {
      await expect(validateODataCall('query_records', {
        table_name: 'akoya_request',
        select: 'akoya_requestnum',
        filter: "akoya_applicantid/name eq 'Public Org'",
      }, ctx())).resolves.toEqual({ ok: true });
    });

    // A PLAIN $expand returns the related entity's DEFAULT field set, so it
    // leaks a restricted column on the expanded table exactly like
    // `$expand=nav($select=<restricted>)` does. Nested $orderby/$top/$expand
    // read that table too. Until relationship metadata resolves the target,
    // every non-empty model-supplied $expand fails closed.
    test('rejects EVERY $expand shape fail-closed whenever a field restriction exists', async () => {
      const restrictions = [{ table_name: 'account', field_name: 'wmkf_secret' }];
      for (const expand of [
        'akoya_applicantid',
        'akoya_applicantid($select=name)',
        "akoya_applicantid($filter=name eq 'Secret Org')",
        'akoya_applicantid($orderby=name desc)',
        'akoya_applicantid($top=5)',
        'akoya_applicantid($expand=parentaccountid)',
        'akoya_applicantid,ownerid',
      ]) {
        const result = await validateODataCall('query_records', {
          table_name: 'akoya_request',
          select: 'akoya_requestnum',
          expand,
        }, ctx({ restrictions }));
        expect(result.reject).toContain('DENIED');
        // The expanded target table cannot be resolved here, so the message may
        // not name a restricted field or table.
        expect(result.reject).not.toContain('wmkf_secret');
        expect(result.reject).not.toContain('account');
        // Nor may it prescribe a navigation property spelling.
        expect(result.reject).not.toContain('akoya_applicantid');
      }
    });

    test('every $expand shape stays allowed when no field restriction exists', async () => {
      // No restrictions at all, and a TABLE-level restriction (field_name null),
      // which carries no field scope to fail closed over.
      for (const restrictions of [[], [{ table_name: 'akoya_request', field_name: null }]]) {
        for (const expand of [
          'akoya_applicantid',
          'akoya_applicantid($select=name)',
          'akoya_applicantid($orderby=name desc)',
          'akoya_applicantid,ownerid',
        ]) {
          await expect(validateODataCall('query_records', {
            table_name: 'akoya_request',
            select: 'akoya_requestnum',
            expand,
          }, ctx({ restrictions }))).resolves.toEqual({ ok: true });
        }
      }
    });

    // The blanket $expand denial is the FALLBACK for an unresolvable target. A
    // restriction on the navigation token the model actually typed must still be
    // answered by the restriction walk, which names that spelling back.
    test('a restricted $expand token is still denied by name, not by the blanket rule', async () => {
      for (const spelling of ['wmkf_hiddenlink', '_wmkf_hiddenlink_value']) {
        const result = await validateODataCall('query_records', {
          table_name: 'akoya_request',
          expand: spelling,
        }, ctx({ restrictions: hidden }));
        expect(result.reject).toContain('DENIED');
        expect(result.reject).toContain(spelling);
      }
    });
  });

  // ─── Finding 2: Edm.Guid literal typing ───
  describe('Edm.Guid literal typing on lookup aliases and Uniqueidentifier columns', () => {
    const guidColumns = ['_akoya_applicantid_value', '_customerid_value', '_ownerid_value', 'akoya_requestid'];

    test('accepts an unquoted canonical GUID and null on every GUID column', async () => {
      for (const field of guidColumns) {
        for (const filter of [`${field} eq ${GUID}`, `${field} ne ${GUID}`, `${field} eq null`, `${field} ne null`]) {
          await expect(validateODataCall('query_records', {
            table_name: 'akoya_request',
            filter,
          }, ctx())).resolves.toEqual({ ok: true });
        }
      }
    });

    test('rejects quoted GUIDs, quoted junk and non-canonical numbers with one unquoted-GUID hint', async () => {
      for (const field of guidColumns) {
        for (const literal of [`'${GUID}'`, "'not-a-guid'", "'Secret Org'", '12345678', '0']) {
          const result = await validateODataCall('query_records', {
            table_name: 'akoya_request',
            filter: `${field} eq ${literal}`,
          }, ctx());
          expect(result.reject).toMatch(/UNQUOTED GUID/);
          expect(result.reject).toContain(field);
        }
      }
    });

    test('keeps the specific request-number guidance for 5-7 digit values', async () => {
      const result = await validateODataCall('query_records', {
        table_name: 'akoya_request',
        filter: "_akoya_applicantid_value eq '1002051'",
      }, ctx());
      expect(result.reject).toContain('needs a GUID, not request number "1002051"');
    });

    test('does not read a GUID column name out of a string literal', async () => {
      await expect(validateODataCall('query_records', {
        table_name: 'akoya_request',
        filter: "akoya_title eq '_akoya_applicantid_value eq nonsense'",
      }, ctx())).resolves.toEqual({ ok: true });
    });

    test('non-GUID columns are untouched by the literal rule', async () => {
      await expect(validateODataCall('query_records', {
        table_name: 'akoya_request',
        filter: "akoya_title eq 'Anything' and akoya_fiscalyear eq '2026'",
      }, ctx())).resolves.toEqual({ ok: true });
    });

    test('contains() on a lookup teaches an unquoted GUID, not a quoted one', async () => {
      for (const field of ['akoya_applicantid', '_akoya_applicantid_value']) {
        const result = await validateODataCall('query_records', {
          table_name: 'akoya_request',
          filter: `contains(${field},'abc')`,
        }, ctx());
        expect(result.reject).toContain('contains() cannot be used on lookup');
        expect(result.reject).toMatch(/UNQUOTED GUID/);
        expect(result.reject).not.toMatch(/eq '</);
      }
    });
  });

  // ─── Edm.Guid comparisons: OData grouping parentheses and operand symmetry.
  // `(a) eq b` is valid OData (grouping is precedence-only), and comparison
  // operands are symmetric for type checking, so a left-anchored regex reads
  // both as untyped and lets the invalid form through.
  describe('Edm.Guid comparisons across grouping parentheses and operand order', () => {
    const rejects = async (filter) => (await validateODataCall('query_records', {
      table_name: 'akoya_request',
      filter,
    }, ctx())).reject;

    test('rejects an invalid literal written on the LEFT of a Guid column', async () => {
      for (const filter of [
        "'not-guid' eq akoya_requestid",
        '12345678 ne akoya_requestid',
        `'${GUID}' eq _akoya_applicantid_value`,
        "'Secret Org' ne _customerid_value",
      ]) {
        const reject = await rejects(filter);
        expect(reject).toMatch(/UNQUOTED GUID/);
      }
    });

    test('rejects an invalid literal wrapped in OData grouping parentheses', async () => {
      for (const filter of [
        `(_akoya_applicantid_value) eq '${GUID}'`,
        `_akoya_applicantid_value eq ('${GUID}')`,
        "((akoya_requestid)) eq 'not-guid'",
        '(_akoya_applicantid_value) ne (12345678)',
        "('not-guid') eq (akoya_requestid)",
      ]) {
        const reject = await rejects(filter);
        expect(reject).toMatch(/UNQUOTED GUID/);
      }
    });

    test('accepts a valid Guid comparison in either orientation and through grouping', async () => {
      for (const filter of [
        `${GUID} eq _akoya_applicantid_value`,
        `(_akoya_applicantid_value) eq ${GUID}`,
        `_akoya_applicantid_value eq (${GUID})`,
        `((_akoya_applicantid_value)) ne ((${GUID}))`,
        'null eq _akoya_applicantid_value',
        '(akoya_requestid) ne null',
        `(_akoya_applicantid_value eq ${GUID}) and (akoya_requestid ne null)`,
        `(${GUID} eq _akoya_applicantid_value) or (akoya_requestid eq ${GUID})`,
      ]) {
        await expect(validateODataCall('query_records', {
          table_name: 'akoya_request',
          filter,
        }, ctx())).resolves.toEqual({ ok: true });
      }
    });

    test('keeps the specific request-number hint when the number is on the left', async () => {
      const reject = await rejects(`'1002051' eq _akoya_applicantid_value`);
      expect(reject).toContain('needs a GUID, not request number "1002051"');
    });

    test('a digit-leading canonical GUID is still accepted in either orientation', async () => {
      for (const filter of [
        '_akoya_applicantid_value eq 12345678-aaaa-bbbb-cccc-121212121212',
        '12345678-aaaa-bbbb-cccc-121212121212 eq _akoya_applicantid_value',
      ]) {
        await expect(validateODataCall('query_records', {
          table_name: 'akoya_request',
          filter,
        }, ctx())).resolves.toEqual({ ok: true });
      }
    });

    test('does not read a comparison out of a quoted string in either orientation', async () => {
      for (const filter of [
        "akoya_title eq '_akoya_applicantid_value eq nonsense'",
        "akoya_title eq 'nonsense eq _akoya_applicantid_value'",
        "akoya_title ne '(akoya_requestid) eq not-guid'",
      ]) {
        await expect(validateODataCall('query_records', {
          table_name: 'akoya_request',
          filter,
        }, ctx())).resolves.toEqual({ ok: true });
      }
    });
  });

  // ─── Same-type Guid column comparisons ───
  describe('Guid column compared to another column', () => {
    test('allows two Guid-typed columns, in either orientation and through grouping', async () => {
      for (const filter of [
        'akoya_requestid eq wmkf_secondaryuniqueid',
        'wmkf_secondaryuniqueid ne akoya_requestid',
        '_akoya_applicantid_value eq _wmkf_secondlookup_value',
        '(_akoya_applicantid_value) eq (_wmkf_secondlookup_value)',
        'akoya_requestid eq _akoya_applicantid_value',
      ]) {
        await expect(validateODataCall('query_records', {
          table_name: 'akoya_request',
          filter,
        }, ctx())).resolves.toEqual({ ok: true });
      }
    });

    test('rejects a Guid column compared to a known non-Guid column', async () => {
      for (const filter of [
        'akoya_requestid eq akoya_title',
        'akoya_requestnum ne _akoya_applicantid_value',
        '(akoya_requestid) eq (createdon)',
      ]) {
        const result = await validateODataCall('query_records', {
          table_name: 'akoya_request',
          filter,
        }, ctx());
        expect(result.reject).toMatch(/Edm\.Guid/);
        expect(result.reject).toMatch(/cannot be compared/i);
      }
    });

    test('a bare lookup operand keeps the alias hint instead of a type mismatch', async () => {
      const result = await validateODataCall('query_records', {
        table_name: 'akoya_request',
        filter: '_wmkf_secondlookup_value eq akoya_applicantid',
      }, ctx());
      expect(result.reject).toContain('_akoya_applicantid_value');
      expect(result.reject).not.toMatch(/cannot be compared/i);
    });
  });

  // ─── $expand names that AttributeMetadata proves are not navigation
  // properties. A scalar attribute and a navigation property cannot share a
  // name on the same entity type, and `_<name>_value` is a computed value
  // spelling that is never a navigation property.
  describe('$expand rejects provably non-navigation names', () => {
    const expandReject = async (expand) => (await validateODataCall('query_records', {
      table_name: 'akoya_request',
      select: 'akoya_requestnum',
      expand,
    }, ctx())).reject;

    test('rejects PartyList, Uniqueidentifier and scalar attribute names', async () => {
      for (const token of ['to', 'akoya_requestid', 'akoya_title', 'createdon', 'statecode']) {
        const reject = await expandReject(token);
        expect(reject).toContain(token);
        expect(reject).toMatch(/relationship metadata/i);
        expect(reject).toMatch(/do not guess/i);
      }
    });

    test('rejects fabricated alias-shaped names derived from non-lookup attributes', async () => {
      for (const token of ['_to_value', '_akoya_requestid_value', '_akoya_title_value']) {
        const reject = await expandReject(token);
        expect(reject).toContain(token);
        expect(reject).toMatch(/relationship metadata/i);
        expect(reject).toMatch(/do not guess/i);
      }
    });

    test('still rejects the computed lookup alias generically', async () => {
      for (const token of ['_akoya_applicantid_value', '_customerid_value', '_ownerid_value']) {
        const reject = await expandReject(token);
        expect(reject).toContain(token);
        expect(reject).toMatch(/relationship metadata/i);
      }
    });

    test('an unknown but plausible navigation name still passes through', async () => {
      for (const expand of [
        'akoya_applicantid',
        'primarycontactid',
        'akoya_Request_Emails',
        'akoya_applicantid($select=name)',
      ]) {
        await expect(validateODataCall('query_records', {
          table_name: 'akoya_request',
          select: 'akoya_requestnum',
          expand,
        }, ctx())).resolves.toEqual({ ok: true });
      }
    });
  });

  // ─── Finding 3: polymorphic $expand guidance ───
  test('$expand rejection never prescribes the bare name for polymorphic lookups', async () => {
    for (const [alias, bare] of [['_customerid_value', 'customerid'], ['_regardingobjectid_value', 'regardingobjectid']]) {
      const result = await validateODataCall('query_records', {
        table_name: 'akoya_request',
        expand: alias,
      }, ctx());
      expect(result.reject).toContain(alias);
      expect(result.reject).not.toMatch(new RegExp(`use\\s+"?${bare}"?\\s+in\\s+\\$expand`, 'i'));
      expect(result.reject).toMatch(/relationship metadata/i);
      expect(result.reject).toMatch(/do not guess/i);
    }
  });

  // ─── Finding 4: expression complements ───
  describe('complement matrix across select/filter/orderby/expand/field/group_by', () => {
    const inputFor = (kind, field) => {
      switch (kind) {
        case 'select': return ['query_records', { table_name: 'akoya_request', select: field }];
        case 'filter': return ['query_records', { table_name: 'akoya_request', filter: `${field} eq ${GUID}` }];
        case 'orderby': return ['query_records', { table_name: 'akoya_request', orderby: `${field} desc` }];
        case 'expand': return ['query_records', { table_name: 'akoya_request', expand: field }];
        case 'field': return ['aggregate', { table_name: 'akoya_request', field, operation: 'countdistinct' }];
        case 'group_by': return ['aggregate', {
          table_name: 'akoya_request',
          field: 'akoya_requestnum',
          operation: 'countdistinct',
          group_by: field,
        }];
        default: throw new Error(`unhandled kind ${kind}`);
      }
    };
    const run = (kind, field, overrides) => validateODataCall(...inputFor(kind, field), ctx(overrides));

    test.each([
      ['akoya_applicantid', '_akoya_applicantid_value'],
      ['customerid', '_customerid_value'],
      ['ownerid', '_ownerid_value'],
    ])('Lookup/Customer/Owner %s: bare and alias are fail-closed outside their own slot', async (bare, alias) => {
      // select/filter: the alias is the queryable spelling, the bare name is not.
      await expect(run('select', alias)).resolves.toEqual({ ok: true });
      await expect(run('filter', alias)).resolves.toEqual({ ok: true });
      expect((await run('select', bare)).reject).toContain(alias);
      expect((await run('filter', bare)).reject).toContain(alias);

      // orderby: neither spelling is sortable.
      for (const spelling of [bare, alias]) {
        const ordered = await run('orderby', spelling);
        expect(ordered.reject).toContain(spelling);
        expect(ordered.reject).toMatch(/\$orderby/);
      }

      // aggregate field / group_by: fail closed on both spellings.
      for (const kind of ['field', 'group_by']) {
        for (const spelling of [bare, alias]) {
          const aggregated = await run(kind, spelling);
          expect(aggregated.reject).toContain(spelling);
          expect(aggregated.reject).toMatch(/aggregate/i);
        }
      }

      // expand: the bare navigation passes through, the alias does not.
      await expect(run('expand', bare)).resolves.toEqual({ ok: true });
      expect((await run('expand', alias)).reject).toContain(alias);
    });

    test('PartyList is rejected everywhere it is not a scalar query property', async () => {
      for (const kind of ['select', 'filter', 'orderby', 'field', 'group_by']) {
        const result = await run(kind, 'to');
        expect(result.reject).toContain('"to"');
        expect(result.reject).toMatch(/PartyList/i);
        // Its navigation name is not derivable from AttributeMetadata either.
        expect(result.reject).not.toMatch(/\$expand/);
      }
      // The synthesized alias is still not a field.
      expect((await run('select', '_to_value')).reject).toContain('does not exist');
    });

    test('a Uniqueidentifier column stays bare and valid in every expression', async () => {
      for (const kind of ['select', 'orderby', 'field', 'group_by']) {
        await expect(run(kind, 'akoya_requestid')).resolves.toEqual({ ok: true });
      }
      await expect(run('filter', 'akoya_requestid')).resolves.toEqual({ ok: true });
    });

    test('a restriction denies both spellings in every expression, without leaking the complement', async () => {
      for (const restrictions of [
        [{ table_name: 'akoya_request', field_name: 'wmkf_hiddenlink' }],
        [{ table_name: 'akoya_request', field_name: '_wmkf_hiddenlink_value' }],
      ]) {
        for (const kind of ['select', 'filter', 'orderby', 'expand', 'field', 'group_by']) {
          for (const spelling of ['wmkf_hiddenlink', '_wmkf_hiddenlink_value']) {
            const result = await run(kind, spelling, { restrictions });
            expect(result.reject).toContain('DENIED');
            expect(result.reject).toContain(spelling);
          }
        }
      }
    });

    test('export_csv $orderby is validated on the same complement rules', async () => {
      const result = await validateODataCall('export_csv', {
        table_name: 'akoya_request',
        select: 'akoya_requestnum',
        orderby: 'akoya_applicantid desc',
      }, ctx());
      expect(result.reject).toContain('akoya_applicantid');
      expect(result.reject).toMatch(/\$orderby/);
    });
  });
});
