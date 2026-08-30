import {
  abbreviateState,
  formatMeetingDate,
  generatePreSiteVisitProposalCore,
  loadPreSiteVisitInputs,
  prepareGeneratedCore,
  promptContext,
} from '../../lib/services/pre-site-visit/proposal-core-service';
import { REQUIRED_SYSTEM_ASSERTIONS } from '../../shared/config/prompts/pre-site-visit-proposal-core';

const REQUEST_ID = '11111111-1111-4111-8111-111111111111';

function requestFixture(overrides = {}) {
  return {
    akoya_requestid: REQUEST_ID,
    akoya_requestnum: '1002379',
    akoya_title: 'A test project',
    wmkf_organizationname: 'Fallback University',
    _akoya_applicantid_value: '22222222-2222-4222-8222-222222222222',
    _akoya_applicantid_value_formatted: 'Formatted University',
    _wmkf_projectleader_value_formatted: 'Dr. Ada Principal',
    _akoya_programid_value_formatted: 'Medical Research',
    _wmkf_programdirector_value_formatted: 'Pat Director',
    wmkf_meetingdate: '2026-12-01',
    akoya_request: 900000,
    wmkf_invitedamount: 1000000,
    akoya_expenses: 3500000,
    akoya_begindate: '2027-01-01',
    akoya_enddate: '2029-12-31',
    ...overrides,
  };
}

// Eight program grants summing to the $9,150,000 rollup in the applicant fixture.
function programGrantRows() {
  const amounts = [1000000, 1000000, 1250000, 1000000, 1200000, 1500000, 1000000, 1200000];
  return amounts.map((amount, index) => ({
    akoya_requestid: `5555555${index}-5555-4555-8555-555555555555`,
    akoya_requestnum: `100${1990 + index}`,
    akoya_grant: amount,
    _wmkf_grantprogram_value: 'c247b11a-0000-4000-8000-000000000000',
    _wmkf_grantprogram_value_formatted: 'Research',
    akoya_decisiondate: index === 7 ? '2026-06-11T00:00:00Z' : `20${10 + index}-06-11T00:00:00Z`,
    wmkf_meetingdate: index === 7 ? '2026-06-01' : `20${10 + index}-06-01`,
    akoya_fiscalyear: index === 7 ? 'June 2026' : `June 20${10 + index}`,
    wmkf_wmkfprojectdescription: index === 7
      ? 'To develop chemical tools to restore the function of defective proteins.'
      : `To do project ${index}.`,
  }));
}

function dependencies(overrides = {}) {
  const proposalCore = {
    executiveSummary: 'Executive summary.',
    impactOverview: 'Impact overview.',
    methodologyOverview: 'Methodology overview.',
    personnelOverview: 'Personnel overview.',
    keckFundingRationale: 'Rationale.',
    backgroundAndImpact: 'Background and impact.',
    detailedMethodology: 'Detailed methodology.',
    personnelDetails: 'Personnel details.',
  };
  return {
    getRequest: jest.fn().mockResolvedValue(requestFixture()),
    getApplicant: jest.fn().mockResolvedValue({
      akoya_aka: 'Applicant U',
      name: 'Applicant University',
      address1_city: 'Atlanta',
      address1_stateorprovince: 'Georgia',
      wmkf_countofprogramgrants: 8,
      wmkf_sumofprogramgrants: 9150000,
    }),
    getProgramGrants: jest.fn().mockResolvedValue({ records: programGrantRows(), capped: false }),
    getCoPIs: jest.fn().mockResolvedValue(['Dr. First Co-PI', 'Dr. Second Co-PI']),
    getProposalNarrative: jest.fn().mockResolvedValue({
      filename: 'ProposalNarrative_1002379.pdf',
      text: 'Proposal narrative content '.repeat(20),
      siteId: 'site-id',
      driveId: 'drive-id',
      itemId: 'narrative-item',
      versionId: 'narrative-v1',
      contentHash: 'a'.repeat(64),
    }),
    getExecutorBudget: jest.fn().mockResolvedValue({
      kind: 'standing',
      maxTokensOverride: 32_768,
      timeoutMsOverride: 240_000,
    }),
    runPrompt: jest.fn().mockResolvedValue({
      parsed: { proposalCore },
      runId: '33333333-3333-4333-8333-333333333333',
      usage: { input_tokens: 100 },
      meta: { modelUsed: 'claude-test' },
    }),
    ...overrides,
  };
}

