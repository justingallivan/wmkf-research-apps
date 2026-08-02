/** @jest-environment node */

const {
  produceCoauthorCoiEvidence,
} = require('../../../lib/services/workbench/reviewer-stage-producers/coauthor-coi');
const {
  produceEligibilityEvidence,
} = require('../../../lib/services/workbench/reviewer-stage-producers/eligibility');
const {
  projectStageEnvelope,
} = require('../../../lib/services/workbench/reviewer-stage-projector');
import {
  produceReviewerContactEvidence,
} from '../../../lib/services/workbench/reviewer-stage-producers/contact';
import {
  produceAddressTrustEvidence,
} from '../../../lib/services/workbench/reviewer-stage-producers/address-trust';

const NOW = '2026-08-02T12:00:00.000Z';
const COAUTHOR_SOURCE = 'a'.repeat(64);
const ELIGIBILITY_SOURCE = 'b'.repeat(64);
const CONTACT_SOURCE = 'c'.repeat(64);
const ADDRESS_SOURCE = 'd'.repeat(64);

function contactTierApi() {
  return {
    applyTier0: () => 'continue',
    applyTier1: (_candidate, result) => {
      result.contactEnrichment.email = 'jane@example.edu';
      result.contactEnrichment.emailSource = 'orcid';
      result.contactEnrichment.emailIsRecent = true;
      result.contactEnrichment.emailPersistAllowed = true;
    },
    applyTier2: async () => {},
    applyScholarlyTier: async () => {},
    applyTier3: async () => {},
    applyTier4: async () => {},
    claudeWebSearch: async () => null,
  };
}

test('every isolated producer emits an envelope accepted by the common projector', async () => {
  const coauthor = await produceCoauthorCoiEvidence({
    candidate: { name: 'Jane Smith' },
    proposalAuthors: ['Alice Author'],
    proposalAuthorVersion: 'e'.repeat(64),
    sourceVersion: 'coauthor-v1',
    expectedSourceVersion: COAUTHOR_SOURCE,
    now: () => NOW,
    check: async () => ({
      hasCoauthorship: false,
      coauthorships: [],
      sharedPaperTotal: 0,
      maxSharedWithOneAuthor: 0,
      coauthorCheckStatus: 'complete',
      coauthorCheckFailures: [],
    }),
  });
  const eligibility = await produceEligibilityEvidence({
    candidate: { name: 'Jane Smith' },
    trustedDomains: ['example.edu'],
    sourceVersion: 'eligibility-v1',
    expectedSourceVersion: ELIGIBILITY_SOURCE,
    credentials: { serpApiKey: 'server-only' },
    now: () => NOW,
    searchOrganicResults: async () => [],
  });
  const contact = await produceReviewerContactEvidence({
    candidate: {
      name: 'Jane Smith',
      affiliation: 'Example University',
      contactEnrichment: { identity: { status: 'confirmed' } },
    },
    institutionDomains: ['example.edu'],
    sourceVersion: 'contact-v1',
    expectedSourceVersion: CONTACT_SOURCE,
    policy: { usePubmed: true },
    tierApi: contactTierApi(),
    now: () => NOW,
  });
  const address = await produceAddressTrustEvidence({
    candidate: {
      name: 'Jane Smith',
      email: 'jane@example.edu',
      emailSource: 'pubmed',
      emailPersistAllowed: true,
      contactEnrichment: {
        identity: { status: 'confirmed' },
        email: 'jane@example.edu',
        emailSource: 'pubmed',
        emailPersistAllowed: true,
      },
    },
    sourceVersion: 'address-v1',
    expectedSourceVersion: ADDRESS_SOURCE,
    now: () => NOW,
  });

  for (const [stage, envelope] of [
    ['coauthor_coi', coauthor],
    ['eligibility', eligibility],
    ['contact', contact],
    ['address_trust', address],
  ]) {
    expect(projectStageEnvelope({ stage, mode: 'manual_refresh', envelope })).toEqual(
      expect.objectContaining({ ok: true }),
    );
  }
});
