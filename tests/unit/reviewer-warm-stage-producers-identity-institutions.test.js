/** @jest-environment node */

const {
  IDENTITY_STAGE_CONTRACT_VERSION,
  isIdentityAuthoritySatisfied,
  produceIdentityEvidence: rawProduceIdentityEvidence,
  projectIdentityEvidence: rawProjectIdentityEvidence,
  projectStaffConfirmedIdentityEvidence: rawProjectStaffConfirmedIdentityEvidence,
} = require('../../lib/services/workbench/reviewer-stage-producers/identity');
const {
  produceInstitutionDomainsEvidence: rawProduceInstitutionDomainsEvidence,
  projectInstitutionDomainsEvidence: rawProjectInstitutionDomainsEvidence,
} = require('../../lib/services/workbench/reviewer-stage-producers/institution-domains');
const {
  produceInstitutionCoiEvidence: rawProduceInstitutionCoiEvidence,
  projectInstitutionCoiEvidence: rawProjectInstitutionCoiEvidence,
} = require('../../lib/services/workbench/reviewer-stage-producers/institution-coi');
const {
  resolveInstitutionDomainEvidence,
} = require('../../lib/services/contact-enrichment/domain-evidence');
const { projectStageEnvelope } = require('../../lib/services/workbench/reviewer-stage-projector');

const REQUEST_ID = '11111111-1111-4111-8111-111111111111';
const WHEN = '2026-08-02T12:00:00.000Z';
const IDENTITY_SOURCE = '1'.repeat(64);
const DOMAINS_SOURCE = '2'.repeat(64);
const INSTITUTION_COI_SOURCE = '3'.repeat(64);

function projectIdentityEvidence(input = {}) {
  return rawProjectIdentityEvidence({ ...input, expectedSourceVersion: input.expectedSourceVersion || IDENTITY_SOURCE });
}
function produceIdentityEvidence(input = {}) {
  return rawProduceIdentityEvidence({ ...input, expectedSourceVersion: input.expectedSourceVersion || IDENTITY_SOURCE });
}
function projectStaffConfirmedIdentityEvidence(input = {}) {
  return rawProjectStaffConfirmedIdentityEvidence({ ...input, expectedSourceVersion: input.expectedSourceVersion || IDENTITY_SOURCE });
}
function projectInstitutionDomainsEvidence(input = {}) {
  return rawProjectInstitutionDomainsEvidence({ ...input, expectedSourceVersion: input.expectedSourceVersion || DOMAINS_SOURCE });
}
function produceInstitutionDomainsEvidence(input = {}) {
  return rawProduceInstitutionDomainsEvidence({ ...input, expectedSourceVersion: input.expectedSourceVersion || DOMAINS_SOURCE });
}
function projectInstitutionCoiEvidence(input = {}) {
  return rawProjectInstitutionCoiEvidence({ ...input, expectedSourceVersion: input.expectedSourceVersion || INSTITUTION_COI_SOURCE });
}
function produceInstitutionCoiEvidence(input = {}) {
  return rawProduceInstitutionCoiEvidence({ ...input, expectedSourceVersion: input.expectedSourceVersion || INSTITUTION_COI_SOURCE });
}

function candidate(overrides = {}) {
  return {
    candidateKey: 'person:reviewer-1',
    name: 'Ada Reviewer',
    affiliation: 'Example University',
    primaryAffiliation: 'Example University',
    field: 'Structural biology',
    expertiseAreas: ['Protein design'],
    ...overrides,
  };
}

function identityReceipt(overrides = {}) {
  return {
    state: 'current',
    contractVersion: IDENTITY_STAGE_CONTRACT_VERSION,
    sourceVersion: 'identity-source',
    resultVersion: 'identity-result',
    completedAt: WHEN,
    ...overrides,
  };
}

function identityEvidence(overrides = {}) {
  return { decision: 'confirmed', status: 'confirmed', anchors: [], ...overrides };
}

