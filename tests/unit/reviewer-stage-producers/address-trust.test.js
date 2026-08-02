/** @jest-environment node */

import {
  produceAddressTrustEvidence,
} from '../../../lib/services/workbench/reviewer-stage-producers/address-trust';
import { createConflictPendingState, createStaffVerifiedState } from '../../../lib/utils/reviewer-address-trust';

const NOW = '2026-08-02T12:00:00.000Z';
const EXPECTED_SOURCE = 'b'.repeat(64);

function candidate(overrides = {}) {
  return {
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
    ...overrides,
  };
}

function input(overrides = {}) {
  return {
    candidate: candidate(),
    sourceVersion: 'address-input-v1',
    expectedSourceVersion: EXPECTED_SOURCE,
    now: () => NOW,
    ...overrides,
  };
}

test('reads a valid exact server-side staff bundle without accepting browser evidence', async () => {
  const state = createStaffVerifiedState({
    email: 'jane@example.edu',
    requestId: 'request-1',
    candidateKey: 'person:1',
    actorSystemUserId: 'staff-1',
    evidenceType: 'institution_page',
    evidenceUrl: 'https://example.edu/jane',
    attestedAt: NOW,
  });
  const result = await produceAddressTrustEvidence(input({
    linkedPerson: { email: 'jane@example.edu', addressTrustStateJson: JSON.stringify(state) },
    canonicalPerson: {
      authority: 'server_loaded',
      canonicalPersonId: '11111111-1111-4111-8111-111111111111',
      canonicalPersonEtag: 'W/"person-1"',
    },
  }));

  expect(result).toMatchObject({
    outcome: 'current',
    evidencePatch: {
      addressTrustStatus: 'staff_verified',
      addressTrustEmail: 'jane@example.edu',
      addressTrustSource: 'staff_verified',
      addressTrustEvidence: expect.objectContaining({
        canonicalPersonId: '11111111-1111-4111-8111-111111111111',
        actorId: 'staff-1',
      }),
    },
    receipt: { state: 'current', completedAt: NOW },
  });
});

test('keeps missing contact deterministic N/A while promotion remains governed by contact', async () => {
  const result = await produceAddressTrustEvidence(input({
    candidate: candidate({
      email: null,
      contactEnrichment: { identity: { status: 'confirmed' }, email: null, emailSource: null },
    }),
  }));

  expect(result).toMatchObject({
    outcome: 'not_applicable',
    evidencePatch: { addressTrustStatus: 'not_applicable' },
    receipt: { reasonCode: 'missing_email', completedAt: NOW },
  });
});

test.each(['confirmed', 'probable'])(
  'accepts projector-shaped %s identity evidence for a contact-backed address conclusion',
  async (decision) => {
    const result = await produceAddressTrustEvidence(input({
      candidate: candidate({
        identityDecision: decision,
        identityEvidence: { decision },
        contactEnrichment: {
          email: 'jane@example.edu',
          emailSource: 'pubmed',
          emailPersistAllowed: true,
        },
      }),
    }));

    expect(result).toMatchObject({
      outcome: 'current',
      evidencePatch: { addressTrustStatus: 'quick_check' },
      receipt: { state: 'current' },
    });
  },
);

test('accepts a valid staff identity confirmation when the resolver has no decision', async () => {
  const result = await produceAddressTrustEvidence(input({
    candidate: candidate({
      identityEvidence: {
        staffConfirmation: {
          state: 'confirmed',
          canonicalPersonId: '11111111-1111-4111-8111-111111111111',
          canonicalPersonEtag: 'W/"etag-1"',
          actorId: 'staff-1',
          confirmedAt: NOW,
        },
      },
      contactEnrichment: {
        email: 'jane@example.edu',
        emailSource: 'pubmed',
        emailPersistAllowed: true,
      },
    }),
  }));

  expect(result).toMatchObject({
    outcome: 'current',
    evidencePatch: { addressTrustStatus: 'quick_check' },
  });
});

test('does not let a partial staff confirmation unlock address trust', async () => {
  const result = await produceAddressTrustEvidence(input({
    candidate: candidate({
      identityEvidence: {
        staffConfirmation: {
          state: 'confirmed',
          canonicalPersonId: 'person-1',
          confirmedAt: NOW,
        },
      },
      contactEnrichment: {
        email: 'jane@example.edu',
        emailSource: 'pubmed',
        emailPersistAllowed: true,
      },
    }),
  }));

  expect(result).toMatchObject({
    outcome: 'not_applicable',
    receipt: { reasonCode: 'identity_not_authoritative' },
  });
});

test('keeps projector-shaped ambiguous identity evidence N/A', async () => {
  const result = await produceAddressTrustEvidence(input({
    candidate: candidate({
      identityDecision: 'ambiguous',
      identityEvidence: { decision: 'ambiguous' },
      contactEnrichment: {
        email: 'jane@example.edu',
        emailSource: 'pubmed',
        emailPersistAllowed: true,
      },
    }),
  }));

  expect(result).toMatchObject({
    outcome: 'not_applicable',
    receipt: { reasonCode: 'identity_not_authoritative', completedAt: NOW },
  });
});

test('does not allow a linked-person conflict to become a ready stage', async () => {
  const state = createConflictPendingState({
    email: 'jane@example.edu',
    foundEmail: 'other@example.edu',
    reason: 'email_mismatch',
    requestId: 'request-1',
    candidateKey: 'person:1',
    detectedAt: NOW,
  });
  const result = await produceAddressTrustEvidence(input({
    linkedPerson: { email: 'jane@example.edu', addressTrustStateJson: JSON.stringify(state) },
  }));

  expect(result).toMatchObject({
    outcome: 'incomplete',
    evidencePatch: { addressTrustStatus: 'conflict_pending' },
    receipt: { state: 'incomplete', failureCode: 'partial_coverage' },
  });
});

test('preserves an already-aborted request for the server lease handler', async () => {
  const controller = new AbortController();
  controller.abort(new Error('reviewer_time_budget_exceeded'));

  await expect(produceAddressTrustEvidence(input({ signal: controller.signal })))
    .rejects.toThrow('reviewer_time_budget_exceeded');
});

test('fails closed before evaluating contact readiness when the shared expected source is missing or malformed', async () => {
  const result = await produceAddressTrustEvidence(input({ expectedSourceVersion: 'forged' }));

  expect(result).toMatchObject({ outcome: 'failed', receipt: { state: 'failed', completedAt: null } });
});
