/**
 * Unit tests for the Stage 2 adapter core toolkit
 * (lib/dataverse/core/{odata,entity-registry,errors}.js).
 *
 * @jest-environment node
 */

import * as odata from '../../lib/dataverse/core/odata.js';
import {
  entitySet,
  isKnownEntitySet,
  selectFields,
} from '../../lib/dataverse/core/entity-registry.js';
import {
  adapterError,
  DATAVERSE_RECORD_NOT_FOUND_CODE,
  isDataverseRecordNotFound,
} from '../../lib/dataverse/core/errors.js';

const VALID_GUID = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';

describe('odata.escape', () => {
  test('doubles single quotes (OData literal escaping, not backslash)', () => {
    expect(odata.escape("O'Brien")).toBe("O''Brien");
    expect(odata.escape("a'b'c")).toBe("a''b''c");
  });
  test('leaves quote-free strings unchanged', () => {
    expect(odata.escape('plain')).toBe('plain');
  });
  test('coerces non-strings via String() before escaping', () => {
    expect(odata.escape(42)).toBe('42');
    expect(odata.escape(null)).toBe('null');
  });
});

describe('odata.eq / eqRaw', () => {
  test('eq quotes and escapes', () => {
    expect(odata.eq('emailaddress1', "a@b.org")).toBe("emailaddress1 eq 'a@b.org'");
    expect(odata.eq('wmkf_name', "O'Brien")).toBe("wmkf_name eq 'O''Brien'");
  });
  test('eqRaw interpolates without quoting (numbers/null/lookups)', () => {
    expect(odata.eqRaw('wmkf_selected', true)).toBe('wmkf_selected eq true');
    expect(odata.eqRaw('wmkf_applicantdisposition', null)).toBe('wmkf_applicantdisposition eq null');
    expect(odata.eqRaw('_wmkf_request_value', VALID_GUID)).toBe(`_wmkf_request_value eq ${VALID_GUID}`);
  });
});

describe('odata.eqGuid — GUID rejection at the filter boundary', () => {
  test('valid GUID interpolates raw', () => {
    expect(odata.eqGuid('_wmkf_request_value', VALID_GUID)).toBe(`_wmkf_request_value eq ${VALID_GUID}`);
  });
  test('rejects a non-GUID (filter-injection guard)', () => {
    expect(() => odata.eqGuid('_wmkf_request_value', "x' or '1' eq '1")).toThrow(/must be a GUID/);
    expect(() => odata.eqGuid('_wmkf_request_value', 'not-a-guid')).toThrow(/must be a GUID/);
    expect(() => odata.eqGuid('_wmkf_request_value', undefined)).toThrow(/must be a GUID/);
  });
  test('accepts a trimmed GUID (matches isGuid semantics)', () => {
    expect(odata.eqGuid('id', `  ${VALID_GUID}  `)).toBe(`id eq   ${VALID_GUID}  `);
  });
});

describe('odata.startsWith / contains', () => {
  test('startsWith quotes and escapes', () => {
    expect(odata.startsWith('firstname', "Jo")).toBe("startswith(firstname,'Jo')");
    expect(odata.startsWith('lastname', "O'H")).toBe("startswith(lastname,'O''H')");
  });
  test('contains quotes and escapes', () => {
    expect(odata.contains('fullname', 'Song')).toBe("contains(fullname,'Song')");
  });
});

describe('odata.and / or', () => {
  test('and joins with " and " and adds no parens', () => {
    expect(odata.and(['a eq 1', 'b eq 2'])).toBe('a eq 1 and b eq 2');
    expect(odata.and(['solo eq 1'])).toBe('solo eq 1');
  });
  test('or joins with " or "', () => {
    expect(odata.or(['a eq 1', 'b eq 2'])).toBe('a eq 1 or b eq 2');
  });
});

describe('odata.select', () => {
  test('joins an array with commas (identical to list.join(","))', () => {
    expect(odata.select(['contactid', 'firstname', 'lastname'])).toBe('contactid,firstname,lastname');
  });
  test('passes a string through unchanged', () => {
    expect(odata.select('contactid,firstname')).toBe('contactid,firstname');
  });
});