test('formats city/state and meeting date without local-time drift', () => {
  expect(abbreviateState('Georgia')).toBe('GA');
  expect(abbreviateState('ga')).toBe('GA');
  expect(formatMeetingDate('2026-12-01')).toBe('December 2026');
});

test('loads authoritative Dataverse fields and the exact Proposal Narrative', async () => {
  const deps = dependencies();
  const result = await loadPreSiteVisitInputs({ requestId: REQUEST_ID }, deps);

  expect(deps.getProposalNarrative).toHaveBeenCalledWith(REQUEST_ID, '1002379');
  expect(result.proposalNarrative).toMatchObject({
    filename: 'ProposalNarrative_1002379.pdf',
  });
  expect(result.context).toMatchObject({
    requestNumber: '1002379',
    projectTitle: 'A test project',
    applicantInstitution: 'Applicant U',
    projectPeriod: { startDate: '2027-01-01', endDate: '2029-12-31' },
    personnel: [
      { name: 'Dr. Ada Principal', role: 'Principal Investigator' },
      { name: 'Dr. First Co-PI', role: 'Co-Principal Investigator' },
      { name: 'Dr. Second Co-PI', role: 'Co-Principal Investigator' },
    ],
    documentFields: {
      institutionName: 'Applicant U',
      cityState: 'Atlanta, GA',
      internalProgram: 'Medical Research',
      meetingDate: 'December 2026',
      requestedAmount: '$900,000',
      invitedAmount: '$1,000,000',
      totalProjectBudget: '$3,500,000',
      institutionalFundingHistory: 'Applicant U has received 8 awards totaling $9.15 million from WMKF. The most recent grant was awarded in June 2026 to develop chemical tools to restore the function of defective proteins.',
    },
  });
  expect(deps.getProgramGrants).toHaveBeenCalledWith('22222222-2222-4222-8222-222222222222');
});

test('institutional funding history is excluded from the prompt context', () => {
  expect(Object.keys(promptContext({
    requestNumber: '1002379',
    projectTitle: 't',
    applicantInstitution: 'a',
    projectPeriod: null,
    personnel: [],
    documentFields: { institutionalFundingHistory: 'secret' },
  }))).not.toContain('documentFields');
});

test('uses account AKA for DV:InstitutionName when AKA and account name differ', async () => {
  const deps = dependencies();
  const result = await loadPreSiteVisitInputs({ requestId: REQUEST_ID }, deps);

  expect(result.context.applicantInstitution).toBe('Applicant U');
  expect(result.context.documentFields.institutionName).toBe('Applicant U');
});

test.each(['  ', 'N/A', 'unknown'])(
  'falls back from unusable AKA %p to account name',
  async (akoyaAka) => {
    const deps = dependencies({
      getApplicant: jest.fn().mockResolvedValue({
        akoya_aka: akoyaAka,
        name: 'Applicant University',
        address1_city: 'Atlanta',
        address1_stateorprovince: 'Georgia',
        wmkf_countofprogramgrants: 8,
        wmkf_sumofprogramgrants: 9150000,
      }),
    });
    const result = await loadPreSiteVisitInputs({ requestId: REQUEST_ID }, deps);

    expect(result.context.documentFields.institutionName).toBe('Applicant University');
  },
);

test('fails closed when the applicant account read fails (funding history cannot be derived)', async () => {
  const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
  const deps = dependencies({
    getApplicant: jest.fn().mockRejectedValue(new Error('account unavailable')),
  });

  await expect(loadPreSiteVisitInputs({ requestId: REQUEST_ID }, deps))
    .rejects.toMatchObject({ code: 'pre_site_visit_funding_history_unavailable', httpStatus: 409 });
  warnSpy.mockRestore();
});

test('fails closed when the program-grant query fails', async () => {
  const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
  const deps = dependencies({
    getProgramGrants: jest.fn().mockRejectedValue(new Error('dataverse 503')),
  });

  await expect(loadPreSiteVisitInputs({ requestId: REQUEST_ID }, deps))
    .rejects.toMatchObject({ code: 'pre_site_visit_funding_history_unavailable', httpStatus: 409 });
  warnSpy.mockRestore();
});

