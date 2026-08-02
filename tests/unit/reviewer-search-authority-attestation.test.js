/** @jest-environment node */

import {
  mintProposalLoadAttestation,
  verifyProposalLoadAttestation,
  mintAnalysisAttestation,
  verifyAnalysisAttestation,
  mintDiscoveryCandidateAttestation,
  verifyDiscoveryCandidateAttestation,
  proposalContentVersionForMetadata,
  normalizeProposalAuthors,
} from '../../lib/services/reviewer-finder/search-authority-attestation';
import {
  assertProposalAuthorityStable,
  ProposalAuthorityError,
} from '../../lib/services/reviewer-finder/proposal-authority-service';
import { proposalAuthorFingerprint } from '../../lib/services/reviewer-proposal-author-fingerprint';

const REQUEST_ID = '11111111-1111-1111-1111-111111111111';
const BINDING_KEY = 'akoya_request::request/Reviewer Materials::Proposal_100.pdf';
const BLOB_URL = 'https://blob.example/reviewer-finder/proposal.pdf';
const VERSION = 'a'.repeat(64);
const BASE64URL_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';

function nonCanonicalSegmentEncoding(token, segmentIndex) {
  const segments = token.split('.');
  const segment = segments[segmentIndex];
  const paddingBits = segment.length % 4 === 2 ? 4 : segment.length % 4 === 3 ? 2 : 0;
  if (!paddingBits) throw new Error('segment has no alternate Base64URL spelling');
  const last = BASE64URL_ALPHABET.indexOf(segment.at(-1));
  const alternate = BASE64URL_ALPHABET[(last & (0b111111 << paddingBits)) | 1];
  segments[segmentIndex] = `${segment.slice(0, -1)}${alternate}`;
  return segments.join('.');
}

function candidate(overrides = {}) {
  return {
    candidateKey: 'openalex:A123',
    name: 'Jane Smith',
    affiliation: 'Example University',
    identityDecision: 'probable',
    hasInstitutionCOI: false,
    coauthorCheckStatus: 'complete',
    hasCoauthorCOI: false,
    coauthorships: [],
    coauthorCheckFailures: [],
    ...overrides,
  };
}

let originalNextAuthSecret;

beforeAll(() => {
  originalNextAuthSecret = process.env.NEXTAUTH_SECRET;
  process.env.NEXTAUTH_SECRET = 'reviewer-search-attestation-test-secret';
});

afterAll(() => {
  if (originalNextAuthSecret === undefined) delete process.env.NEXTAUTH_SECRET;
  else process.env.NEXTAUTH_SECRET = originalNextAuthSecret;
});

