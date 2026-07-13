/**
 * @jest-environment node
 */

import {
  mintAutomatedIdentityAttestation,
  verifyAutomatedIdentityAttestation,
} from '../../lib/services/reviewer-candidate-attestation';
import {
  mergeEnrichment,
  pruneCandidateForRoster,
} from '../../shared/components/reviewers/reviewer-search-logic';

const REQUEST = '11111111-1111-1111-1111-111111111111';
const CANDIDATE = {
  name: 'Dr Jane Smith',
  email: 'jane@example.edu',
  affiliation: 'Example University',
  orcid: '0000-0002-1825-0097',
  googleScholarId: 'SCHOLAR-1',
  hIndex: 20,
  contactEnrichment: { identity: { status: 'probable' } },
};

let priorSecret;

beforeEach(() => {
  priorSecret = process.env.NEXTAUTH_SECRET;
  process.env.NEXTAUTH_SECRET = 'reviewer-attestation-test-secret';
});

afterEach(() => {
  if (priorSecret === undefined) delete process.env.NEXTAUTH_SECRET;
  else process.env.NEXTAUTH_SECRET = priorSecret;
});

test('server receipt verifies only for the bound request and identity bundle', async () => {
  const token = await mintAutomatedIdentityAttestation({ requestId: REQUEST, candidate: CANDIDATE });
  await expect(verifyAutomatedIdentityAttestation(token, {
    requestId: REQUEST,
    candidate: CANDIDATE,
  })).resolves.toMatchObject({ valid: true, source: 'automated_resolver' });

  await expect(verifyAutomatedIdentityAttestation(token, {
    requestId: '22222222-2222-2222-2222-222222222222',
    candidate: CANDIDATE,
  })).resolves.toMatchObject({ valid: false, reason: 'claim_mismatch' });

  await expect(verifyAutomatedIdentityAttestation(token, {
    requestId: REQUEST,
    candidate: { ...CANDIDATE, orcid: '0000-0001-5109-3700' },
  })).resolves.toMatchObject({ valid: false, reason: 'claim_mismatch' });
});

test('contact changes invalidate a receipt bound to the submitted candidate key', async () => {
  const token = await mintAutomatedIdentityAttestation({ requestId: REQUEST, candidate: CANDIDATE });
  const edited = {
    ...CANDIDATE,
    email: 'manual@example.edu',
    emailSource: 'manual',
    website: 'https://example.edu/manual',
  };
  await expect(verifyAutomatedIdentityAttestation(token, {
    requestId: REQUEST,
    candidate: edited,
  })).resolves.toMatchObject({ valid: false });
});

test('receipt survives the real enrichment merge and roster pruning shape', async () => {
  const discovered = {
    name: 'Dr Jane Smith',
    affiliation: 'Former University',
    identityStatus: 'probable',
  };
  const enriched = {
    ...discovered,
    contactEnrichment: {
      identity: { status: 'probable' },
      email: 'jane@example.edu',
      affiliation: 'Current University',
      orcidId: '0000-0002-1825-0097',
      googleScholarId: 'SCHOLAR-1',
      hIndex: 20,
      i10Index: 10,
      totalCitations: 100,
    },
  };
  const token = await mintAutomatedIdentityAttestation({ requestId: REQUEST, candidate: enriched });
  const [merged] = mergeEnrichment([discovered], [{ ...enriched, automatedIdentityAttestation: token }]);
  const reloaded = pruneCandidateForRoster(merged);
  await expect(verifyAutomatedIdentityAttestation(token, {
    requestId: REQUEST,
    candidate: reloaded,
  })).resolves.toMatchObject({ valid: true });
});