test('fails closed when the request has no applicant account', async () => {
  const deps = dependencies({
    getRequest: jest.fn().mockResolvedValue(requestFixture({ _akoya_applicantid_value: null })),
  });

  await expect(loadPreSiteVisitInputs({ requestId: REQUEST_ID }, deps))
    .rejects.toMatchObject({ code: 'pre_site_visit_funding_history_unavailable', httpStatus: 409 });
});

function applicantWithRollups(count, sum) {
  return jest.fn().mockResolvedValue({
    akoya_aka: 'Applicant U',
    name: 'Applicant University',
    wmkf_countofprogramgrants: count,
    wmkf_sumofprogramgrants: sum,
  });
}

test.each([
  ['rollup count 0 / null while live rows exist', 0, 0],
  ['rollup count null while live rows exist', null, null],
  ['rollup count lags by one (stale but positive)', 7, 7950000],
  ['rollup sum lags the live sum', 8, 8150000],
])('fails closed when %s', async (_label, count, sum) => {
  const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
  const deps = dependencies({ getApplicant: applicantWithRollups(count, sum) });

  await expect(loadPreSiteVisitInputs({ requestId: REQUEST_ID }, deps))
    .rejects.toMatchObject({ code: 'pre_site_visit_funding_history_unavailable', httpStatus: 409 });
  warnSpy.mockRestore();
});

test('fails closed when the program-grant query was capped', async () => {
  const deps = dependencies({
    getProgramGrants: jest.fn().mockResolvedValue({ records: programGrantRows(), capped: true }),
  });

  await expect(loadPreSiteVisitInputs({ requestId: REQUEST_ID }, deps))
    .rejects.toMatchObject({ code: 'pre_site_visit_funding_history_unavailable', httpStatus: 409 });
});

test('fails closed when a program grant has neither a decision date nor a meeting date', async () => {
  const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
  const rows = programGrantRows();
  rows[3] = { ...rows[3], akoya_decisiondate: null, wmkf_meetingdate: null };
  const deps = dependencies({
    getProgramGrants: jest.fn().mockResolvedValue({ records: rows, capped: false }),
  });

  await expect(loadPreSiteVisitInputs({ requestId: REQUEST_ID }, deps))
    .rejects.toMatchObject({ code: 'pre_site_visit_funding_history_unavailable', httpStatus: 409 });
  warnSpy.mockRestore();
});

test('cites the newest research grant, qualified, when a newer non-research program grant exists', async () => {
  const rows = programGrantRows();
  rows[7] = {
    ...rows[7],
    _wmkf_grantprogram_value_formatted: 'Southern California',
    wmkf_wmkfprojectdescription: 'To strengthen low-income families.',
  };
  const deps = dependencies({
    getProgramGrants: jest.fn().mockResolvedValue({ records: rows, capped: false }),
  });

  const result = await loadPreSiteVisitInputs({ requestId: REQUEST_ID }, deps);

  // count/sum still cover all 8 program grants; the cited award is the newest Research one (row 6)
  expect(result.context.documentFields.institutionalFundingHistory).toBe(
    'Applicant U has received 8 awards totaling $9.15 million from WMKF. The most recent research grant was awarded in June 2016 to do project 6.',
  );
});

test('omits the second sentence when the institution has program grants but none in Research', async () => {
  const rows = programGrantRows().map((row) => ({ ...row, _wmkf_grantprogram_value_formatted: 'Undergraduate Education' }));
  const deps = dependencies({
    getProgramGrants: jest.fn().mockResolvedValue({ records: rows, capped: false }),
  });

  const result = await loadPreSiteVisitInputs({ requestId: REQUEST_ID }, deps);

  expect(result.context.documentFields.institutionalFundingHistory)
    .toBe('Applicant U has received 8 awards totaling $9.15 million from WMKF.');
});

test('picks the newest grant by meeting date when its decision date is missing', async () => {
  const rows = programGrantRows();
  rows[7] = {
    ...rows[7],
    akoya_decisiondate: null,
    akoya_fiscalyear: null,
    wmkf_meetingdate: '2026-06-01',
  };
  const deps = dependencies({
    getProgramGrants: jest.fn().mockResolvedValue({ records: rows.reverse(), capped: false }),
  });

  const result = await loadPreSiteVisitInputs({ requestId: REQUEST_ID }, deps);

  expect(result.context.documentFields.institutionalFundingHistory).toBe(
    'Applicant U has received 8 awards totaling $9.15 million from WMKF. The most recent grant was awarded in June 2026 to develop chemical tools to restore the function of defective proteins.',
  );
});