function completeCoiContext(overrides = {}) {
  return {
    piResolution: { state: 'ok', reason: 'not_requested' },
    institutionEntries: [{ identity: 'Applicant University', display: 'Applicant University' }],
    ...overrides,
  };
}

describe('reviewer warm-stage identity producer', () => {
  test('binds a complete authoritative decision to the proposal content version without leaking runtime payload', () => {
    const result = projectIdentityEvidence({
      candidate: candidate(),
      applicantInputVersion: 'applicant-v1',
      proposalContentVersion: 'proposal-v1',
      completedAt: WHEN,
      identityResult: {
        status: 'confirmed',
        orcid: 'https://orcid.org/0000-0001-2345-6789',
        selectedRecord: { openAlexId: 'https://openalex.org/A12345', email: 'secret@example.edu' },
        anchors: [{ type: 'orcid_name_confirmed', strength: 'strong', value: '0000-0001-2345-6789', unbounded: 'secret' }],
      },
    });

    expect(result).toMatchObject({ outcome: 'current', receipt: { state: 'current', contractVersion: 4, completedAt: WHEN } });
    expect(result.evidencePatch.identityEvidence).toEqual(expect.objectContaining({
      decision: 'confirmed',
      orcid: '0000-0001-2345-6789',
      openAlexAuthorId: 'A12345',
    }));
    expect(JSON.stringify(result)).not.toContain('secret@example.edu');
    const changedProposal = projectIdentityEvidence({
      candidate: candidate(),
      applicantInputVersion: 'applicant-v1',
      proposalContentVersion: 'proposal-v2',
      completedAt: WHEN,
      identityResult: { status: 'confirmed', anchors: [] },
      // The shared authority planner, not this projector, owns the source
      // invalidation. A changed authoritative source is the only way to
      // authorize a fresh current receipt.
      expectedSourceVersion: '9'.repeat(64),
    });
    expect(changedProposal.receipt.sourceVersion).not.toBe(result.receipt.sourceVersion);
  });

  test('a complete unresolved result is cache-current but not promotion-authoritative', () => {
    const result = projectIdentityEvidence({
      candidate: candidate(),
      applicantInputVersion: 'applicant-v1',
      proposalContentVersion: 'proposal-v1',
      completedAt: WHEN,
      identityResult: { status: 'abstain', sources: { openalex: 'ok', orcid: 'not_run' }, anchors: [] },
    });

    expect(result).toMatchObject({ outcome: 'current', receipt: { state: 'current' } });
    expect(isIdentityAuthoritySatisfied({ identityEvidence: result.evidencePatch.identityEvidence })).toBe(false);
  });

  test('a provider error or abort never becomes current identity evidence', async () => {
    const providerError = projectIdentityEvidence({
      candidate: candidate(),
      applicantInputVersion: 'applicant-v1',
      proposalContentVersion: 'proposal-v1',
      completedAt: WHEN,
      identityResult: { status: 'abstain', sources: { openalex: 'error' }, anchors: [] },
    });
    expect(providerError).toMatchObject({ outcome: 'incomplete', receipt: { failureCode: 'provider_unavailable', completedAt: null } });

    const controller = new AbortController();
    controller.abort();
    const result = await produceIdentityEvidence({
      candidate: candidate(),
      applicantInputVersion: 'applicant-v1',
      proposalContentVersion: 'proposal-v1',
      completedAt: WHEN,
      signal: controller.signal,
      resolver: { evaluateSuggestion: jest.fn(async () => { throw Object.assign(new Error('aborted'), { name: 'AbortError' }); }) },
    });
    expect(result).toMatchObject({ outcome: 'incomplete', receipt: { failureCode: 'provider_unavailable', completedAt: null } });
  });

  test('missing proposal authority rejects before the runtime resolver is called', async () => {
    const resolver = { evaluateSuggestion: jest.fn() };
    const result = await produceIdentityEvidence({
      candidate: candidate(),
      applicantInputVersion: 'applicant-v1',
      proposalContentVersion: null,
      completedAt: WHEN,
      resolver,
    });

    expect(result).toMatchObject({ outcome: 'incomplete', receipt: { failureCode: 'missing_required_input', completedAt: null } });
    expect(resolver.evaluateSuggestion).not.toHaveBeenCalled();
  });

  test('a projector without a server-issued source version cannot mint current identity evidence', () => {
    const result = rawProjectIdentityEvidence({
      candidate: candidate(),
      applicantInputVersion: 'applicant-v1',
      proposalContentVersion: 'proposal-v1',
      completedAt: WHEN,
      identityResult: { status: 'confirmed', anchors: [] },
      expectedSourceVersion: 'forged',
    });

    expect(result).toMatchObject({ outcome: 'incomplete', receipt: { state: 'incomplete', completedAt: null } });
  });

  test('staff confirmation requires server authority and binds its canonical person version into the receipt', () => {
    const args = {
      candidate: candidate(),
      applicantInputVersion: 'applicant-v1',
      proposalContentVersion: 'proposal-v1',
      completedAt: WHEN,
      confirmation: {
        authority: 'server_loaded',
        canonicalPersonId: '33333333-3333-4333-8333-333333333333',
        canonicalPersonEtag: 'W/"etag-1"',
        actorId: 'staff-1',
        confirmedAt: WHEN,
      },
    };
    const first = projectStaffConfirmedIdentityEvidence(args);
    const changedPerson = projectStaffConfirmedIdentityEvidence({
      ...args,
      expectedSourceVersion: '8'.repeat(64),
      confirmation: { ...args.confirmation, canonicalPersonEtag: 'W/"etag-2"' },
    });
    expect(first).toMatchObject({
      outcome: 'current',
      evidencePatch: { staffIdentityConfirmation: { state: 'confirmed' } },
    });
    expect(changedPerson.receipt.sourceVersion).not.toBe(first.receipt.sourceVersion);

    const rejected = projectStaffConfirmedIdentityEvidence({
      ...args,
      confirmation: { ...args.confirmation, authority: 'browser_asserted' },
    });
    expect(rejected).toMatchObject({ outcome: 'incomplete', receipt: { failureCode: 'missing_required_input' } });
  });
});

