import { requestInstitution } from '../../shared/utils/institution';

describe('requestInstitution', () => {
  test('uses the formatted Applicant lookup and ignores the Bill.com organization-name field', () => {
    expect(requestInstitution({
      wmkf_organizationname: 'N/A',
      _akoya_applicantid_value_formatted: 'University of Texas Southwestern Medical Center',
    })).toBe('University of Texas Southwestern Medical Center');
    expect(requestInstitution({
      wmkf_organizationname: 'Some Real Org',
      _akoya_applicantid_value_formatted: 'Applicant Account',
    })).toBe('Applicant Account');
  });

  test('returns null when the applicant lookup is blank, even if the organization name is set', () => {
    expect(requestInstitution({ wmkf_organizationname: 'Org', _akoya_applicantid_value_formatted: '  ' })).toBeNull();
    expect(requestInstitution({ wmkf_organizationname: 'Org' })).toBeNull();
    expect(requestInstitution(null)).toBeNull();
  });
});