test('renders the no-prior-award sentence when the account has no program grants', async () => {
  const deps = dependencies({
    getApplicant: jest.fn().mockResolvedValue({
      akoya_aka: 'New U',
      name: 'New University',
      address1_city: 'Atlanta',
      address1_stateorprovince: 'Georgia',
      wmkf_countofprogramgrants: 0,
      wmkf_sumofprogramgrants: 0,
    }),
    getProgramGrants: jest.fn().mockResolvedValue({ records: [], capped: false }),
  });

  const result = await loadPreSiteVisitInputs({ requestId: REQUEST_ID }, deps);

  expect(result.context.documentFields.institutionalFundingHistory)
    .toBe('New U has not previously received a program grant from WMKF.');
});

test('fails closed when account and formatted applicant names are unusable even if the Request Bill.com field is populated', async () => {
  const deps = dependencies({
    getApplicant: jest.fn().mockResolvedValue({
      akoya_aka: 'N/A',
      name: 'unknown',
      address1_city: 'Atlanta',
      address1_stateorprovince: 'Georgia',
      wmkf_countofprogramgrants: 8,
      wmkf_sumofprogramgrants: 9150000,
    }),
    getRequest: jest.fn().mockResolvedValue(requestFixture({
      _akoya_applicantid_value_formatted: 'N/A',
      wmkf_organizationname: 'Bill.com Placeholder University',
    })),
  });

  await expect(loadPreSiteVisitInputs({ requestId: REQUEST_ID }, deps))
    .rejects.toMatchObject({ code: 'pre_site_visit_context_incomplete', httpStatus: 409 });
});

test('calls the governed prompt with ordered personnel and fail-closed safeguards', async () => {
  const deps = dependencies();
  const result = await generatePreSiteVisitProposalCore({
    requestId: REQUEST_ID,
    actingUserSystemId: '44444444-4444-4444-8444-444444444444',
    runSource: 'Vercel Test',
  }, deps);

  expect(result.sources).toEqual([
    {
      role: 'proposalNarrative',
      filename: 'ProposalNarrative_1002379.pdf',
      siteId: 'site-id',
      driveId: 'drive-id',
      itemId: 'narrative-item',
      versionId: 'narrative-v1',
      contentHash: 'a'.repeat(64),
    },
  ]);
  expect(result.runId).toBe('33333333-3333-4333-8333-333333333333');
  expect(deps.runPrompt).toHaveBeenCalledTimes(1);
  expect(deps.getExecutorBudget).toHaveBeenCalledWith('pre-site-visit.proposal-core.generate');
  const call = deps.runPrompt.mock.calls[0][0];
  expect(call).toMatchObject({
    promptName: 'pre-site-visit.proposal-core.generate',
    requestId: REQUEST_ID,
    runSource: 'Vercel Test',
    assertSystemIncludes: REQUIRED_SYSTEM_ASSERTIONS,
    requireNoPersistence: true,
    // Extended transport budget for the suite's longest Claude call (S466,
    // after production run 88f7c877 hit the 120s default).
    timeoutMsOverride: 240_000,
    // Output budget above the prompt row's 16 384 (production run f8bb1326
    // hit max_tokens on Sonnet 5 adaptive thinking, 2026-08-28).
    maxTokensOverride: 32_768,
  });
  const promptContext = JSON.parse(call.overrideVariables.request_context_json);
  expect(promptContext.personnel.map((person) => person.name)).toEqual([
    'Dr. Ada Principal',
    'Dr. First Co-PI',
    'Dr. Second Co-PI',
  ]);
  expect(promptContext).not.toHaveProperty('requestedAmount');
  expect(promptContext).not.toHaveProperty('invitedAmount');
  expect(call.overrideVariables.proposal_text).toContain('Proposal narrative content');
  expect(Object.keys(call.overrideVariables)).toEqual([
    'request_context_json',
    'proposal_text',
  ]);
});

test('fails before the prompt call when the exact narrative is unavailable', async () => {
  const deps = dependencies({ getProposalNarrative: jest.fn().mockResolvedValue(null) });
  await expect(generatePreSiteVisitProposalCore({ requestId: REQUEST_ID }, deps))
    .rejects.toMatchObject({ code: 'proposal_narrative_unavailable', httpStatus: 409 });
  expect(deps.runPrompt).not.toHaveBeenCalled();
});