describe('reviewer warm-stage institution-domain producer', () => {
  test('nonauthoritative identity returns server-issued N/A without domain-provider work', async () => {
    const resolveDomains = jest.fn();
    const result = await produceInstitutionDomainsEvidence({
      candidate: candidate(),
      identityReceipt: identityReceipt(),
      identityEvidence: identityEvidence({ decision: 'abstain', status: 'abstain' }),
      completedAt: WHEN,
      resolveDomains,
    });

    expect(result).toMatchObject({
      outcome: 'not_applicable',
      receipt: { state: 'not_applicable', reasonCode: 'identity_not_authoritative' },
    });
    expect(resolveDomains).not.toHaveBeenCalled();
  });

  test('provider failure cannot be classified as no_trusted_domains and preserves bounded lookup state', async () => {
    const openAlexService = {
      getInstitution: jest.fn(async () => { throw new Error('OpenAlex unavailable'); }),
      searchInstitutions: jest.fn(),
    };
    const domainResult = await resolveInstitutionDomainEvidence(candidate({
      contactEnrichment: {
        identity: { status: 'confirmed' },
        tierResults: { orcid: { affiliations: [{ current: true, organization: 'Example University', disambiguatedOrganizationId: 'https://ror.org/01', disambiguationSource: 'ROR' }] } },
      },
    }), {}, {
      identityEvidence: { status: 'confirmed' },
      identityTrusted: true,
      openAlexService,
    });
    expect(domainResult).toMatchObject({ outcome: 'incomplete', reasonCode: 'institution_lookup_failed' });
    expect(domainResult.lookups).toEqual([{ kind: 'ror', key: 'https://ror.org/01', state: 'error' }]);
    expect(openAlexService.searchInstitutions).not.toHaveBeenCalled();

    const projected = projectInstitutionDomainsEvidence({
      candidate: candidate(),
      identityReceipt: identityReceipt(),
      identityEvidence: identityEvidence(),
      domainResult,
      completedAt: WHEN,
    });
    expect(projected).toMatchObject({ outcome: 'incomplete', receipt: { state: 'incomplete' } });
  });

  test('aborted/partial domain resolution remains incomplete and a stale identity prerequisite makes zero calls', async () => {
    const controller = new AbortController();
    controller.abort();
    const openAlexService = {
      getInstitution: jest.fn(async () => { throw Object.assign(new Error('abort'), { name: 'AbortError' }); }),
      searchInstitutions: jest.fn(),
    };
    const domainResult = await resolveInstitutionDomainEvidence(candidate({
      contactEnrichment: {
        identity: { status: 'confirmed' },
        tierResults: { orcid: { affiliations: [{ current: true, organization: 'Example University', disambiguatedOrganizationId: 'R1', disambiguationSource: 'ROR' }] } },
      },
    }), {}, { signal: controller.signal, identityEvidence: { status: 'confirmed' }, identityTrusted: true, openAlexService });
    expect(domainResult).toMatchObject({ outcome: 'incomplete', reasonCode: 'institution_lookup_aborted' });

    const resolveDomains = jest.fn();
    const stale = await produceInstitutionDomainsEvidence({
      candidate: candidate(),
      identityReceipt: identityReceipt({ state: 'incomplete' }),
      identityEvidence: identityEvidence(),
      completedAt: WHEN,
      resolveDomains,
    });
    expect(stale).toMatchObject({ outcome: 'incomplete', receipt: { failureCode: 'missing_required_input', completedAt: null } });
    expect(resolveDomains).not.toHaveBeenCalled();
  });

  test('a complete empty resolution is the only path to current no_trusted_domains', async () => {
    const resolveDomains = jest.fn(async () => ({
      outcome: 'current',
      reasonCode: 'no_trusted_domains',
      anchoredDomains: [],
      plausibleDomains: [],
      institutions: [],
      lookups: [{ kind: 'name', key: 'Example University', state: 'no_domain' }],
    }));
    const result = await produceInstitutionDomainsEvidence({
      candidate: candidate(),
      identityReceipt: identityReceipt(),
      identityEvidence: identityEvidence(),
      completedAt: WHEN,
      resolveDomains,
    });
    expect(result).toMatchObject({
      outcome: 'current',
      evidencePatch: { institutionDomainEvidence: { reasonCode: 'no_trusted_domains' } },
      receipt: { state: 'current', reasonCode: null },
    });
  });

  test('partial staff confirmation does not unlock institution-domain provider work', async () => {
    const resolveDomains = jest.fn();
    const result = await produceInstitutionDomainsEvidence({
      candidate: candidate(),
      identityReceipt: identityReceipt(),
      identityEvidence: {
        staffConfirmation: { state: 'confirmed', canonicalPersonId: 'person-1', confirmedAt: WHEN },
      },
      completedAt: WHEN,
      resolveDomains,
    });

    expect(resolveDomains).not.toHaveBeenCalled();
    expect(result).toMatchObject({ outcome: 'not_applicable', receipt: { reasonCode: 'identity_not_authoritative' } });
  });

  test('a projector without a server-issued source version cannot mint current domain evidence', () => {
    const result = rawProjectInstitutionDomainsEvidence({
      candidate: candidate(), identityReceipt: identityReceipt(), identityEvidence: identityEvidence(),
      domainResult: { outcome: 'current', anchoredDomains: [], plausibleDomains: [], institutions: [], lookups: [] },
      completedAt: WHEN, expectedSourceVersion: 'forged',
    });
    expect(result).toMatchObject({ outcome: 'incomplete', receipt: { state: 'incomplete', completedAt: null } });
  });

  test('seals the raw affiliation inputs as an opaque fingerprint that survives the evidence projector', async () => {
    const result = await produceInstitutionDomainsEvidence({
      candidate: candidate({
        contactEnrichment: {
          affiliation: 'Example University',
          tierResults: {
            orcid: {
              affiliations: [{
                current: true,
                organization: 'Example University',
                disambiguatedOrganizationId: 'https://ror.org/03yrm5c26',
                disambiguationSource: 'ROR',
              }],
            },
          },
        },
      }),
      identityReceipt: identityReceipt(),
      identityEvidence: identityEvidence(),
      completedAt: WHEN,
      resolveDomains: async () => ({
        outcome: 'current', anchoredDomains: ['example.edu'], plausibleDomains: [], institutions: [], lookups: [],
      }),
    });

    const fingerprint = result.evidencePatch.institutionDomainEvidence.inputFingerprint;
    expect(fingerprint).toMatch(/^[a-f0-9]{64}$/);
    expect(projectStageEnvelope({ stage: 'institution_domains', mode: 'manual_refresh', envelope: result }))
      .toMatchObject({ ok: true, value: { evidencePatch: { institutionDomainEvidence: { inputFingerprint: fingerprint } } } });
  });

  test('generic contact-enrichment anchors cannot mint trusted domains', async () => {
    const resolveDomains = jest.fn(async (resolverCandidate) => ({
      outcome: 'current',
      anchoredDomains: resolverCandidate.contactEnrichment?.tierResults?.orcid?.affiliations
        ? ['attacker.example']
        : [],
      plausibleDomains: [], institutions: [], lookups: [],
    }));
    const result = await produceInstitutionDomainsEvidence({
      candidate: candidate({
        contactEnrichment: {
          verifiedInstitutionDomain: 'attacker.example',
          tierResults: { orcid: { affiliations: [{ current: true, organization: 'Attacker University' }] } },
        },
      }),
      identityReceipt: identityReceipt(),
      identityEvidence: identityEvidence(),
      completedAt: WHEN,
      resolveDomains,
    });

    expect(resolveDomains).toHaveBeenCalledWith(
      expect.objectContaining({
        contactEnrichment: expect.not.objectContaining({
          verifiedInstitutionDomain: expect.anything(),
          tierResults: expect.anything(),
        }),
      }),
      expect.any(Object),
      expect.any(Object),
    );
    expect(result.evidencePatch.trustedInstitutionDomains).toEqual([]);
  });
});