describe('entity-registry.entitySet — never guess', () => {
  test('returns a known census entity-set name unchanged', () => {
    expect(entitySet('contacts')).toBe('contacts');
    expect(entitySet('wmkf_potentialreviewerses')).toBe('wmkf_potentialreviewerses');
    expect(entitySet('wmkf_appreviewersuggestions')).toBe('wmkf_appreviewersuggestions');
    expect(entitySet('akoya_requests')).toBe('akoya_requests');
    expect(entitySet('wmkf_ai_prompts')).toBe('wmkf_ai_prompts');
  });
  test('throws on a guessed / unknown name (the S328 404 incident)', () => {
    expect(() => entitySet('wmkf_prompts')).toThrow(/unknown entity set/);
    expect(() => entitySet('wmkf_aiprompts')).toThrow(/unknown entity set/);
    expect(() => entitySet('contact')).toThrow(/never guess/);
  });
  test('pseudo-buckets from the census are NOT entity sets', () => {
    expect(() => entitySet('non-entity-transport')).toThrow();
    expect(() => entitySet('unresolved')).toThrow();
    expect(() => entitySet('changeset-unresolved')).toThrow();
  });
  test('isKnownEntitySet mirrors the throw boundary', () => {
    expect(isKnownEntitySet('contacts')).toBe(true);
    expect(isKnownEntitySet('wmkf_prompts')).toBe(false);
  });
});

describe('entity-registry.selectFields', () => {
  test('contacts primary select is the exact field list', () => {
    expect(selectFields('contacts')).toEqual([
      'contactid',
      'firstname',
      'lastname',
      'fullname',
      'emailaddress1',
      'wmkf_orcid',
      'statecode',
    ]);
  });
  test('returns a fresh copy each call (mutation isolation)', () => {
    const a = selectFields('contacts');
    const b = selectFields('contacts');
    expect(a).not.toBe(b);
    a.push('injected');
    expect(selectFields('contacts')).not.toContain('injected');
  });
  test('throws when no primary select is registered for an entity', () => {
    expect(() => selectFields('systemusers')).toThrow(/no primary SELECT/);
  });
});

describe('errors.adapterError', () => {
  test('attaches code/status/details when provided', () => {
    const err = adapterError('nope', { code: 'x_conflict', status: 409, details: { a: 1 } });
    expect(err).toBeInstanceOf(Error);
    expect(err.message).toBe('nope');
    expect(err.code).toBe('x_conflict');
    expect(err.status).toBe(409);
    expect(err.details).toEqual({ a: 1 });
  });
  test('omits fields not provided (no undefined keys leak)', () => {
    const err = adapterError('bare');
    expect(err.message).toBe('bare');
    expect('code' in err).toBe(false);
    expect('status' in err).toBe(false);
    expect('details' in err).toBe(false);
  });
});

describe('errors.isDataverseRecordNotFound', () => {
  test('accepts only the structured Dataverse ObjectDoesNotExist 404', () => {
    expect(isDataverseRecordNotFound({
      serviceName: 'dataverse',
      status: 404,
      dataverseCode: DATAVERSE_RECORD_NOT_FOUND_CODE,
    })).toBe(true);
  });

  test.each([
    [{ serviceName: 'dataverse', status: 404, dataverseCode: '0x8006088a' }, 'bad entity-set segment'],
    [{ serviceName: 'dataverse', status: 404 }, 'unstructured 404'],
    [{ serviceName: 'graph', status: 404, dataverseCode: DATAVERSE_RECORD_NOT_FOUND_CODE }, 'wrong service'],
    [{ serviceName: 'dataverse', status: 503, dataverseCode: DATAVERSE_RECORD_NOT_FOUND_CODE }, 'wrong status'],
  ])('rejects %s (%s)', (error) => {
    expect(isDataverseRecordNotFound(error)).toBe(false);
  });
});