test('does not require or send a proposal bibliography', async () => {
  const deps = dependencies();
  await expect(generatePreSiteVisitProposalCore({ requestId: REQUEST_ID }, deps))
    .resolves.toMatchObject({ proposalCore: expect.any(Object) });
  expect(deps.runPrompt.mock.calls[0][0].overrideVariables)
    .not.toHaveProperty('proposal_bibliography');
});

test('fails before the prompt call when the authoritative PI is missing', async () => {
  const deps = dependencies({
    getRequest: jest.fn().mockResolvedValue(requestFixture({
      _wmkf_projectleader_value_formatted: null,
    })),
  });
  await expect(generatePreSiteVisitProposalCore({ requestId: REQUEST_ID }, deps))
    .rejects.toMatchObject({ code: 'pre_site_visit_context_incomplete', httpStatus: 409 });
  expect(deps.runPrompt).not.toHaveBeenCalled();
});

test('rejects a drifted live prompt result that does not match the local eight-field contract', async () => {
  const deps = dependencies({
    runPrompt: jest.fn().mockResolvedValue({
      parsed: { proposalCore: { executiveSummary: 'Only one field.' } },
      runId: '33333333-3333-4333-8333-333333333333',
    }),
  });
  await expect(generatePreSiteVisitProposalCore({ requestId: REQUEST_ID }, deps))
    .rejects.toMatchObject({ code: 'pre_site_visit_prompt_invalid', httpStatus: 502 });
});

test('normalizes editorial deviations and returns deterministic warnings without failing', () => {
  const raw = {
    executiveSummary: 'Long but usable. '.repeat(60),
    impactOverview: 'Impact overview.',
    methodologyOverview: 'Methodology overview.',
    personnelOverview: 'Ada Principal.\n\nCasey Collaborator.',
    keckFundingRationale: 'Rationale.',
    backgroundAndImpact: 'One.\n\nTwo.\n\nThree.',
    detailedMethodology: 'Detailed methodology.',
    personnelDetails: 'Ada Principal.\n\nCasey Collaborator.',
    staffRecommendation: 'Fund it.',
  };

  const result = prepareGeneratedCore(raw, {
    personnelNames: ['Ada Principal', 'Casey Collaborator'],
    aiPayloadBoundaries: [{
      dataClass: 'proposal_text',
      truncated: true,
      originalChars: 120000,
      transmittedChars: 100000,
    }],
  });

  expect(result.proposalCore.personnelOverview).toBe('Ada Principal. Casey Collaborator.');
  expect(result.proposalCore.personnelDetails).toBe('Ada Principal. Casey Collaborator.');
  expect(result.proposalCore).not.toHaveProperty('staffRecommendation');
  expect(result.diagnostics).toEqual(expect.arrayContaining([
    expect.objectContaining({ code: 'section_over_target', section: 'executiveSummary' }),
    expect.objectContaining({ code: 'paragraphs_over_target', section: 'backgroundAndImpact' }),
    expect.objectContaining({ code: 'proposal_input_truncated', originalChars: 120000 }),
    expect.objectContaining({ code: 'extra_output_key_dropped', path: '$.proposalCore.staffRecommendation' }),
  ]));
});

test.each([
  ['whitespace-only content', { executiveSummary: ' \n\t ' }, 'pre_site_visit_prompt_empty_section'],
  ['reserved AI token', { executiveSummary: 'Text [[AI:ExecutiveSummary]]' }, 'pre_site_visit_prompt_reserved_token'],
  ['reserved staff token', { personnelDetails: 'Text [[STAFF:Recommendation]]' }, 'pre_site_visit_prompt_reserved_token'],
])('rejects %s before persistence', (_label, overrides, code) => {
  const base = {
    executiveSummary: 'Executive summary.',
    impactOverview: 'Impact overview.',
    methodologyOverview: 'Methodology overview.',
    personnelOverview: 'Personnel overview.',
    keckFundingRationale: 'Rationale.',
    backgroundAndImpact: 'Background and impact.',
    detailedMethodology: 'Detailed methodology.',
    personnelDetails: 'Personnel details.',
  };
  expect(() => prepareGeneratedCore({ ...base, ...overrides })).toThrow(
    expect.objectContaining({ code }),
  );
});
