import {
  buildAccountLabelIndex,
  classifyContactAccountTargets,
  collectAffiliationEvidence,
  normalizeInstitution,
} from '../../scripts/lib/reviewer-contact-account-link-report.mjs';

describe('reviewer Contact → Account report helpers', () => {
  test('normalizes only punctuation, case, Unicode form, and whitespace', () => {
    expect(normalizeInstitution('  Florida  International University, '))
      .toBe('florida international university');
    expect(normalizeInstitution('UCLA')).toBe('ucla');
    expect(normalizeInstitution('UCLA')).not.toBe(normalizeInstitution('University of California Los Angeles'));
  });

  test('indexes account name and known CRM label fields without duplicating an account target', () => {
    const index = buildAccountLabelIndex([{
      accountid: 'account-1',
      name: 'The Regents of Example University',
      akoya_aka: 'Example University',
      wmkf_legalname: 'The Regents of Example University',
      statecode: 0,
    }]);
    const target = [...index.get('the regents of example university').values()];
    expect(target).toHaveLength(1);
    expect(target[0].matchedLabels).toEqual([
      { field: 'name', value: 'The Regents of Example University' },
      { field: 'legal_name', value: 'The Regents of Example University' },
    ]);
    expect([...index.get('example university').values()][0].accountId).toBe('account-1');
  });

  test('deduplicates affiliation values while retaining all provenance', () => {
    const evidence = collectAffiliationEvidence({
      reviewers: [{
        wmkf_potentialreviewersid: 'reviewer-1',
        wmkf_primaryaffiliation: 'Florida International University',
        wmkf_organizationname: 'Florida International University',
      }],
      suggestions: [{
        wmkf_appreviewersuggestionid: 'suggestion-1',
        _wmkf_potentialreviewer_value: 'reviewer-1',
        wmkf_revieweraffiliation: 'Florida International University',
      }],
    });
    expect(evidence).toHaveLength(1);
    expect(evidence[0].sources.map((source) => source.source)).toEqual([
      'accepted_suggestion',
      'reviewer_primary_affiliation',
      'reviewer_organization',
    ]);
  });

  test('classifies one Account reached through multiple labels as one unique target', () => {
    const index = buildAccountLabelIndex([{
      accountid: 'account-1',
      name: 'Florida International University',
      akoya_aka: 'FIU',
      statecode: 0,
    }]);
    const evidence = [
      { value: 'Florida International University', normalized: 'florida international university' },
      { value: 'FIU', normalized: 'fiu' },
    ];
    const result = classifyContactAccountTargets(evidence, index);
    expect(result.status).toBe('unique_exact_target');
    expect(result.targets).toHaveLength(1);
    expect(result.targets[0].affiliations).toEqual(['Florida International University', 'FIU']);
  });

  test('surfaces duplicate Account targets rather than choosing one', () => {
    const index = buildAccountLabelIndex([
      { accountid: 'account-1', name: 'Example University', statecode: 0 },
      { accountid: 'account-2', name: 'Example University', statecode: 0 },
    ]);
    const result = classifyContactAccountTargets(
      [{ value: 'Example University', normalized: 'example university' }],
      index,
    );
    expect(result.status).toBe('ambiguous_exact_targets');
    expect(result.targets.map((target) => target.accountId)).toEqual(['account-1', 'account-2']);
  });
});
