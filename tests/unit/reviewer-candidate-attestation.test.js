/**
 * @jest-environment node
 */

import { decodeJwt, SignJWT } from 'jose';
import crypto from 'crypto';
import {
  legacyIdentityAttestationProjection,
  mintAutomatedIdentityAttestation,
  PROJECTION_VERSION,
  TTL_SECONDS,
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
  jest.useRealTimers();
  if (priorSecret === undefined) delete process.env.NEXTAUTH_SECRET;
  else process.env.NEXTAUTH_SECRET = priorSecret;
});

test('server receipt carries the owner-approved 14-day lifetime', async () => {
  const token = await mintAutomatedIdentityAttestation({ requestId: REQUEST, candidate: CANDIDATE });
  const payload = decodeJwt(token);

  expect(TTL_SECONDS).toBe(14 * 24 * 60 * 60);
  expect(payload.exp - payload.iat).toBe(TTL_SECONDS);
  expect(payload.projectionVersion).toBe(PROJECTION_VERSION);
});

test('absent receipt fails closed', async () => {
  await expect(verifyAutomatedIdentityAttestation('', {
    requestId: REQUEST,
    candidate: CANDIDATE,
  })).resolves.toEqual({ valid: false, reason: 'no_token' });
});

test('receipt signed with a different secret fails closed', async () => {
  const token = await mintAutomatedIdentityAttestation({ requestId: REQUEST, candidate: CANDIDATE });
  process.env.NEXTAUTH_SECRET = 'different-reviewer-attestation-secret';

  await expect(verifyAutomatedIdentityAttestation(token, {
    requestId: REQUEST,
    candidate: CANDIDATE,
  })).resolves.toEqual({ valid: false, reason: 'invalid_signature' });
});

test('receipt fails closed after the 14-day lifetime and clock tolerance', async () => {
  jest.useFakeTimers();
  const issuedAt = new Date('2026-07-13T00:00:00.000Z');
  jest.setSystemTime(issuedAt);
  const token = await mintAutomatedIdentityAttestation({ requestId: REQUEST, candidate: CANDIDATE });

  jest.setSystemTime(new Date(issuedAt.getTime() + ((TTL_SECONDS + 31) * 1000)));
  await expect(verifyAutomatedIdentityAttestation(token, {
    requestId: REQUEST,
    candidate: CANDIDATE,
  })).resolves.toEqual({ valid: false, reason: 'expired' });
});

test('server receipt verifies only for the bound request and identity bundle', async () => {
  const token = await mintAutomatedIdentityAttestation({ requestId: REQUEST, candidate: CANDIDATE });
  await expect(verifyAutomatedIdentityAttestation(token, {
    requestId: REQUEST,
    candidate: CANDIDATE,
  })).resolves.toMatchObject({
    valid: true,
    source: 'automated_resolver',
    identityDecisionBound: true,
  });

  await expect(verifyAutomatedIdentityAttestation(token, {
    requestId: '22222222-2222-2222-2222-222222222222',
    candidate: CANDIDATE,
  })).resolves.toMatchObject({ valid: false, reason: 'claim_mismatch' });

  await expect(verifyAutomatedIdentityAttestation(token, {
    requestId: REQUEST,
    candidate: { ...CANDIDATE, orcid: '0000-0001-5109-3700' },
  })).resolves.toMatchObject({ valid: false, reason: 'claim_mismatch' });
});

test('receipt binds every field that the automated identity writer persists', async () => {
  const candidate = {
    ...CANDIDATE,
    contactEnrichment: {
      ...CANDIDATE.contactEnrichment,
      identity: {
        status: 'probable',
        confidenceBand: 'medium',
        resolverVersion: '2.0.0-works-first',
        resolvedAt: '2026-07-19T12:00:00.000Z',
        evidenceSummary: 'probable — authorship grounded',
        anchors: [{
          type: 'authorship_grounded',
          canonicalKey: 'openalex:A100',
          sourceUrl: 'https://openalex.org/A100',
          verifier: 'reviewerWorksFirst@2.0.0-works-first',
        }],
      },
    },
  };
  const token = await mintAutomatedIdentityAttestation({ requestId: REQUEST, candidate });

  const mutations = [
    { ...candidate.contactEnrichment.identity, confidenceBand: 'high' },
    { ...candidate.contactEnrichment.identity, resolverVersion: 'client-forged' },
    { ...candidate.contactEnrichment.identity, evidenceSummary: 'client-forged' },
    {
      ...candidate.contactEnrichment.identity,
      anchors: [{
        ...candidate.contactEnrichment.identity.anchors[0],
        canonicalKey: 'orcid:0000-0001-5109-3700',
      }],
    },
  ];
  for (const identity of mutations) {
    await expect(verifyAutomatedIdentityAttestation(token, {
      requestId: REQUEST,
      candidate: {
        ...candidate,
        contactEnrichment: { ...candidate.contactEnrichment, identity },
      },
    })).resolves.toMatchObject({ valid: false, reason: 'claim_mismatch' });
  }
});

test('legacy receipts remain valid for bound metrics but cannot authorize identity writes', async () => {
  const projection = legacyIdentityAttestationProjection(CANDIDATE);
  const identityDigest = crypto.createHash('sha256')
    .update(JSON.stringify(projection))
    .digest('base64url');
  const token = await new SignJWT({
    typ: 'reviewer-auto-identity',
    requestId: REQUEST,
    candidateKey: projection.candidateKey,
    identityDigest,
  })
    .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
    .setIssuedAt()
    .setExpirationTime(Math.floor(Date.now() / 1000) + TTL_SECONDS)
    .sign(new TextEncoder().encode(process.env.NEXTAUTH_SECRET));

  await expect(verifyAutomatedIdentityAttestation(token, {
    requestId: REQUEST,
    candidate: CANDIDATE,
  })).resolves.toEqual({
    valid: true,
    source: 'automated_resolver',
    identityDecisionBound: false,
  });
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
  })).resolves.toMatchObject({
    valid: true,
    identityDecisionBound: true,
  });
});