test('proposal-load attestation is tamper-, request-, blob-, binding-, and version-bound', async () => {
  const token = await mintProposalLoadAttestation({
    requestId: REQUEST_ID,
    bindingKey: BINDING_KEY,
    blobUrl: BLOB_URL,
    proposalContentVersion: VERSION,
    manualOverride: false,
  });

  await expect(verifyProposalLoadAttestation(token, {
    requestId: REQUEST_ID,
    bindingKey: BINDING_KEY,
    blobUrl: BLOB_URL,
    proposalContentVersion: VERSION,
    manualOverride: false,
  })).resolves.toMatchObject({ valid: true });
  await expect(verifyProposalLoadAttestation(token, { requestId: '22222222-2222-2222-2222-222222222222' }))
    .resolves.toMatchObject({ valid: false, reason: 'claim_mismatch' });
  await expect(verifyProposalLoadAttestation(token, { bindingKey: `${BINDING_KEY}x` }))
    .resolves.toMatchObject({ valid: false, reason: 'claim_mismatch' });
  await expect(verifyProposalLoadAttestation(token, { blobUrl: 'https://blob.example/other.pdf' }))
    .resolves.toMatchObject({ valid: false, reason: 'claim_mismatch' });
  await expect(verifyProposalLoadAttestation(token, { proposalContentVersion: 'b'.repeat(64) }))
    .resolves.toMatchObject({ valid: false, reason: 'claim_mismatch' });
  await expect(verifyProposalLoadAttestation(token, { manualOverride: true }))
    .resolves.toMatchObject({ valid: false, reason: 'claim_mismatch' });
  await expect(verifyProposalLoadAttestation(`${token.slice(0, -1)}x`))
    .resolves.toMatchObject({ valid: false });
  const nonCanonicalSignatureToken = nonCanonicalSegmentEncoding(token, 2);
  expect(Buffer.from(nonCanonicalSignatureToken.split('.')[2], 'base64url')).toEqual(
    Buffer.from(token.split('.')[2], 'base64url'),
  );
  await expect(verifyProposalLoadAttestation(nonCanonicalSignatureToken))
    .resolves.toMatchObject({ valid: false, reason: 'malformed' });
  const nonCanonicalPayloadToken = nonCanonicalSegmentEncoding(token, 1);
  expect(Buffer.from(nonCanonicalPayloadToken.split('.')[1], 'base64url')).toEqual(
    Buffer.from(token.split('.')[1], 'base64url'),
  );
  await expect(verifyProposalLoadAttestation(nonCanonicalPayloadToken))
    .resolves.toMatchObject({ valid: false, reason: 'malformed' });
  await expect(mintProposalLoadAttestation({
    requestId: REQUEST_ID,
    bindingKey: BINDING_KEY,
    blobUrl: 'http://blob.example/unsafe.pdf',
    proposalContentVersion: VERSION,
    manualOverride: false,
  })).rejects.toThrow('invalid proposal-load authority claims');
});

test('analysis attestation carries only bounded proposal-author authority', async () => {
  const token = await mintAnalysisAttestation({
    requestId: REQUEST_ID,
    bindingKey: BINDING_KEY,
    blobUrl: BLOB_URL,
    proposalContentVersion: VERSION,
    proposalAuthors: ['Dr. Alice Author', 'alice author', 'Bob Writer'],
  });
  const verified = await verifyAnalysisAttestation(token, { requestId: REQUEST_ID });

  expect(verified).toMatchObject({
    valid: true,
    proposalContentVersion: VERSION,
    proposalAuthors: ['Alice Author', 'Bob Writer'],
    proposalAuthorVersion: expect.stringMatching(/^[a-f0-9]{64}$/),
    analysisDigest: expect.stringMatching(/^[a-f0-9]{64}$/),
  });
  expect(verified.proposalAuthorVersion).toBe(proposalAuthorFingerprint(
    VERSION,
    ['Dr. Alice Author', 'alice author', 'Bob Writer'],
  ));
  expect(verified).not.toHaveProperty('proposalText');

  const changedVersion = await verifyAnalysisAttestation(await mintAnalysisAttestation({
    requestId: REQUEST_ID,
    bindingKey: BINDING_KEY,
    blobUrl: BLOB_URL,
    proposalContentVersion: 'b'.repeat(64),
    proposalAuthors: ['Dr. Alice Author', 'alice author', 'Bob Writer'],
  }));
  expect(changedVersion.proposalAuthorVersion).not.toBe(verified.proposalAuthorVersion);
});

test('shared author normalization preserves the 48-author bound used by coauthor coverage', () => {
  const raw = Array.from({ length: 49 }, (_, index) => `Dr. Author ${index}`);
  const bounded = normalizeProposalAuthors(raw);

  expect(bounded).toHaveLength(48);
  expect(bounded[0]).toBe('Author 0');
  expect(proposalAuthorFingerprint(VERSION, raw)).toBe(
    proposalAuthorFingerprint(VERSION, bounded),
  );
});