describe('reviewer warm-stage institution-COI producer', () => {
  test('nonauthoritative identity short-circuits before context/matcher work', async () => {
    const loadContext = jest.fn();
    const decideCoi = jest.fn();
    const result = await produceInstitutionCoiEvidence({
      requestId: REQUEST_ID,
      candidate: candidate(),
      identityReceipt: identityReceipt(),
      identityEvidence: identityEvidence({ decision: 'ambiguous', status: 'ambiguous' }),
      completedAt: WHEN,
      loadContext,
      decideCoi,
    });
    expect(result).toMatchObject({ outcome: 'not_applicable', receipt: { reasonCode: 'identity_not_authoritative' } });
    expect(loadContext).not.toHaveBeenCalled();
    expect(decideCoi).not.toHaveBeenCalled();
  });

  test('canonical current context plus a clean matcher decision records current clean evidence', async () => {
    const loadContext = jest.fn(async () => completeCoiContext());
    const decideCoi = jest.fn(() => null);
    const result = await produceInstitutionCoiEvidence({
      requestId: REQUEST_ID,
      candidate: candidate(),
      identityReceipt: identityReceipt(),
      identityEvidence: identityEvidence(),
      completedAt: WHEN,
      loadContext,
      decideCoi,
    });

    expect(result).toMatchObject({
      outcome: 'current',
      evidencePatch: { institutionCoiEvidence: { hasInstitutionCOI: false, dropDecision: 'clean' } },
      receipt: { state: 'current' },
    });
    expect(loadContext).toHaveBeenCalledWith(REQUEST_ID, expect.objectContaining({ requireCompleteInstitutions: true }));
    expect(decideCoi).toHaveBeenCalledTimes(1);
  });

  test('accepts a generic Dataverse request GUID for both projection and execution', async () => {
    const dataverseRequestId = '17e1c7ae-c844-f111-88b5-000d3a3065b8';
    const inputs = {
      requestId: dataverseRequestId,
      candidate: candidate(),
      identityReceipt: identityReceipt(),
      identityEvidence: identityEvidence(),
      completedAt: WHEN,
    };
    const projected = projectInstitutionCoiEvidence({
      ...inputs,
      context: completeCoiContext(),
      decision: null,
    });
    const loadContext = jest.fn(async () => completeCoiContext());
    const produced = await produceInstitutionCoiEvidence({
      ...inputs,
      loadContext,
      decideCoi: jest.fn(() => null),
    });

    expect(projected).toMatchObject({
      outcome: 'current',
      receipt: { state: 'current', failureCode: null },
    });
    expect(produced).toMatchObject({
      outcome: 'current',
      receipt: { state: 'current', failureCode: null },
    });
    expect(loadContext).toHaveBeenCalledWith(dataverseRequestId, expect.any(Object));
  });

  test('rejects an injection-shaped request ID before loading COI context', async () => {
    const loadContext = jest.fn();
    const result = await produceInstitutionCoiEvidence({
      requestId: "17e1c7ae-c844-f111-88b5-000d3a3065b8') OR 1=1 --",
      candidate: candidate(),
      identityReceipt: identityReceipt(),
      identityEvidence: identityEvidence(),
      completedAt: WHEN,
      loadContext,
      decideCoi: jest.fn(),
    });

    expect(result).toMatchObject({ outcome: 'incomplete', receipt: { state: 'incomplete' } });
    expect(loadContext).not.toHaveBeenCalled();
  });

  test('incomplete context, unknown matcher output, and stale identity all fail closed', async () => {
    const contextResult = await produceInstitutionCoiEvidence({
      requestId: REQUEST_ID,
      candidate: candidate(),
      identityReceipt: identityReceipt(),
      identityEvidence: identityEvidence(),
      completedAt: WHEN,
      loadContext: jest.fn(async () => completeCoiContext({ piResolution: { state: 'failed' } })),
      decideCoi: jest.fn(() => null),
    });
    expect(contextResult).toMatchObject({ outcome: 'incomplete', receipt: { failureCode: 'missing_required_input', completedAt: null } });

    const unknown = await produceInstitutionCoiEvidence({
      requestId: REQUEST_ID,
      candidate: candidate(),
      identityReceipt: identityReceipt(),
      identityEvidence: identityEvidence(),
      completedAt: WHEN,
      loadContext: jest.fn(async () => completeCoiContext()),
      decideCoi: jest.fn(() => ({ dropDecision: 'maybe' })),
    });
    expect(unknown).toMatchObject({ outcome: 'incomplete', receipt: { failureCode: 'partial_coverage', completedAt: null } });

    const loadContext = jest.fn();
    const stale = projectInstitutionCoiEvidence({
      requestId: REQUEST_ID,
      candidate: candidate(),
      identityReceipt: identityReceipt({ state: 'failed' }),
      identityEvidence: identityEvidence(),
      completedAt: WHEN,
      context: completeCoiContext(),
      decision: null,
    });
    expect(stale).toMatchObject({ outcome: 'incomplete', receipt: { failureCode: 'missing_required_input', completedAt: null } });
    expect(loadContext).not.toHaveBeenCalled();
  });

  test('partial staff confirmation does not unlock institution-COI context/matcher work', async () => {
    const loadContext = jest.fn();
    const decideCoi = jest.fn();
    const result = await produceInstitutionCoiEvidence({
      requestId: REQUEST_ID,
      candidate: candidate(),
      identityReceipt: identityReceipt(),
      identityEvidence: {
        staffConfirmation: { state: 'confirmed', canonicalPersonId: 'person-1', confirmedAt: WHEN },
      },
      completedAt: WHEN,
      loadContext,
      decideCoi,
    });

    expect(loadContext).not.toHaveBeenCalled();
    expect(decideCoi).not.toHaveBeenCalled();
    expect(result).toMatchObject({ outcome: 'not_applicable', receipt: { reasonCode: 'identity_not_authoritative' } });
  });

  test('a projector without a server-issued source version cannot mint current institution-COI evidence', () => {
    const result = rawProjectInstitutionCoiEvidence({
      requestId: REQUEST_ID,
      candidate: candidate(), identityReceipt: identityReceipt(), identityEvidence: identityEvidence(),
      context: completeCoiContext(), decision: null, completedAt: WHEN, expectedSourceVersion: 'forged',
    });
    expect(result).toMatchObject({ outcome: 'incomplete', receipt: { state: 'incomplete', completedAt: null } });
  });

  test('generic contact affiliation cannot redirect the institution matcher', async () => {
    const decideCoi = jest.fn((matcherCandidate) => {
      expect(matcherCandidate).toMatchObject({ affiliation: 'Example University' });
      expect(matcherCandidate.contactEnrichment).toEqual(expect.objectContaining({
        affiliation: 'Example University',
      }));
      expect(matcherCandidate.contactEnrichment).not.toHaveProperty('untrustedMarker');
      return null;
    });
    await produceInstitutionCoiEvidence({
      requestId: REQUEST_ID,
      candidate: candidate({
        contactEnrichment: {
          affiliation: 'Applicant University',
          untrustedMarker: 'browser-provided',
          openAlexInstitutionRor: 'https://ror.org/attacker',
        },
      }),
      identityReceipt: identityReceipt(),
      identityEvidence: identityEvidence(),
      completedAt: WHEN,
      loadContext: jest.fn(async () => completeCoiContext()),
      decideCoi,
    });
    expect(decideCoi).toHaveBeenCalledTimes(1);
  });
});

