/**
 * Grantee document assembly — the canonical model for chunk-8 outputs. Covers
 * the pure helpers (joinNames, formatAwardAmount, formatLocation) and the
 * assembleGranteeDocument reads: field identity (PI from projectleader, co-PIs
 * from fetchCoPIs), amount preference (akoya_grant ?? originalgrantamount, never
 * akoya_request), body source preference (approved ?? formatted), the
 * includeImageRef auth boundary, fail-soft account read, and null-on-missing.
 *
 * @jest-environment jsdom
 *
 * jsdom (project default) because the assembly service transitively imports the
 * grantee-markdown renderer, whose DOMPurify needs a `window`; under jsdom it is
 * found directly instead of requiring jsdom at runtime (Jest CJS-loader caveat).
 */
jest.mock('../../lib/services/dynamics-service', () => ({
  DynamicsService: { getRecord: jest.fn() },
}));
jest.mock('../../lib/services/proposal-participants', () => ({
  fetchCoPIs: jest.fn(),
}));

import { DynamicsService } from '../../lib/services/dynamics-service';
import { fetchCoPIs } from '../../lib/services/proposal-participants';
import {
  assembleGranteeDocument,
  joinNames,
  formatAwardAmount,
  formatLocation,
} from '../../lib/services/grantee-document-assembly';

describe('joinNames', () => {
  test('0/1/2/3 name joins', () => {
    expect(joinNames([])).toBeNull();
    expect(joinNames(['A'])).toBe('A');
    expect(joinNames(['A', 'B'])).toBe('A and B');
    expect(joinNames(['A', 'B', 'C'])).toBe('A, B, and C');
  });
  test('drops blanks/whitespace', () => {
    expect(joinNames(['A', '', '  ', 'B'])).toBe('A and B');
  });
});

describe('formatAwardAmount', () => {
  test('full-number USD, no cents', () => {
    expect(formatAwardAmount(1200000)).toBe('$1,200,000');
    expect(formatAwardAmount('1200000')).toBe('$1,200,000');
    expect(formatAwardAmount(0)).toBe('$0');
  });
  test('non-numeric → null', () => {
    expect(formatAwardAmount(null)).toBeNull();
    expect(formatAwardAmount('')).toBeNull();
    expect(formatAwardAmount('abc')).toBeNull();
  });
});

describe('formatLocation', () => {
  test('city + state, or whichever is present', () => {
    expect(formatLocation('Corvallis', 'OR')).toBe('Corvallis, OR');
    expect(formatLocation('Corvallis', '')).toBe('Corvallis');
    expect(formatLocation('', 'OR')).toBe('OR');
    expect(formatLocation('', '')).toBeNull();
  });
});

describe('assembleGranteeDocument', () => {
  const REQUEST = {
    akoya_requestid: 'req-guid',
    akoya_requestnum: '1003100',
    akoya_title: 'Original applicant title',
    wmkf_wmkfprojectdescription: 'To determine whether marine viruses store iron',
    wmkf_abstractapproved: 'Approved abstract body.',
    wmkf_abstractformatted: 'AI formatted abstract body.',
    wmkf_granteeimagecaption: 'A marine virus',
    wmkf_granteeimagefileref: 'sites/x/img.jpg',
    _wmkf_projectleader_value: 'pi-guid',
    _wmkf_projectleader_value_formatted: 'Kristen Buck',
    akoya_grant: 1200000,
    akoya_originalgrantamount: 999999,
    _akoya_applicantid_value: 'acct-guid',
    _akoya_applicantid_value_formatted: 'Oregon State University (annotation)',
  };
  const ACCOUNT = { name: 'Oregon State University', address1_city: 'Corvallis', address1_stateorprovince: 'OR' };

  beforeEach(() => {
    DynamicsService.getRecord.mockReset();
    fetchCoPIs.mockReset();
    fetchCoPIs.mockResolvedValue(['Mya Breitbart']);
  });

  function wireReads({ request = REQUEST, account = ACCOUNT } = {}) {
    DynamicsService.getRecord.mockImplementation((entitySet) => {
      if (entitySet === 'akoya_requests') return Promise.resolve(request);
      if (entitySet === 'accounts') return account ? Promise.resolve(account) : Promise.reject(new Error('404'));
      return Promise.reject(new Error(`unexpected entitySet ${entitySet}`));
    });
  }

  test('assembles the canonical model', async () => {
    wireReads();
    const m = await assembleGranteeDocument('req-guid');
    expect(m.institution).toBe('Oregon State University');
    expect(m.location).toBe('Corvallis, OR');
    expect(m.pi).toBe('Kristen Buck');
    expect(m.coPIs).toEqual(['Mya Breitbart']);
    expect(m.names).toBe('Kristen Buck and Mya Breitbart');
    expect(m.amount).toBe(1200000);
    expect(m.amountFormatted).toBe('$1,200,000');
    expect(m.editedTitle).toBe('To determine whether marine viruses store iron');
    expect(m.bodySource).toBe('approved');
    expect(m.bodyHtml).toContain('<p>Approved abstract body.</p>');
    expect(m.hasImage).toBe(true);
  });

  test('amount prefers akoya_grant over originalgrantamount', async () => {
    wireReads();
    const m = await assembleGranteeDocument('req-guid');
    expect(m.amount).toBe(1200000);
  });

  test('amount falls back to originalgrantamount when grant is null', async () => {
    wireReads({ request: { ...REQUEST, akoya_grant: null } });
    const m = await assembleGranteeDocument('req-guid');
    expect(m.amount).toBe(999999);
    expect(m.amountFormatted).toBe('$999,999');
  });

  test('body falls back to formatted when approved is empty', async () => {
    wireReads({ request: { ...REQUEST, wmkf_abstractapproved: '   ' } });
    const m = await assembleGranteeDocument('req-guid');
    expect(m.bodySource).toBe('formatted');
    expect(m.bodyHtml).toContain('AI formatted abstract body.');
  });

  test('imageFileRef is withheld by default, exposed only with includeImageRef', async () => {
    wireReads();
    const ext = await assembleGranteeDocument('req-guid');
    expect(ext.imageFileRef).toBeUndefined();
    expect(ext.hasImage).toBe(true);

    const staff = await assembleGranteeDocument('req-guid', { includeImageRef: true });
    expect(staff.imageFileRef).toBe('sites/x/img.jpg');
  });

  test('fail-soft account read: keeps annotation name, null location', async () => {
    wireReads({ account: null });
    const m = await assembleGranteeDocument('req-guid');
    expect(m.institution).toBe('Oregon State University (annotation)');
    expect(m.location).toBeNull();
  });

  test('missing request → null', async () => {
    DynamicsService.getRecord.mockResolvedValue(null);
    expect(await assembleGranteeDocument('nope')).toBeNull();
  });

  test('getRecord throwing on the request → null', async () => {
    DynamicsService.getRecord.mockRejectedValue(new Error('boom'));
    expect(await assembleGranteeDocument('req-guid')).toBeNull();
  });

  test('no requestId → null without any read', async () => {
    expect(await assembleGranteeDocument('')).toBeNull();
    expect(DynamicsService.getRecord).not.toHaveBeenCalled();
  });
});