test('candidate discovery attestation rejects cross-candidate, re-ordered, duplicate-name and evidence injection', async () => {
  const analysis = await verifyAnalysisAttestation(await mintAnalysisAttestation({
    requestId: REQUEST_ID,
    bindingKey: BINDING_KEY,
    blobUrl: BLOB_URL,
    proposalContentVersion: VERSION,
    proposalAuthors: ['Alice Author'],
  }), { requestId: REQUEST_ID });
  const first = candidate();
  const second = candidate({ candidateKey: 'openalex:A456', name: 'Jane Smith' });
  const firstToken = await mintDiscoveryCandidateAttestation({
    requestId: REQUEST_ID,
    analysisDigest: analysis.analysisDigest,
    candidate: first,
  });
  const secondToken = await mintDiscoveryCandidateAttestation({
    requestId: REQUEST_ID,
    analysisDigest: analysis.analysisDigest,
    candidate: second,
  });

  await expect(verifyDiscoveryCandidateAttestation(firstToken, {
    requestId: REQUEST_ID,
    analysisDigest: analysis.analysisDigest,
    candidate: first,
  })).resolves.toMatchObject({ valid: true, candidateKey: first.candidateKey });
  await expect(verifyDiscoveryCandidateAttestation(firstToken, {
    requestId: REQUEST_ID,
    analysisDigest: analysis.analysisDigest,
    candidate: second,
  })).resolves.toMatchObject({ valid: false, reason: 'claim_mismatch' });
  await expect(verifyDiscoveryCandidateAttestation(secondToken, {
    requestId: REQUEST_ID,
    analysisDigest: analysis.analysisDigest,
    candidate: first,
  })).resolves.toMatchObject({ valid: false, reason: 'claim_mismatch' });
  await expect(verifyDiscoveryCandidateAttestation(firstToken, {
    requestId: REQUEST_ID,
    analysisDigest: analysis.analysisDigest,
    candidate: candidate({ hasCoauthorCOI: true }),
  })).resolves.toMatchObject({ valid: false, reason: 'claim_mismatch' });
  await expect(mintDiscoveryCandidateAttestation({
    requestId: REQUEST_ID,
    analysisDigest: analysis.analysisDigest,
    candidate: candidate({ coauthorships: Array.from({ length: 17 }, () => ({ proposalAuthor: 'Alice Author' })) }),
  })).rejects.toThrow('invalid discovery candidate authority claims');
});

test('proposal content version changes whenever exact Graph metadata changes', () => {
  const metadata = {
    driveId: 'drive-a', id: 'item-a', eTag: 'etag-a', versionId: '1.0', lastModified: '2026-08-02T12:00:00Z',
  };
  const before = proposalContentVersionForMetadata(REQUEST_ID, metadata);
  const after = proposalContentVersionForMetadata(REQUEST_ID, { ...metadata, eTag: 'etag-b' });

  expect(before).toMatch(/^[a-f0-9]{64}$/);
  expect(after).toMatch(/^[a-f0-9]{64}$/);
  expect(after).not.toBe(before);
  expect(proposalContentVersionForMetadata(REQUEST_ID, { ...metadata, id: null })).toBeNull();
});

test('a Graph-version boundary fails closed before proposal bytes can acquire authority', () => {
  const before = {
    bindingKey: BINDING_KEY,
    proposalContentVersion: proposalContentVersionForMetadata(REQUEST_ID, {
      driveId: 'drive-a', id: 'item-a', eTag: 'etag-a', versionId: '1.0', lastModified: '2026-08-02T12:00:00Z',
    }),
  };
  const after = {
    ...before,
    proposalContentVersion: proposalContentVersionForMetadata(REQUEST_ID, {
      driveId: 'drive-a', id: 'item-a', eTag: 'etag-b', versionId: '1.0', lastModified: '2026-08-02T12:00:00Z',
    }),
  };

  expect(() => assertProposalAuthorityStable({ before, after }))
    .toThrow(ProposalAuthorityError);
  expect(() => assertProposalAuthorityStable({ before, after: before })).not.toThrow();
});