test('all producer outcomes satisfy the common closed envelope projector', async () => {
  const identity = projectIdentityEvidence({
    candidate: candidate(),
    applicantInputVersion: 'applicant-v1',
    proposalContentVersion: 'proposal-v1',
    identityResult: { status: 'confirmed', anchors: [] },
    completedAt: WHEN,
  });
  const domains = await produceInstitutionDomainsEvidence({
    candidate: candidate(),
    identityReceipt: identity.receipt,
    identityEvidence: identity.evidencePatch.identityEvidence,
    completedAt: WHEN,
    resolveDomains: async () => ({ outcome: 'current', anchoredDomains: ['example.edu'], plausibleDomains: ['example.edu'], institutions: ['Example University'], lookups: [] }),
  });
  const coi = await produceInstitutionCoiEvidence({
    requestId: REQUEST_ID,
    candidate: candidate(),
    identityReceipt: identity.receipt,
    identityEvidence: identity.evidencePatch.identityEvidence,
    completedAt: WHEN,
    loadContext: async () => completeCoiContext(),
    decideCoi: () => null,
  });
  const incomplete = projectIdentityEvidence({
    candidate: candidate(),
    applicantInputVersion: 'applicant-v1',
    proposalContentVersion: 'proposal-v1',
    identityResult: { status: 'abstain', sources: { openalex: 'error' } },
    completedAt: WHEN,
  });

  for (const [stage, envelope] of [
    ['identity', identity],
    ['institution_domains', domains],
    ['institution_coi', coi],
    ['identity', incomplete],
  ]) {
    expect(projectStageEnvelope({ stage, mode: 'manual_refresh', envelope })).toMatchObject({ ok: true });
  }
});
